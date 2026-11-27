import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/lib/chat/config";
import { UpstreamError, selectProvider } from "@/lib/chat/llm";
import { OPENROUTER_URL, createOpenRouterProvider } from "@/lib/chat/llm/openrouter";
import { createWorkersAiProvider } from "@/lib/chat/llm/workers-ai";

const msgs = [{ role: "user" as const, content: "質問" }];
const okStream = () => new ReadableStream<Uint8Array>({ start: (c) => c.close() });

describe("selectProvider", () => {
  const ai = { run: vi.fn() };
  it("キーがなければ Workers AI", () => {
    expect(selectProvider(loadConfig({}), () => ai)?.name).toBe("workers-ai");
  });
  it("キーがあれば OpenRouter（Workers AI は参照しない）", () => {
    const getAi = vi.fn();
    expect(selectProvider(loadConfig({ OPENROUTER_API_KEY: "k" }), getAi)?.name).toBe("openrouter");
    expect(getAi).not.toHaveBeenCalled();
  });
  it("どちらも使えなければ null", () => {
    expect(selectProvider(loadConfig({}), () => undefined)).toBeNull();
  });
});

describe("Workers AI", () => {
  it("ストリーミングで呼び出す", async () => {
    const stream = okStream();
    const run = vi.fn().mockResolvedValue(stream);
    const p = createWorkersAiProvider({ run }, "@cf/test/model");
    expect(await p.stream(msgs)).toBe(stream);
    expect(run).toHaveBeenCalledWith("@cf/test/model", expect.objectContaining({ messages: msgs, stream: true }));
    expect(p.webSearch).toBe(false);
  });
  it("呼び出し失敗（無料枠超過など）は 503 の UpstreamError", async () => {
    const p = createWorkersAiProvider({ run: vi.fn().mockRejectedValue(new Error("quota")) }, "m");
    await expect(p.stream(msgs)).rejects.toMatchObject({ status: 503, detail: "quota" });
  });
  it("ストリームでない応答は 502", async () => {
    const p = createWorkersAiProvider({ run: vi.fn().mockResolvedValue({ response: "x" }) }, "m");
    await expect(p.stream(msgs)).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("OpenRouter", () => {
  const base = { apiKey: "sk-secret", model: "m", allowedDomains: ["go.jp"] };

  it("学習に使わないプロバイダー指定と、許可ドメインに限った検索で呼び出す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(okStream()));
    const p = createOpenRouterProvider({ ...base, webSearch: true, fetch: fetchMock });
    await p.stream(msgs);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENROUTER_URL);
    expect(init.headers.Authorization).toBe("Bearer sk-secret");
    const body = JSON.parse(init.body);
    expect(body.provider).toEqual({ data_collection: "deny" });
    expect(body.plugins).toEqual([{ id: "web", include_domains: ["go.jp", "*.go.jp"] }]);
  });

  it("検索を切ったときは plugins を送らない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(okStream()));
    await createOpenRouterProvider({ ...base, webSearch: false, fetch: fetchMock }).stream(msgs);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).plugins).toBeUndefined();
  });

  it("エラー詳細は detail に入れ、利用者向けの文言は別にする", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("account xyz over quota", { status: 429 }));
    const p = createOpenRouterProvider({ ...base, webSearch: false, fetch: fetchMock });
    const err = await p.stream(msgs).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.userMessage).toBe("混み合っています。しばらく待ってからお試しください。");
    expect(err.userMessage).not.toContain("xyz");
    expect(err.detail).toContain("xyz");
  });
});
