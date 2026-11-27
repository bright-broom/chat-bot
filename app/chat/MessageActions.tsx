"use client";

import { useState } from "react";

/** 回答の下に出す操作（コピー・もう一度送る） */
export function MessageActions({ text, onRetry }: { text?: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では何もしない
    }
  }

  return (
    <div className="message-actions">
      {text && (
        <button type="button" className="action-button" onClick={copy} aria-live="polite">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d={
                copied
                  ? "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
                  : "M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
              }
            />
          </svg>
          {copied ? "コピーしました" : "コピー"}
        </button>
      )}
      {onRetry && (
        <button type="button" className="action-button" onClick={onRetry}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
            />
          </svg>
          もう一度送る
        </button>
      )}
    </div>
  );
}

/** 回答を待っているあいだの表示（ブルームが考えている様子） */
export function TypingIndicator() {
  return (
    <span className="typing" role="status">
      <span className="typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="typing-label">ブルームが調べています</span>
    </span>
  );
}
