"use client";

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";

type Props = {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** 回答の生成中（送信の代わりに「停止」を出す） */
  busy: boolean;
  onStop: () => void;
  placeholder: string;
  maxLength: number;
  autoFocus?: boolean;
  /** マイクボタンなど、入力欄と送信ボタンのあいだに置く要素 */
  extra?: React.ReactNode;
  /** トップ画面の大きい入力欄 */
  large?: boolean;
  submitLabel?: string;
};

const MAX_ROWS = 6;

/**
 * 自動で高さが伸びる入力欄。
 * - パソコン: Enter で送信、Shift+Enter で改行
 * - スマホ・タブレット: Enter は改行（送信はボタン）
 * - 日本語入力の変換確定の Enter では送信しない
 */
export function Composer(props: Props) {
  const { id, value, onChange, onSubmit, busy, onStop, placeholder, maxLength, autoFocus, extra, large } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [coarsePointer, setCoarsePointer] = useState(false);

  useEffect(() => {
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // 内容に合わせて高さを変える（最大 MAX_ROWS 行、それ以上はスクロール）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    const padding = el.offsetHeight - el.clientHeight + 16;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_ROWS + padding)}px`;
  }, [value]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !value.trim()) return;
    onSubmit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || coarsePointer) return;
    // 変換中（IME）の Enter は確定操作なので送信しない
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  }

  const remaining = maxLength - value.length;

  return (
    <form className={`composer-form${large ? " large" : ""}`} onSubmit={submit}>
      <div className="composer-field">
        <label htmlFor={id} className="visually-hidden">
          相談したい内容
        </label>
        <textarea
          id={id}
          ref={ref}
          className="text-field composer-textarea"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          enterKeyHint={coarsePointer ? "enter" : "send"}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="composer-hint">
          {remaining <= 200 ? (
            <span className={remaining <= 0 ? "over" : ""}>あと {remaining} 文字</span>
          ) : coarsePointer ? null : (
            <span>Enter で送信 ／ Shift + Enter で改行</span>
          )}
        </p>
      </div>
      {extra}
      {busy ? (
        <button type="button" className="button-secondary stop-button" onClick={onStop}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
          停止
        </button>
      ) : (
        <button type="submit" className={`button-primary${large ? " ask-button" : ""}`} disabled={!value.trim()}>
          {props.submitLabel ?? "送信"}
        </button>
      )}
    </form>
  );
}
