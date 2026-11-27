// ブラウザから /api/chat を呼び、ストリーミングで届く回答を受け取る
import type { ChatMessage, Mode } from "../chat/types";

export type ChatPayload = { messages: ChatMessage[]; mode: Mode; easyJapanese: boolean };

/** サーバーが返したエラー（本文は利用者にそのまま見せてよい日本語の文言） */
export class ChatRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message || "エラーが発生しました。");
    this.name = "ChatRequestError";
  }
}

/** 送信する履歴の上限（サーバー側でも同じく切り詰める） */
export const MAX_SENT_MESSAGES = 10;

export type StreamChatOptions = {
  /** これまでに届いた回答全文を受け取る（届くたびに呼ばれる） */
  onText: (text: string) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  endpoint?: string;
};

/**
 * 会話を送り、回答全文を返す。途中経過は onText で受け取る。
 * signal で中断した場合は AbortError を投げる。
 */
export async function streamChat(payload: ChatPayload, options: StreamChatOptions): Promise<string> {
  const { onText, signal, fetch: doFetch = fetch, endpoint = "/api/chat" } = options;
  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      ...payload,
      messages: payload.messages.slice(-MAX_SENT_MESSAGES).map(({ role, content }) => ({ role, content })),
    }),
  });

  if (!res.ok || !res.body) {
    throw new ChatRequestError(res.status, await res.text().catch(() => ""));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let reply = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    reply += decoder.decode(value, { stream: true });
    onText(reply);
  }
  // マルチバイト文字の途中で区切られた残りのバイトを確定させる
  const rest = decoder.decode();
  if (rest) {
    reply += rest;
    onText(reply);
  }
  return reply;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === "AbortError" : (err as { name?: string })?.name === "AbortError";
}
