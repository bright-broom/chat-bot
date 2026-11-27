// 環境変数の読み取りを一か所に集める。
// Cloudflare Workers では process.env がリクエスト処理時に確実に揃うため、
// モジュール読み込み時ではなく、呼び出しのたびに読む（値の取り違えを防ぐ）。

import type { Mode } from "./types";

type Env = Record<string, string | undefined>;

function intFrom(env: Env, name: string, fallback: number): number {
  const v = Number.parseInt(env[name] ?? "", 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

export type ChatConfig = {
  limits: {
    /** リクエスト本文の最大バイト数 */
    bodyBytes: number;
    /** モデルに送る会話履歴の最大件数 */
    messages: number;
    /** 1 メッセージの最大文字数 */
    messageChars: number;
    /** 会話履歴の合計最大文字数 */
    totalChars: number;
    /** 過去のアシスタント返答 1 件あたりの最大文字数（履歴として送るとき） */
    assistantChars: number;
  };
  /** 1 回の返答の最大出力トークン（モード別） */
  maxOutputTokens: Record<Mode, number>;
  rateLimit: {
    /** IP あたり 1 分間の上限（0 で無効） */
    perMinute: number;
    /** IP あたり 1 日の上限（0 で無効） */
    perDay: number;
  };
  /** 検索・出典に使ってよいドメイン（サブドメインも含む） */
  allowedDomains: string[];
  workersAi: { model: string };
  /** OPENROUTER_API_KEY があるときだけ設定される */
  openRouter: { apiKey: string; model: string; webSearch: boolean } | null;
};

export const DEFAULT_WORKERS_AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-6-luna";

export function parseDomains(value: string | undefined): string[] {
  return (value ?? "go.jp,lg.jp")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^\*\./, ""))
    .filter(Boolean);
}

export function loadConfig(env: Env = process.env): ChatConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  return {
    limits: {
      bodyBytes: 64 * 1024,
      // 履歴はトークン消費の主因なので控えめに（直近の文脈があれば会話は成り立つ）
      messages: Math.max(1, intFrom(env, "MAX_HISTORY_MESSAGES", 10)),
      messageChars: Math.max(1, intFrom(env, "MAX_INPUT_CHARS", 2000)),
      totalChars: Math.max(1, intFrom(env, "MAX_HISTORY_CHARS", 6000)),
      assistantChars: Math.max(1, intFrom(env, "MAX_ASSISTANT_CHARS", 800)),
    },
    // 通常の相談は短く答える指示なので上限も小さく、支援制度の一覧は長くなるので大きく
    maxOutputTokens: {
      chat: Math.max(64, intFrom(env, "MAX_OUTPUT_TOKENS_CHAT", 1200)),
      support: Math.max(64, intFrom(env, "MAX_OUTPUT_TOKENS_SUPPORT", 2400)),
    },
    rateLimit: {
      perMinute: intFrom(env, "RATE_LIMIT_PER_MINUTE", 10),
      perDay: intFrom(env, "RATE_LIMIT_PER_DAY", 100),
    },
    allowedDomains: parseDomains(env.SEARCH_ALLOWED_DOMAINS),
    workersAi: { model: env.WORKERS_AI_MODEL?.trim() || DEFAULT_WORKERS_AI_MODEL },
    openRouter: apiKey
      ? {
          apiKey,
          // 互換のため、モデル名に ":online" が付いていたら外す（検索はプラグインで明示的に設定する）
          model: (env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL).replace(/:online$/, ""),
          webSearch: env.OPENROUTER_WEB_SEARCH !== "false",
        }
      : null,
  };
}
