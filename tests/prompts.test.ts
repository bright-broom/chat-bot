import { describe, expect, it } from "vitest";
import { type PromptContext, systemPrompt, todayJst } from "@/lib/chat/prompts";

const base: PromptContext = { webSearch: false, allowedDomains: ["go.jp", "lg.jp"], today: "2026年11月28日(土)" };

describe("systemPrompt", () => {
  it("今日の日付と自己紹介（ブルーム）を含む", () => {
    const p = systemPrompt("chat", false, base);
    expect(p).toContain("2026年11月28日(土)");
    expect(p).toContain("ブルーム");
    expect(p).toContain("BrightBroom");
  });

  it("Web 検索なしのときは出典 URL を推測させない", () => {
    const p = systemPrompt("chat", false, base);
    expect(p).toContain("Web 検索は使えません");
    expect(p).not.toContain("go.jp / lg.jp ドメイン");
  });

  it("Web 検索ありのときは許可ドメインを明示する", () => {
    const p = systemPrompt("chat", false, { ...base, webSearch: true });
    expect(p).toContain("go.jp / lg.jp ドメイン");
    expect(p).not.toContain("Web 検索は使えません");
  });

  it("支援制度モードでは聞き取りの指示と個人情報の制限を含む", () => {
    const p = systemPrompt("support", false, base);
    expect(p).toContain("使える支援制度を探す");
    expect(p).toContain("マイナンバー");
    expect(p).not.toContain("1回の返答は基本 2〜4 文");
  });

  it("やさしい日本語モードの指示は希望したときだけ付く", () => {
    expect(systemPrompt("chat", true, base)).toContain("やさしい日本語モード");
    expect(systemPrompt("chat", false, base)).not.toContain("やさしい日本語モード");
  });

  it("空行（空の指示）を含まない", () => {
    expect(systemPrompt("chat", false, base)).not.toMatch(/\n\n/);
  });
});

describe("todayJst", () => {
  it("UTC の夜は日本時間の翌日になる", () => {
    expect(todayJst(new Date("2026-11-27T16:00:00Z"))).toContain("28");
  });
});
