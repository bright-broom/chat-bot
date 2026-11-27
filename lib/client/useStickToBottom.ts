"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

/** 末尾からこの距離（px）以内なら「最新を見ている」とみなす */
const NEAR_BOTTOM_PX = 120;

/**
 * チャットのスクロール制御。
 * 利用者が最新付近を見ているときだけ新しい内容に合わせて自動でスクロールし、
 * 過去の回答を読み返しているときは勝手に動かさない（代わりに「最新へ」ボタンを出す）。
 */
export function useStickToBottom(container: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      atBottomRef.current = near;
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [container]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = container.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    },
    [container],
  );

  useEffect(() => {
    if (atBottomRef.current) scrollToBottom("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { atBottom, scrollToBottom };
}
