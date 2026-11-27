import { describe, expect, it } from "vitest";
import { includeDomains, isAllowedUrl, safeCitationUrl } from "@/lib/chat/domains";

const allowed = ["go.jp", "lg.jp"];

describe("isAllowedUrl", () => {
  it.each([
    ["https://www.soumu.go.jp/a", true],
    ["https://go.jp/", true],
    ["https://www.city.shinagawa.lg.jp/", true],
    ["https://example.com/", false],
    ["https://notgo.jp/", false], // 末尾一致だけで判定しない
    ["https://go.jp.evil.com/", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isAllowedUrl(url, allowed)).toBe(expected);
  });
});

describe("safeCitationUrl", () => {
  it("http(s) 以外は捨てる", () => {
    expect(safeCitationUrl("javascript:alert(1)")).toBeNull();
    expect(safeCitationUrl("ftp://x.go.jp/")).toBeNull();
  });
  it("Markdown を壊す括弧をエスケープする", () => {
    expect(safeCitationUrl("https://a.go.jp/x_(y)")).toBe("https://a.go.jp/x_%28y%29");
  });
});

describe("includeDomains", () => {
  it("ドメイン自身とサブドメインを並べる", () => {
    expect(includeDomains(["go.jp"])).toEqual(["go.jp", "*.go.jp"]);
  });
});
