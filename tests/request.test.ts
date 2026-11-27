import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/chat/config";
import { parseChatRequest } from "@/lib/chat/request";

const limits = loadConfig({}).limits;
const messages = [{ role: "user", content: "質問" }];

describe("parseChatRequest", () => {
  it("既定は通常モード・やさしい日本語なし", () => {
    expect(parseChatRequest({ messages }, limits)).toEqual({
      ok: true,
      value: { messages, mode: "chat", easyJapanese: false },
    });
  });
  it("支援制度モードとやさしい日本語を受け取る", () => {
    const r = parseChatRequest({ messages, mode: "support", easyJapanese: true }, limits);
    expect(r.ok && r.value).toMatchObject({ mode: "support", easyJapanese: true });
  });
  it("未知のモードや真偽値でない値は安全側に倒す", () => {
    const r = parseChatRequest({ messages, mode: "admin", easyJapanese: "yes" }, limits);
    expect(r.ok && r.value).toMatchObject({ mode: "chat", easyJapanese: false });
  });
  it.each([null, "x", 1, {}])("本文が不正なら拒否: %s", (raw) => {
    expect(parseChatRequest(raw, limits).ok).toBe(false);
  });
});
