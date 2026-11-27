// POST /api/chat — 行政相談チャットの入口。
// ここでは「検証 → レート制限 → プロンプト組み立て → LLM 呼び出し → テキストストリーム返却」の流れだけを書き、
// 各処理の中身は lib/chat/ 以下のモジュールに置く（それぞれ単体テストあり）。
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { BLOCKED_REPLY, mentionsBlockedTopic } from "@/lib/chat/blocked";
import { type AnswerCache, cacheKey, createEdgeCache, dayJst, isCacheable, noopCache } from "@/lib/chat/cache";
import { loadConfig } from "@/lib/chat/config";
import { isAllowedUrl, safeCitationUrl } from "@/lib/chat/domains";
import { RateLimiter, clientIp, isCrossSite } from "@/lib/chat/guard";
import { type ChatProvider, UpstreamError, selectProvider } from "@/lib/chat/llm";
import type { WorkersAiBinding } from "@/lib/chat/llm/workers-ai";
import { errorSummary, log } from "@/lib/chat/log";
import { PROMPT_VERSION, systemPrompt, todayJst } from "@/lib/chat/prompts";
import { parseChatRequest } from "@/lib/chat/request";
import { toTextStream } from "@/lib/chat/sse";
import type { ModelMessage } from "@/lib/chat/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// アイソレート内で共有する（リクエストをまたいでカウントするため）
const rateLimiter = new RateLimiter();

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

function plain(text: string, status: number, headers: Record<string, string> = {}) {
  return new Response(text, { status, headers: { ...TEXT_HEADERS, ...headers } });
}

function answerCache(): AnswerCache {
  const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  return edge ? createEdgeCache(edge) : noopCache;
}

/** レスポンスを返したあとも処理（キャッシュ保存など）を続けさせる */
function waitUntil(promise: Promise<unknown>) {
  try {
    getCloudflareContext().ctx.waitUntil(promise);
  } catch {
    void promise;
  }
}

function workersAiBinding(): WorkersAiBinding | undefined {
  try {
    return getCloudflareContext().env.AI as unknown as WorkersAiBinding | undefined;
  } catch {
    // Cloudflare 以外（next start など）で動かした場合
    return undefined;
  }
}

async function readJson(req: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, res: plain("リクエストの形式が不正です。", 415) };
  }
  if (Number(req.headers.get("content-length") ?? "0") > maxBytes) {
    return { ok: false, res: plain("リクエストが大きすぎます。", 413) };
  }
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      return { ok: false, res: plain("リクエストが大きすぎます。", 413) };
    }
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: plain("リクエストの形式が不正です。", 400) };
  }
}

export async function POST(req: Request) {
  const config = loadConfig();

  if (isCrossSite(req)) return plain("許可されていない送信元です。", 403);

  const limited = rateLimiter.check(clientIp(req), config.rateLimit);
  if (!limited.ok) {
    return plain(limited.message, 429, { "Retry-After": String(limited.retryAfter) });
  }

  const body = await readJson(req, config.limits.bodyBytes);
  if (!body.ok) return body.res;

  const parsed = parseChatRequest(body.value, config.limits);
  if (!parsed.ok) return plain(parsed.error, 400);
  const { messages, mode, easyJapanese } = parsed.value;

  // 回答しない話題（blocked.ts）に触れる質問には、LLM を呼ばずに定型文だけを返す
  if (mentionsBlockedTopic(messages[messages.length - 1].content)) {
    return plain(BLOCKED_REPLY, 200);
  }

  const provider: ChatProvider | null = selectProvider(config, workersAiBinding);
  if (!provider) {
    log.error("chat.provider_missing");
    return plain("サーバーの設定に問題があります。", 500);
  }

  // 1 問目の短い質問は、同じ日・同じ設定の回答をエッジキャッシュから返す（LLM を呼ばない）
  const cache = answerCache();
  const key = isCacheable(messages)
    ? await cacheKey({
        promptVersion: PROMPT_VERSION,
        model: provider.model,
        mode,
        easyJapanese,
        day: dayJst(),
        question: messages[0].content,
      })
    : null;
  if (key) {
    const cached = await cache.get(key).catch(() => null);
    if (cached) {
      log.info("chat.completed", { provider: provider.name, mode, cache: "hit", chars: cached.length });
      return new Response(cached, { headers: { ...TEXT_HEADERS, "X-Answer-Cache": "HIT" } });
    }
  }

  const modelMessages: ModelMessage[] = [
    {
      role: "system",
      content: systemPrompt(mode, easyJapanese, {
        webSearch: provider.webSearch,
        allowedDomains: config.allowedDomains,
        today: todayJst(),
      }),
    },
    ...messages,
  ];

  let upstream: ReadableStream<Uint8Array>;
  try {
    // クライアントが切断したら上流の生成も止める（無駄なトークン消費を防ぐ）
    upstream = await provider.stream(modelMessages, {
      maxTokens: config.maxOutputTokens[mode],
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      log.error("chat.upstream_error", { provider: provider.name, status: err.status, detail: err.detail });
      return plain(err.userMessage, 502);
    }
    log.error("chat.upstream_exception", { provider: provider.name, error: errorSummary(err) });
    return plain("回答の生成に失敗しました。時間をおいてお試しください。", 502);
  }

  const stream = toTextStream(upstream, {
    // 念のため許可ドメイン以外の出典は表示しない
    acceptCitation: (url) => {
      const safe = safeCitationUrl(url);
      return safe && isAllowedUrl(safe, config.allowedDomains) ? safe : null;
    },
    onUpstreamError: (message) =>
      log.error("chat.stream_error", { provider: provider.name, error: message.slice(0, 300) }),
    onComplete: ({ text, failed, usage }) => {
      // 消費量を観測できるようにする（入力本文は出さない）
      log.info("chat.completed", {
        provider: provider.name,
        mode,
        cache: key ? "miss" : "skip",
        failed,
        chars: text.length,
        historyMessages: messages.length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      if (key && !failed) waitUntil(cache.put(key, text));
    },
  });

  return new Response(stream, {
    headers: { ...TEXT_HEADERS, ...(key ? { "X-Answer-Cache": "MISS" } : {}) },
  });
}
