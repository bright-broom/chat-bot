import { describe, expect, it, vi } from "vitest";
import { ChatRequestError, MAX_SENT_MESSAGES, isAbortError, streamChat } from "@/lib/client/chat-stream";

const payload = { messages: [{ role: "user" as const, content: "質問" }], mode: "chat" as const, easyJapanese: false };

function bytesResponse(parts: Uint8Array[], init?: ResponseInit) {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(p);
        c.close();
      },
    }),
    init,
  );
}

describe("streamChat", () => {
  it("届くたびに全文を通知し、最後に全文を返す", async () => {
    const enc = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue(bytesResponse([enc.encode("こん"), enc.encode("にちは")]));
    const onText = vi.fn();
    expect(await streamChat(payload, { onText, fetch: fetchMock })).toBe("こんにちは");
    expect(onText.mock.calls.map((c) => c[0])).toEqual(["こん", "こんにちは"]);
  });

  it("最後のバイトで文字が完成する場合も文字化けしない", async () => {
    const b = new TextEncoder().encode("案内");
    const fetchMock = vi.fn().mockResolvedValue(bytesResponse([b.slice(0, 4), b.slice(4)]));
    expect(await streamChat(payload, { onText: () => {}, fetch: fetchMock })).toBe("案内");
  });

  it("送る履歴を上限で切り、余計なプロパティを落とす", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(""));
    const many = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, content: `m${i}`, error: true }));
    await streamChat({ ...payload, messages: many }, { onText: () => {}, fetch: fetchMock });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(sent).toHaveLength(MAX_SENT_MESSAGES);
    expect(sent[0]).toEqual({ role: "user", content: `m${30 - MAX_SENT_MESSAGES}` });
  });

  it("エラー応答は本文をメッセージにした ChatRequestError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("混み合っています。", { status: 429 }));
    const err = await streamChat(payload, { onText: () => {}, fetch: fetchMock }).catch((e) => e);
    expect(err).toBeInstanceOf(ChatRequestError);
    expect(err).toMatchObject({ status: 429, message: "混み合っています。" });
  });

  it("中断は AbortError として判別できる", async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      ),
    );
    const p = streamChat(payload, { onText: () => {}, fetch: fetchMock as unknown as typeof fetch, signal: ctrl.signal });
    ctrl.abort();
    expect(isAbortError(await p.catch((e) => e))).toBe(true);
  });
});
