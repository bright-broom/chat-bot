// LLM の SSE（Server-Sent Events）応答を読み、本文テキストだけのストリームに変換する。
// OpenAI 互換形式（choices[].delta.content、OpenRouter・新しい Workers AI モデル）と
// Workers AI の従来形式（response）の両方に対応する。思考（reasoning）部分は流さない。

export type Citation = { url: string; title?: string };

export type TextStreamOptions = {
  /** 出典として載せてよい URL を返す（載せない場合は null） */
  acceptCitation?: (url: string) => string | null;
  /** 末尾に載せる出典の最大数 */
  maxCitations?: number;
  /** 上流から届いたエラー（ログ用。利用者の入力は含めない） */
  onUpstreamError?: (message: string) => void;
};

type Chunk = {
  choices?: {
    delta?: {
      content?: string | null;
      annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[];
    };
  }[];
  response?: unknown;
  error?: { message?: string };
};

export const STREAM_ERROR_TEXT = "\n\n[エラーが発生しました。]";

/** 出典リンクの表示名: タイトル（長ければ短縮）→ なければドメイン */
export function citationLabel(c: Citation): string {
  const clean = (c.title ?? "").replace(/[[\]\n]/g, " ").trim();
  if (clean) return clean.length > 30 ? `${clean.slice(0, 29)}…` : clean;
  try {
    return new URL(c.url).hostname.replace(/^www\./, "");
  } catch {
    return c.url;
  }
}

export function formatCitations(citations: readonly Citation[], max = 3): string {
  if (citations.length === 0) return "";
  const list = citations
    .slice(0, max)
    .map((c) => `[${citationLabel(c)}](${c.url})`)
    .join(" · ");
  return `\n\n出典: ${list}`;
}

/** SSE の 1 行を解釈する。本文テキストと、見つかった出典を返す */
export function parseSseLine(line: string): { text: string; citations: Citation[]; error?: string } | null {
  const trimmed = line.trim();
  // コメント行（": OPENROUTER PROCESSING" など）や空行は無視
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return null;

  let chunk: Chunk;
  try {
    chunk = JSON.parse(data);
  } catch {
    return null;
  }
  if (chunk.error) return { text: "", citations: [], error: chunk.error.message ?? "unknown" };

  const delta = chunk.choices?.[0]?.delta;
  const citations: Citation[] = [];
  for (const a of delta?.annotations ?? []) {
    if (a.type === "url_citation" && a.url_citation?.url) {
      citations.push({ url: a.url_citation.url, title: a.url_citation.title });
    }
  }
  const text = delta?.content ?? (typeof chunk.response === "string" ? chunk.response : "");
  return { text: text ?? "", citations };
}

export function toTextStream(
  upstream: ReadableStream<Uint8Array>,
  options: TextStreamOptions = {},
): ReadableStream<Uint8Array> {
  const { acceptCitation = () => null, maxCitations = 3, onUpstreamError } = options;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.getReader();
  const citations = new Map<string, Citation>();
  let buffer = "";

  const handleLine = (line: string, controller: ReadableStreamDefaultController<Uint8Array>) => {
    const parsed = parseSseLine(line);
    if (!parsed) return;
    if (parsed.error !== undefined) {
      onUpstreamError?.(parsed.error);
      controller.enqueue(encoder.encode(STREAM_ERROR_TEXT));
      return;
    }
    for (const c of parsed.citations) {
      const url = acceptCitation(c.url);
      if (url && !citations.has(url)) citations.set(url, { url, title: c.title });
    }
    if (parsed.text) controller.enqueue(encoder.encode(parsed.text));
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) handleLine(line, controller);
        }
        // 最後の行が改行で終わっていない場合や、デコーダーに残ったバイトも処理する
        buffer += decoder.decode();
        if (buffer) handleLine(buffer, controller);

        const tail = formatCitations([...citations.values()], maxCitations);
        if (tail) controller.enqueue(encoder.encode(tail));
      } catch (err) {
        onUpstreamError?.(err instanceof Error ? err.message : String(err));
        controller.enqueue(encoder.encode(STREAM_ERROR_TEXT));
      } finally {
        controller.close();
      }
    },
    cancel(reason) {
      // クライアントが切断したら上流の読み取りも止める（無駄な生成・課金を防ぐ）
      return reader.cancel(reason);
    },
  });
}
