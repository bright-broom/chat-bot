// 1 問目の質問への回答キャッシュ（Cloudflare のエッジキャッシュ）。
//
// トップの「よくある質問」ボタンや「使える支援制度を探す」の 1 問目は、多くの人が同じ文面で送る。
// 会話の 1 問目（履歴なし）に限って回答をキャッシュし、同じ質問には LLM を呼ばずに返す。
// - キーは「プロンプトの版・モデル・モード・やさしい日本語・日付・質問文」のハッシュ。
//   日付を含めるので、回答は最長でも当日中しか使われない（期限などの案内が古くならない）
// - 個人の事情が入りやすい長い文面はキャッシュしない
// - 失敗した回答・空の回答はキャッシュしない

import type { Mode } from "./types";

export type AnswerCache = {
  get(key: string): Promise<string | null>;
  put(key: string, text: string): Promise<void>;
};

/** これより長い質問はキャッシュしない（個別の相談になりやすく、当たる見込みも低い） */
export const MAX_CACHEABLE_QUESTION_CHARS = 60;

export type CacheKeyInput = {
  promptVersion: string;
  model: string;
  mode: Mode;
  easyJapanese: boolean;
  /** 日本時間の日付（例: 2026-11-28） */
  day: string;
  question: string;
};

/** 表記ゆれ（全角半角・空白・末尾の句読点）をそろえる */
export function normalizeQuestion(q: string): string {
  return q
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?？。.!！]+$/u, "");
}

/** 1 問目（履歴なし）かつ短い質問だけをキャッシュ対象にする */
export function isCacheable(messages: readonly { role: string; content: string }[]): boolean {
  return (
    messages.length === 1 &&
    messages[0].role === "user" &&
    normalizeQuestion(messages[0].content).length > 0 &&
    messages[0].content.length <= MAX_CACHEABLE_QUESTION_CHARS
  );
}

export async function cacheKey(input: CacheKeyInput): Promise<string> {
  const raw = [
    input.promptVersion,
    input.model,
    input.mode,
    input.easyJapanese ? "easy" : "std",
    input.day,
    normalizeQuestion(input.question),
  ].join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 日本時間の日付（YYYY-MM-DD） */
export function dayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now);
}

/**
 * Cloudflare の Cache API（caches.default）を使う実装。
 * データセンターごとのキャッシュで、外部からは参照できない内部 URL をキーにする。
 */
export function createEdgeCache(cache: Cache, ttlSeconds = 6 * 60 * 60): AnswerCache {
  const url = (key: string) => `https://answer-cache.brightbroom.internal/v1/${key}`;
  return {
    async get(key) {
      const hit = await cache.match(url(key));
      return hit ? hit.text() : null;
    },
    async put(key, text) {
      await cache.put(
        url(key),
        new Response(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    },
  };
}

/** Cache API が使えない環境（next dev など）では何もしない */
export const noopCache: AnswerCache = {
  async get() {
    return null;
  },
  async put() {},
};
