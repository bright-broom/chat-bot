import { describe, expect, it } from "vitest";
import {
  MAX_CACHEABLE_QUESTION_CHARS,
  cacheKey,
  createEdgeCache,
  dayJst,
  isCacheable,
  normalizeQuestion,
} from "@/lib/chat/cache";

const base = {
  promptVersion: "v1",
  model: "m",
  mode: "chat" as const,
  easyJapanese: false,
  day: "2026-11-28",
  question: "引っ越したときに必要な手続きは？",
};

describe("isCacheable", () => {
  const u = (content: string) => ({ role: "user", content });
  it("履歴のない短い 1 問目だけを対象にする", () => {
    expect(isCacheable([u("児童手当の申請方法を教えて")])).toBe(true);
    expect(isCacheable([u("a"), { role: "assistant", content: "b" }, u("c")])).toBe(false);
    expect(isCacheable([u("あ".repeat(MAX_CACHEABLE_QUESTION_CHARS + 1))])).toBe(false);
    expect(isCacheable([u("？？")])).toBe(false);
  });
});

describe("normalizeQuestion", () => {
  it("全角半角・空白・末尾の記号の違いをそろえる", () => {
    expect(normalizeQuestion("　マイナンバーカード  の作り方は？")).toBe("マイナンバーカード の作り方は");
    expect(normalizeQuestion("ＡＢＣ?")).toBe("ABC");
  });
});

describe("cacheKey", () => {
  it("表記ゆれは同じキーになる", async () => {
    expect(await cacheKey(base)).toBe(await cacheKey({ ...base, question: " 引っ越したときに必要な手続きは?" }));
  });
  it.each([
    ["プロンプトの版", { promptVersion: "v2" }],
    ["モデル", { model: "other" }],
    ["モード", { mode: "support" as const }],
    ["やさしい日本語", { easyJapanese: true }],
    ["日付", { day: "2026-11-29" }],
    ["質問", { question: "別の質問" }],
  ])("%s が違えば別のキー", async (_label, diff) => {
    expect(await cacheKey(base)).not.toBe(await cacheKey({ ...base, ...diff }));
  });
  it("キーは 16 進の SHA-256（質問文そのものは含まない）", async () => {
    const k = await cacheKey(base);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("dayJst", () => {
  it("日本時間の日付を返す", () => {
    expect(dayJst(new Date("2026-11-27T15:30:00Z"))).toBe("2026-11-28");
  });
});

describe("createEdgeCache", () => {
  it("Cache API に保存して取り出せる", async () => {
    const store = new Map<string, Response>();
    const fake = {
      match: async (url: string) => store.get(url)?.clone(),
      put: async (url: string, res: Response) => void store.set(url, res),
    } as unknown as Cache;
    const c = createEdgeCache(fake, 60);
    expect(await c.get("k")).toBeNull();
    await c.put("k", "回答");
    expect(await c.get("k")).toBe("回答");
    expect([...store.values()][0].headers.get("Cache-Control")).toBe("public, max-age=60");
  });
});
