import { describe, expect, it } from "vitest";
import { loadConfig } from "@/lib/chat/config";
import { RateLimiter, clientIp, isCrossSite, parseMessages } from "@/lib/chat/guard";

const limits = loadConfig({}).limits;
const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });

describe("parseMessages", () => {
  it("正しい会話をそのまま受け入れる", () => {
    const r = parseMessages([u("こんにちは"), a("どうぞ"), u("住民票は？")], limits);
    expect(r).toEqual({ ok: true, messages: [u("こんにちは"), a("どうぞ"), u("住民票は？")] });
  });

  it.each([
    ["配列でない", "hello"],
    ["role が不正", [{ role: "system", content: "x" }]],
    ["content が文字列でない", [{ role: "user", content: [{ type: "image_url" }] }]],
    ["要素が null", [null]],
  ])("%s場合は拒否する", (_label, input) => {
    expect(parseMessages(input, limits)).toEqual({ ok: false, error: "リクエストの形式が不正です。" });
  });

  it("長すぎるユーザー発言は拒否する", () => {
    const r = parseMessages([u("あ".repeat(limits.messageChars + 1))], limits);
    expect(r.ok).toBe(false);
  });

  it("長いアシスタント発言は切り詰めて受け入れる", () => {
    const r = parseMessages([u("q"), a("x".repeat(limits.messageChars * 3)), u("q2")], limits);
    expect(r.ok && r.messages[1].content.length).toBe(limits.messageChars * 2);
  });

  it("空白だけの発言は捨てる", () => {
    const r = parseMessages([u("  "), u("質問")], limits);
    expect(r).toEqual({ ok: true, messages: [u("質問")] });
  });

  it("件数の上限を超えたら古い方から捨て、先頭をユーザー発言にそろえる", () => {
    const small = { ...limits, messages: 2 };
    const r = parseMessages([u("1"), a("2"), u("3")], small);
    // 末尾 2 件は [a, u] → 先頭のアシスタント発言を捨てる
    expect(r).toEqual({ ok: true, messages: [u("3")] });
  });

  it("総文字数の上限を超えたら古い方から捨てる", () => {
    const small = { ...limits, totalChars: 5 };
    const r = parseMessages([u("aaaa"), a("bb"), u("cc")], small);
    expect(r).toEqual({ ok: true, messages: [u("cc")] });
  });

  it("最後がアシスタント発言なら拒否する", () => {
    expect(parseMessages([u("q"), a("ans")], limits).ok).toBe(false);
  });
});

describe("isCrossSite", () => {
  const req = (headers: Record<string, string>) => new Request("https://bot.example/api/chat", { headers });

  it("Sec-Fetch-Site: cross-site は拒否", () => {
    expect(isCrossSite(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });
  it("Origin が同じホストなら許可", () => {
    expect(isCrossSite(req({ origin: "https://bot.example", host: "bot.example" }))).toBe(false);
  });
  it("Origin が別ホストなら拒否", () => {
    expect(isCrossSite(req({ origin: "https://evil.example", host: "bot.example" }))).toBe(true);
  });
  it("Origin がなければ許可（curl など。レート制限で防ぐ）", () => {
    expect(isCrossSite(req({}))).toBe(false);
  });
  it("Origin が壊れていれば拒否", () => {
    expect(isCrossSite(req({ origin: "::::", host: "bot.example" }))).toBe(true);
  });
});

describe("clientIp", () => {
  it("cf-connecting-ip を最優先する", () => {
    const r = new Request("https://x", {
      headers: { "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2, 3.3.3.3" },
    });
    expect(clientIp(r)).toBe("1.1.1.1");
  });
  it("x-forwarded-for の先頭を使う", () => {
    const r = new Request("https://x", { headers: { "x-forwarded-for": "2.2.2.2, 3.3.3.3" } });
    expect(clientIp(r)).toBe("2.2.2.2");
  });
  it("何もなければ unknown", () => {
    expect(clientIp(new Request("https://x"))).toBe("unknown");
  });
});

describe("RateLimiter", () => {
  const t0 = 1_000_000;

  it("1 分あたりの上限を超えたら 429 相当を返し、1 分後に戻る", () => {
    const rl = new RateLimiter();
    const lim = { perMinute: 2, perDay: 0 };
    expect(rl.check("ip", lim, t0).ok).toBe(true);
    expect(rl.check("ip", lim, t0 + 1).ok).toBe(true);
    const r = rl.check("ip", lim, t0 + 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.retryAfter).toBe(60);
    expect(rl.check("ip", lim, t0 + 60_000).ok).toBe(true);
  });

  it("1 日の上限は 1 分の窓をまたいでも効く", () => {
    const rl = new RateLimiter();
    const lim = { perMinute: 0, perDay: 2 };
    rl.check("ip", lim, t0);
    rl.check("ip", lim, t0 + 120_000);
    const r = rl.check("ip", lim, t0 + 240_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("本日の利用上限");
  });

  it("キーごとに独立して数える", () => {
    const rl = new RateLimiter();
    const lim = { perMinute: 1, perDay: 0 };
    expect(rl.check("a", lim, t0).ok).toBe(true);
    expect(rl.check("b", lim, t0).ok).toBe(true);
    expect(rl.check("a", lim, t0).ok).toBe(false);
  });

  it("両方 0 なら無効", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 100; i++) expect(rl.check("ip", { perMinute: 0, perDay: 0 }, t0).ok).toBe(true);
    expect(rl.size).toBe(0);
  });

  it("キー数の上限を超えないようにメモリを捨てる", () => {
    const rl = new RateLimiter(10);
    const lim = { perMinute: 5, perDay: 5 };
    for (let i = 0; i < 50; i++) rl.check(`ip${i}`, lim, t0);
    expect(rl.size).toBeLessThanOrEqual(10);
  });
});
