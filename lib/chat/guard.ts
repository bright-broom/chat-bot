// /api/chat の不正利用対策（入力検証・レート制限・クロスサイト要求の拒否）
import type { ChatConfig } from "./config";
import type { ChatMessage } from "./types";

type Limits = ChatConfig["limits"];

export type ParsedMessages = { ok: true; messages: ChatMessage[] } | { ok: false; error: string };

const INVALID = "リクエストの形式が不正です。";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…（以下省略）` : text;
}

/**
 * クライアントから来た messages を検証し、上限内に切り詰めて返す。
 * - content は文字列のみ許可（配列形式で画像・ファイル等を送り込まれるのを防ぐ）
 * - ユーザー発言が長すぎる場合はエラー、アシスタントの過去の返答は切り詰めて受け入れる
 * - 古い履歴から切り捨てて件数・総文字数を上限内に収め、先頭と末尾をユーザー発言にそろえる
 */
export function parseMessages(list: unknown, limits: Limits): ParsedMessages {
  if (!Array.isArray(list)) return { ok: false, error: INVALID };

  const messages: ChatMessage[] = [];
  for (const m of list) {
    if (!m || typeof m !== "object") return { ok: false, error: INVALID };
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
      return { ok: false, error: INVALID };
    }
    if (!content.trim()) continue;
    if (role === "user" && content.length > limits.messageChars) {
      return {
        ok: false,
        error: `メッセージが長すぎます（${limits.messageChars} 文字以内にしてください）。`,
      };
    }
    // 過去のアシスタント返答は長くなりがちなので、要点が入る冒頭だけを履歴として送る（トークン節約）
    messages.push({ role, content: role === "assistant" ? clip(content, limits.assistantChars) : content });
  }

  let recent = messages.slice(-limits.messages);
  let total = recent.reduce((n, m) => n + m.content.length, 0);
  while (recent.length > 1 && total > limits.totalChars) {
    total -= recent[0].content.length;
    recent = recent.slice(1);
  }
  while (recent.length > 0 && recent[0].role !== "user") recent = recent.slice(1);

  if (recent.length === 0 || recent[recent.length - 1].role !== "user") {
    return { ok: false, error: "最後のメッセージはユーザーの発言である必要があります。" };
  }
  return { ok: true, messages: recent };
}

/**
 * 他サイトのページから訪問者のブラウザ経由で叩かれるのを防ぐ。
 * （curl 等は Origin を偽装できるので、これ単体では不正利用対策にならない。レート制限と併用）
 */
export function isCrossSite(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Cloudflare は cf-connecting-ip に実クライアント IP を入れる（他の環境向けに x-real-ip / x-forwarded-for も見る） */
export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfter: number; message: string };

type Window = { count: number; reset: number };

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * キー（IP）ごとの固定ウィンドウ型レート制限（1 分あたり・1 日あたり）。
 * Cloudflare Workers ではアイソレートごとのメモリなので完全ではなく、目安の上限。
 * 確実な上限は Cloudflare の WAF ルールや LLM 側の利用上限で担保する。
 */
export class RateLimiter {
  private readonly hits = new Map<string, { minute: Window; day: Window }>();

  constructor(private readonly maxKeys = 10_000) {}

  check(key: string, limits: ChatConfig["rateLimit"], now = Date.now()): RateLimitResult {
    const { perMinute, perDay } = limits;
    if (!(perMinute > 0) && !(perDay > 0)) return { ok: true };
    this.evict(now);

    let entry = this.hits.get(key);
    if (!entry) {
      entry = {
        minute: { count: 0, reset: now + MINUTE_MS },
        day: { count: 0, reset: now + DAY_MS },
      };
      this.hits.set(key, entry);
    }
    if (entry.minute.reset <= now) entry.minute = { count: 0, reset: now + MINUTE_MS };
    if (entry.day.reset <= now) entry.day = { count: 0, reset: now + DAY_MS };

    if (perDay > 0 && entry.day.count >= perDay) {
      return {
        ok: false,
        retryAfter: Math.ceil((entry.day.reset - now) / 1000),
        message:
          "本日の利用上限に達しました。申し訳ありませんが、時間をおいて明日以降に再度お試しください。",
      };
    }
    if (perMinute > 0 && entry.minute.count >= perMinute) {
      const sec = Math.ceil((entry.minute.reset - now) / 1000);
      return {
        ok: false,
        retryAfter: sec,
        message: `短時間に多くのリクエストがありました。${sec} 秒ほど待ってから再度お試しください。`,
      };
    }
    entry.minute.count++;
    entry.day.count++;
    return { ok: true };
  }

  get size(): number {
    return this.hits.size;
  }

  // 期限切れを捨て、それでも多すぎる場合は古いものから削除する（メモリ枯渇対策）
  private evict(now: number) {
    if (this.hits.size < this.maxKeys) return;
    for (const [k, v] of this.hits) if (v.day.reset <= now) this.hits.delete(k);
    for (const k of this.hits.keys()) {
      if (this.hits.size < this.maxKeys) break;
      this.hits.delete(k);
    }
  }
}
