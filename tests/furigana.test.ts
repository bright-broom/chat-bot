import { describe, expect, it } from "vitest";
import { type Tokenizer, annotate } from "@/lib/furigana-core";

// kuromoji の代わりに、決めた分割と読みを返す簡易トークナイザー
function fakeTokenizer(tokens: [surface: string, reading: string][]): Tokenizer {
  return {
    tokenize: () => tokens.map(([surface_form, reading]) => ({ surface_form, reading })),
  } as unknown as Tokenizer;
}

describe("annotate", () => {
  it("送り仮名を読みから切り離す", () => {
    expect(annotate(fakeTokenizer([["食べる", "タベル"]]), "")).toEqual([["食", "た"], ["べる"]]);
  });
  it("漢字のない部分はまとめて 1 つにする", () => {
    expect(annotate(fakeTokenizer([["市役所", "シヤクショ"], ["で", "デ"], ["す", "ス"]]), "")).toEqual([
      ["市役所", "しやくしょ"],
      ["です"],
    ]);
  });
  it("数字の後の「月」は「がつ」と読む", () => {
    expect(annotate(fakeTokenizer([["3", "*"], ["月", "ツキ"]]), "")).toEqual([["3"], ["月", "がつ"]]);
  });
  it("読みが合わない場合は語全体にルビを付ける", () => {
    expect(annotate(fakeTokenizer([["今日は", "キョウワ"]]), "")).toEqual([["今日は", "きょうわ"]]);
  });
});
