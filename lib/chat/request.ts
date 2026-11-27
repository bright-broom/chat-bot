// /api/chat のリクエスト本文を検証して、型の付いた値にする
import type { ChatConfig } from "./config";
import { parseMessages } from "./guard";
import type { ChatMessage, Mode } from "./types";

export type ChatRequest = { messages: ChatMessage[]; mode: Mode; easyJapanese: boolean };

export type ParsedRequest = { ok: true; value: ChatRequest } | { ok: false; error: string };

export function parseChatRequest(raw: unknown, limits: ChatConfig["limits"]): ParsedRequest {
  if (!raw || typeof raw !== "object") return { ok: false, error: "リクエストの形式が不正です。" };
  const body = raw as { messages?: unknown; mode?: unknown; easyJapanese?: unknown };

  const parsed = parseMessages(body.messages, limits);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    value: {
      messages: parsed.messages,
      // 未知の値は通常モードとして扱う
      mode: body.mode === "support" ? "support" : "chat",
      easyJapanese: body.easyJapanese === true,
    },
  };
}
