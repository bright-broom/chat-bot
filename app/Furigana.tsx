"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { annotate, type Segment, type Tokenizer } from "../lib/furigana-core";

// 振り仮名（HTML の <ruby> 要素）表示。
// 読みはブラウザ上で kuromoji（形態素解析）を使って求める。辞書（約 17MB）は
// public/kuromoji-dict/ から、振り仮名を初めてオンにしたときだけ読み込む。
// 同じ文字列の結果はキャッシュし、短時間に要求された文字列はまとめて処理する。

const DICT_PATH = "/kuromoji-dict/";
let tokenizerPromise: Promise<Tokenizer> | null = null;

function getTokenizer(): Promise<Tokenizer> {
  tokenizerPromise ??= import("kuromoji/build/kuromoji.js").then(
    ({ default: kuromoji }) =>
      new Promise<Tokenizer>((resolve, reject) => {
        kuromoji.builder({ dicPath: DICT_PATH }).build((err, tokenizer) => {
          if (err) {
            tokenizerPromise = null;
            reject(err);
          } else resolve(tokenizer);
        });
      }),
  );
  return tokenizerPromise;
}

export const FuriganaContext = createContext(false);

const HAS_KANJI = /[\p{Script=Han}々〆ヶ]/u;

const cache = new Map<string, Segment[]>();
const queued = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function flush() {
  timer = null;
  const texts = [...queued];
  queued.clear();
  texts.forEach((t) => inflight.add(t));
  try {
    const tokenizer = await getTokenizer();
    texts.forEach((t) => cache.set(t, annotate(tokenizer, t)));
  } catch (err) {
    console.error("振り仮名の取得に失敗しました", err);
    // 失敗した文字列は振り仮名なしで表示し、再要求を繰り返さない
    texts.forEach((t) => cache.set(t, [[t]]));
  } finally {
    texts.forEach((t) => inflight.delete(t));
    listeners.forEach((fn) => fn());
  }
}

function request(text: string) {
  if (cache.has(text) || queued.has(text) || inflight.has(text)) return;
  queued.add(text);
  timer ??= setTimeout(flush, 20);
}

function Annotated({ text }: { text: string }) {
  const segments = useSyncExternalStore(
    subscribe,
    () => cache.get(text),
    () => undefined,
  );
  useEffect(() => {
    request(text);
  }, [text]);

  if (!segments) return <>{text}</>;
  return (
    <>
      {segments.map(([base, reading], i) =>
        reading ? (
          <ruby key={i}>
            {base}
            <rp>(</rp>
            <rt>{reading}</rt>
            <rp>)</rp>
          </ruby>
        ) : (
          base
        ),
      )}
    </>
  );
}

/** 振り仮名が有効なら漢字にルビを付けて表示する */
export function FuriganaText({ text }: { text: string }) {
  const enabled = useContext(FuriganaContext);
  if (!enabled || !HAS_KANJI.test(text)) return <>{text}</>;
  return <Annotated text={text} />;
}
