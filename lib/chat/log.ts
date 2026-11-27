// 構造化ログ。Cloudflare Workers Logs で event 名やフィールドで検索・集計できるよう JSON 1 行で出す。
// 利用者の入力本文や API キーは絶対に渡さないこと。

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: "info" | "warn" | "error", event: string, fields: Fields) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields: Fields = {}) => emit("info", event, fields),
  warn: (event: string, fields: Fields = {}) => emit("warn", event, fields),
  error: (event: string, fields: Fields = {}) => emit("error", event, fields),
};

/** 例外を、ログに出してよい短い文字列にする */
export function errorSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 300);
  return String(err).slice(0, 300);
}
