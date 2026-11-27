import type { Tokenizer as KTokenizer, IpadicFeatures } from "kuromoji";

// 振り仮名の付与: kuromoji（形態素解析）の結果から、
// [表記, 読み?] の区切り列を作る。読みは漢字部分にだけ付ける。
//   例: "食べる" → [["食", "た"], ["べる"]]
// ブラウザ側（app/Furigana.tsx）で使う。Cloudflare Workers では辞書（約 17MB）を
// 同梱・展開できないため、サーバーではなくブラウザで解析する。

export type Segment = [string] | [string, string];
export type Tokenizer = KTokenizer<IpadicFeatures>;

const KANJI = /[\p{Script=Han}々〆ヶ]/u;
const KANJI_RUN = /[\p{Script=Han}々〆ヶ]+/gu;

function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 送り仮名を読みから切り離し、漢字の連なりごとに読みを割り当てる
function splitOkurigana(surface: string, reading: string): Segment[] {
  const parts: { text: string; kanji: boolean }[] = [];
  let last = 0;
  for (const m of surface.matchAll(KANJI_RUN)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: surface.slice(last, start), kanji: false });
    parts.push({ text: m[0], kanji: true });
    last = start + m[0].length;
  }
  if (last < surface.length) parts.push({ text: surface.slice(last), kanji: false });

  const pattern = parts
    .map((p) => (p.kanji ? "(.+?)" : escapeRegExp(toHiragana(p.text))))
    .join("");
  const m = reading.match(new RegExp(`^${pattern}$`, "u"));
  if (!m) return [[surface, reading]];

  let g = 1;
  return parts.map((p) => (p.kanji ? [p.text, m[g++]] : [p.text]));
}

export function annotate(tokenizer: Tokenizer, text: string): Segment[] {
  const out: Segment[] = [];
  const pushPlain = (s: string) => {
    const prev = out[out.length - 1];
    if (prev && prev.length === 1) prev[0] += s;
    else out.push([s]);
  };
  let prevSurface = "";
  for (const t of tokenizer.tokenize(text)) {
    const surface = t.surface_form;
    let reading = t.reading && t.reading !== "*" ? toHiragana(t.reading) : "";
    // 算用数字の後の「月」は辞書上「つき」になるため「がつ」に直す（例: 3月）
    if (surface === "月" && /^[0-9０-９]+$/.test(prevSurface)) reading = "がつ";
    prevSurface = surface;
    if (!KANJI.test(surface) || !reading || reading === surface) {
      pushPlain(surface);
      continue;
    }
    for (const seg of splitOkurigana(surface, reading)) {
      if (seg.length === 1) pushPlain(seg[0]);
      else out.push(seg);
    }
  }
  return out;
}
