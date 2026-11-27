import { describe, expect, it, vi } from "vitest";
import { STREAM_ERROR_TEXT, citationLabel, formatCitations, parseSseLine, toTextStream } from "@/lib/chat/sse";

const enc = new TextEncoder();

/** 文字列（またはバイト列）の配列を、その区切りのまま流すストリームにする */
function streamOf(parts: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const p of parts) c.enqueue(typeof p === "string" ? enc.encode(p) : p);
      c.close();
    },
  });
}

async function readAll(s: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(s).text();
}

const openai = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe("parseSseLine", () => {
  it("OpenAI 互換形式の本文を取り出す", () => {
    expect(parseSseLine(openai("やあ").trim())).toEqual({ text: "やあ", citations: [] });
  });
  it("Workers AI の従来形式（response）を取り出す", () => {
    expect(parseSseLine('data: {"response":"こんにちは"}')).toEqual({ text: "こんにちは", citations: [] });
  });
  it("思考（reasoning）だけのチャンクは本文にしない", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "考え中", content: null } }] })}`;
    expect(parseSseLine(line)).toEqual({ text: "", citations: [] });
  });
  it.each(["", ": OPENROUTER PROCESSING", "data: [DONE]", "data: {壊れたJSON", "event: ping"])(
    "本文でない行は無視する: %s",
    (line) => {
      expect(parseSseLine(line)).toBeNull();
    },
  );
  it("エラーを返す", () => {
    expect(parseSseLine('data: {"error":{"message":"quota"}}')?.error).toBe("quota");
  });
});

describe("toTextStream", () => {
  it("チャンクの途中で行が分かれても正しくつなぐ", async () => {
    const full = openai("前半") + openai("後半");
    const parts = [full.slice(0, 7), full.slice(7, 30), full.slice(30)];
    expect(await readAll(toTextStream(streamOf(parts)))).toBe("前半後半");
  });

  it("最後の行が改行で終わっていなくても取りこぼさない", async () => {
    const last = `data: ${JSON.stringify({ response: "最後" })}`; // 改行なし
    expect(await readAll(toTextStream(streamOf([openai("最初"), last])))).toBe("最初最後");
  });

  it("マルチバイト文字がバイト単位で分割されても文字化けしない", async () => {
    const bytes = enc.encode(openai("日本語"));
    const cut = bytes.indexOf(0xe6) + 1; // 「日」の 1 バイト目の直後で切る
    expect(await readAll(toTextStream(streamOf([bytes.slice(0, cut), bytes.slice(cut)])))).toBe("日本語");
  });

  it("許可された出典だけを重複なく末尾に付ける", async () => {
    const withCitations = `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            content: "本文",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://a.go.jp/x", title: "総務省" } },
              { type: "url_citation", url_citation: { url: "https://a.go.jp/x", title: "重複" } },
              { type: "url_citation", url_citation: { url: "https://evil.example/", title: "悪い" } },
            ],
          },
        },
      ],
    })}\n\n`;
    const out = await readAll(
      toTextStream(streamOf([withCitations]), {
        acceptCitation: (url) => (url.includes(".go.jp") ? url : null),
      }),
    );
    expect(out).toBe("本文\n\n出典: [総務省](https://a.go.jp/x)");
  });

  it("上流のエラーは利用者向けの文言に置き換え、詳細はコールバックで渡す", async () => {
    const onUpstreamError = vi.fn();
    const out = await readAll(
      toTextStream(streamOf([openai("途中まで"), 'data: {"error":{"message":"rate limited"}}\n\n']), {
        onUpstreamError,
      }),
    );
    expect(out).toBe(`途中まで${STREAM_ERROR_TEXT}`);
    expect(onUpstreamError).toHaveBeenCalledWith("rate limited");
  });

  it("読み取り中の例外でもストリームを閉じる", async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error("socket closed"));
      },
    });
    const onUpstreamError = vi.fn();
    expect(await readAll(toTextStream(broken, { onUpstreamError }))).toBe(STREAM_ERROR_TEXT);
    expect(onUpstreamError).toHaveBeenCalledWith("socket closed");
  });

  it("クライアントが中断したら上流の読み取りも止める", async () => {
    const cancel = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({ pull() {}, cancel });
    const out = toTextStream(upstream);
    await out.cancel("client gone");
    expect(cancel).toHaveBeenCalledWith("client gone");
  });
});

describe("出典の整形", () => {
  it("長いタイトルは短縮し、タイトルがなければドメインを使う", () => {
    expect(citationLabel({ url: "https://x", title: "あ".repeat(40) })).toBe(`${"あ".repeat(29)}…`);
    expect(citationLabel({ url: "https://www.mhlw.go.jp/a" })).toBe("mhlw.go.jp");
  });
  it("最大件数で切る", () => {
    const cs = [1, 2, 3, 4].map((i) => ({ url: `https://a${i}.go.jp/`, title: `t${i}` }));
    expect(formatCitations(cs, 2)).toBe("\n\n出典: [t1](https://a1.go.jp/) · [t2](https://a2.go.jp/)");
    expect(formatCitations([])).toBe("");
  });
});
