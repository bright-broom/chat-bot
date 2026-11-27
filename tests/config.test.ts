import { describe, expect, it } from "vitest";
import { DEFAULT_WORKERS_AI_MODEL, loadConfig, parseDomains } from "@/lib/chat/config";

describe("loadConfig", () => {
  it("何も設定しなければ Workers AI と既定の上限を使う", () => {
    const c = loadConfig({});
    expect(c.openRouter).toBeNull();
    expect(c.workersAi.model).toBe(DEFAULT_WORKERS_AI_MODEL);
    expect(c.limits).toMatchObject({ messages: 20, messageChars: 2000, totalChars: 12000 });
    expect(c.rateLimit).toEqual({ perMinute: 10, perDay: 100 });
    expect(c.allowedDomains).toEqual(["go.jp", "lg.jp"]);
  });

  it("OPENROUTER_API_KEY があれば OpenRouter を有効にし、:online を外す", () => {
    const c = loadConfig({ OPENROUTER_API_KEY: " sk-test ", OPENROUTER_MODEL: "foo/bar:online" });
    expect(c.openRouter).toEqual({ apiKey: "sk-test", model: "foo/bar", webSearch: true });
  });

  it("OPENROUTER_WEB_SEARCH=false で検索を切る", () => {
    expect(loadConfig({ OPENROUTER_API_KEY: "k", OPENROUTER_WEB_SEARCH: "false" }).openRouter?.webSearch).toBe(false);
  });

  it("不正な数値は既定値、0 はそのまま（レート制限の無効化）", () => {
    const c = loadConfig({ RATE_LIMIT_PER_MINUTE: "abc", RATE_LIMIT_PER_DAY: "0", MAX_INPUT_CHARS: "0" });
    expect(c.rateLimit).toEqual({ perMinute: 10, perDay: 0 });
    // 文字数上限は 0 にできない（最低 1）
    expect(c.limits.messageChars).toBe(1);
  });
});

describe("parseDomains", () => {
  it("空白・大文字・ワイルドカードを正規化する", () => {
    expect(parseDomains(" Go.JP , *.lg.jp ,, ")).toEqual(["go.jp", "lg.jp"]);
  });
});
