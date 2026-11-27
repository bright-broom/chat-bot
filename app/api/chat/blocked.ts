// 回答しない話題（特定の人物についての質問など）
//
// ユーザーの発言にここに挙げた名前が含まれていたら、LLM を呼ばずに定型文だけを返す。
// 代名詞などで間接的に指す質問はシステムプロンプト側（BLOCKED_TOPIC_RULE）で断らせる。

// 表記ゆれ（漢字・ひらがな・カタカナ・ローマ字、姓名の順序）を正規化後の形で並べる
// 例: "山田太郎", "やまだたろう", "yamadataro"（正規化後の形で書く）
const BLOCKED_NAMES: string[] = [];

export const BLOCKED_REPLY =
  "申し訳ありませんが、そのご質問にはお答えできません。行政手続きや公的制度などについてご相談ください。";

// 回答させたくない人物・話題がある場合は、ここにシステムプロンプト用の指示文を書く（空なら何も足さない）
export const BLOCKED_TOPIC_RULE = "";

// 全角・半角、大文字・小文字、空白や記号（「山田 太郎」「Yamada-Taro」など）の違いを吸収する
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

export function mentionsBlockedTopic(text: string): boolean {
  if (BLOCKED_NAMES.length === 0) return false;
  const t = normalize(text);
  return BLOCKED_NAMES.some((name) => t.includes(name));
}
