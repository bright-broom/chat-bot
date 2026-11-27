"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { FuriganaContext, FuriganaText } from "./Furigana";
import { isAbortError, streamChat } from "@/lib/client/chat-stream";
import { useStickToBottom } from "@/lib/client/useStickToBottom";
import { Composer } from "./chat/Composer";
import { MessageActions, TypingIndicator } from "./chat/MessageActions";
import type { Mode } from "@/lib/chat/types";

const FURIGANA_KEY = "bb-chat-bot:furigana";

type Message = { role: "user" | "assistant"; content: string; error?: boolean; stopped?: boolean };

const MAX_INPUT = 2000;
// 支援制度モードで、何往復か聞き取ったあとに出すワンタップの返答
const SUPPORT_FINISH = "今の内容で、使えそうな制度を案内してください。";

const SUPPORT_START ="使える支援制度を探したいです。";

// トップの質問欄のプレースホルダーに順番に表示する質問の例。
// どんなことを聞けばよいかの手がかりになるよう、身近な行政手続きを選んでいる。
const EXAMPLE_QUESTIONS = [
  "引っ越したときに必要な手続きは？",
  "児童手当の申請方法を教えて",
  "マイナンバーカードの作り方は？",
  "パスポートの更新に必要なものは？",
  "確定申告が必要なのはどんな人？",
  "国民健康保険の保険料を減らせる？",
];
const PLACEHOLDER_INTERVAL_MS = 4000;

// 文字サイズ（html 要素の data-font-size 属性で切り替え。DADS の文字サイズは rem 指定なので追従する）
const FONT_SIZES = [
  { value: "normal", label: "標準" },
  { value: "large", label: "大" },
  { value: "xlarge", label: "特大" },
] as const;
type FontSize = (typeof FONT_SIZES)[number]["value"];

// 設定はブラウザに保存する（layout.tsx の初期化スクリプトと同じキー）
const FONT_SIZE_KEY = "bb-chat-bot:font-size";
const EASY_JAPANESE_KEY = "bb-chat-bot:easy-japanese";

function isFontSize(v: string | null): v is FontSize {
  return FONT_SIZES.some((f) => f.value === v);
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // プライベートモード等で保存できなくても動作は続ける
  }
}

const GREETINGS: [string, string][] = [
  ["こんにちは", "。"],
  ["Hello", "."],
  ["你好", "。"],
  ["안녕하세요", "."],
  ["Xin chào", "."],
  ["Olá", "."],
];

const SUGGESTIONS = [
  "引っ越しのときに必要な手続きは？",
  "児童手当はどうやって申請する？",
  "マイナンバーカードの更新方法",
  "確定申告が必要なのはどんな人？",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [greeting, setGreeting] = useState(0);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("chat");
  const [furigana, setFurigana] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [easyJapanese, setEasyJapanese] = useState(false);
  const messagesRef = useRef<HTMLElement>(null);
  // スクリーンリーダー向けの短いお知らせ（回答の本文を 1 文字ずつ読み上げさせないため）
  const [announcement, setAnnouncement] = useState("");
  // 生成中のリクエスト（「新しい相談」や画面を離れたときに中断する）
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // 振り仮名の設定はブラウザごとに記憶する（読めない環境でも動作には影響しない）
  useEffect(() => {
    try {
      if (localStorage.getItem(FURIGANA_KEY) === "on") setFurigana(true);
    } catch {}
  }, []);

  function toggleFurigana() {
    const next = !furigana;
    setFurigana(next);
    try {
      localStorage.setItem(FURIGANA_KEY, next ? "on" : "off");
    } catch {}
  }
  const inChat = messages.length > 0;
  // 音声入力開始時点で入力欄にあったテキスト（認識結果はこの後ろに追記する）
  const voiceBaseRef = useRef("");
  const speech = useSpeechRecognition((transcript) => {
    setInput(voiceBaseRef.current + transcript);
  });

  function toggleVoiceInput() {
    if (speech.listening) {
      speech.stop();
    } else {
      voiceBaseRef.current = input;
      speech.start();
    }
  }

  // トップ画面で入力が空のあいだだけ、質問例を一定間隔で切り替える
  useEffect(() => {
    if (inChat || input || loading) return;
    const id = setInterval(
      () => setExampleIndex((i) => (i + 1) % EXAMPLE_QUESTIONS.length),
      PLACEHOLDER_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [inChat, input, loading]);

  // 保存済みの設定を復元（SSR とのずれを避けるためマウント後に読む）
  useEffect(() => {
    try {
      const f = localStorage.getItem(FONT_SIZE_KEY);
      if (isFontSize(f)) setFontSize(f);
      setEasyJapanese(localStorage.getItem(EASY_JAPANESE_KEY) === "true");
    } catch {
      // 読めなければ既定値のまま
    }
  }, []);

  function changeFontSize(value: FontSize) {
    setFontSize(value);
    document.documentElement.dataset.fontSize = value;
    save(FONT_SIZE_KEY, value);
  }

  function changeEasyJapanese(value: boolean) {
    setEasyJapanese(value);
    save(EASY_JAPANESE_KEY, String(value));
  }

  const { atBottom, scrollToBottom } = useStickToBottom(messagesRef, [messages]);

  useEffect(() => {
    if (inChat) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setGreeting((g) => (g + 1) % GREETINGS.length), 2600);
    return () => clearInterval(id);
  }, [inChat]);

  // 支援制度探しモードを新しい会話として始める（それまでの相談内容は送らない）
  function startSupport() {
    if (loading) return;
    setMode("support");
    send(SUPPORT_START, [], "support");
  }

  async function send(rawText: string, prev: Message[] = messages, currentMode: Mode = mode) {
    const text = rawText.trim();
    if (!text || loading) return;
    speech.cancel();

    const history: Message[] = [
      ...prev.filter((m) => !m.error),
      { role: "user", content: text },
    ];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);
    setAnnouncement("");
    // 送ったら最新の位置に戻す
    requestAnimationFrame(() => scrollToBottom("smooth"));

    // 前の回答がまだ流れていれば止めてから新しく送る
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        { messages: history, mode: currentMode, easyJapanese },
        {
          signal: controller.signal,
          onText: (reply) => setMessages([...history, { role: "assistant", content: reply }]),
        },
      );
      setAnnouncement("ブルームの回答が届きました。");
    } catch (err) {
      if (isAbortError(err)) {
        // 「停止」した場合は途中までの回答を残す（空なら消す）。「新しい相談」では会話ごと消えている
        setMessages((cur) => {
          const last = cur[cur.length - 1];
          if (!last || last.role !== "assistant") return cur;
          return last.content
            ? [...cur.slice(0, -1), { ...last, stopped: true }]
            : cur.slice(0, -1);
        });
        return;
      }
      const msg = err instanceof Error && err.message ? err.message : "エラーが発生しました。";
      setMessages([...history, { role: "assistant", content: msg, error: true }]);
      setAnnouncement(`エラー: ${msg}`);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setAnnouncement("回答を停止しました。");
  }

  // エラーになった質問をもう一度送る
  function retry(errorIndex: number) {
    const before = messages.slice(0, errorIndex);
    const lastUser = before.length - 1;
    if (lastUser < 0 || before[lastUser].role !== "user") return;
    send(before[lastUser].content, before.slice(0, lastUser));
  }

  function reset() {
    // 回答の途中でも「新しい相談」を押せるようにし、生成中のリクエストは中断する
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    speech.cancel();
    setMode("chat");
    setMessages([]);
    setInput("");
    window.scrollTo({ top: 0 });
  }

  const brand = (
    <button type="button" className="brand" onClick={reset} aria-label="BrightBroom Bot トップに戻る">
      {/* ロゴ: 常磐色の円に、白いツバメ（キャラクター「ブルーム」）と山吹のくちばし */}
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="currentColor" />
        <g transform="translate(16 16) scale(1.15) translate(-16.5 -16)">
          <path
            d="M16.6 12 6 23Q8.9 21.9 10.7 20.4L8.5 25 12.6 20.9Q14.5 22.1 16.4 22.1C21 22.1 24.3 18.5 24.3 14.5V11C24.3 8.6 22.6 7 20.4 7S16.6 8.7 16.6 10.7Z"
            fill="#ffffff"
          />
          <path d="M24.1 9.5 27 10.4 24.1 11.3Z" fill="var(--accent)" />
          <circle cx="21.2" cy="9.9" r="0.85" fill="currentColor" />
        </g>
      </svg>
      <span className="brand-name">
        BrightBroom Bot
        <small>行政相談 AI アシスタント</small>
      </span>
    </button>
  );

  const furiganaToggle = (
    <button
      type="button"
      role="switch"
      aria-checked={furigana}
      className="furigana-toggle"
      onClick={toggleFurigana}
    >
      <span className="furigana-toggle-label">
        <ruby>
          振<rp>(</rp><rt>ふ</rt><rp>)</rp>
        </ruby>
        り
        <ruby>
          仮名<rp>(</rp><rt>がな</rt><rp>)</rp>
        </ruby>
      </span>
      <span className="furigana-toggle-track" aria-hidden="true">
        <span className="furigana-toggle-thumb" />
      </span>
      <span className="furigana-toggle-state" aria-hidden="true">
        {furigana ? "オン" : "オフ"}
      </span>
    </button>
  );

  const micButton = speech.supported ? (
    <button
      type="button"
      className={`mic${speech.listening ? " listening" : ""}`}
      onClick={toggleVoiceInput}
      disabled={loading}
      aria-label={speech.listening ? "音声入力を停止" : "音声で入力"}
      aria-pressed={speech.listening}
      title={speech.listening ? "音声入力を停止" : "音声で入力"}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
        />
      </svg>
    </button>
  ) : null;

  const withFurigana = (node: ReactNode) => (
    <FuriganaContext.Provider value={furigana}>{node}</FuriganaContext.Provider>
  );

  // 表示設定（文字サイズ・やさしい日本語）。トップとチャット画面のヘッダー下に出す
  const settings = (
    <div className="settings">
      <div className="font-size" role="group" aria-label="文字サイズ">
        <span className="settings-label" aria-hidden="true">
          文字サイズ
        </span>
        {FONT_SIZES.map((f) => (
          <button
            key={f.value}
            type="button"
            className="toggle"
            aria-pressed={fontSize === f.value}
            onClick={() => changeFontSize(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <label className="easy-japanese">
        <input
          type="checkbox"
          checked={easyJapanese}
          onChange={(e) => changeEasyJapanese(e.target.checked)}
        />
        やさしい日本語
      </label>
    </div>
  );

  if (!inChat) {
    return withFurigana(
      <div className={`landing${furigana ? " furigana-on" : ""}`}>
        <div className="landing-notice">
          <FuriganaText text="AI がお答えする行政相談のご案内です。正式な手続きは各行政機関の窓口・公式サイトでご確認ください。" />
        </div>

        <header className="header">
          <div className="header-inner">
            {brand}
            {furiganaToggle}
          </div>
          {settings}
        </header>

        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-inner">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="hero-mascot" src="/bot-avatar.webp" alt="" width={88} height={88} />
              <h1 id="hero-title" className="hello">
                <span key={greeting} className="hello-word">
                  {GREETINGS[greeting][0]}
                  {GREETINGS[greeting][1]}
                </span>
              </h1>
              <p className="hero-lead">
                <FuriganaText text="行政の手続きや制度について、何をお知りになりたいですか？" />
              </p>

              <div className="ask">
                <Composer
                  id="ask-input"
                  large
                  value={input}
                  onChange={setInput}
                  onSubmit={() => send(input)}
                  busy={loading}
                  onStop={stop}
                  maxLength={MAX_INPUT}
                  autoFocus
                  submitLabel="聞いてみる"
                  placeholder={speech.listening ? "お話しください…" : `例：${EXAMPLE_QUESTIONS[exampleIndex]}`}
                  extra={micButton}
                />
              </div>
              {speech.error && (
                <p className="voice-error ask-voice-error" role="alert">
                  {speech.error}
                </p>
              )}

              <div className="suggestions">
                <p className="suggestions-label">
                  <FuriganaText text="よくある質問" />
                </p>
                <ul>
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button type="button" className="chip" onClick={() => send(s)}>
                        <FuriganaText text={s} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="support-cta">
                <button type="button" className="support-button" onClick={startSupport}>
                  <FuriganaText text="使える支援制度を探す" />
                </button>
                <p>
                  <FuriganaText text="いくつかの質問にお答えいただくと、利用できそうな給付・手当・減免・相談窓口をご案内します。" />
                </p>
              </div>
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="section-inner">
            <FuriganaText text="24 時間いつでも、日本語以外の言語でもご相談いただけます。" />
            <br />
            <FuriganaText text="AI の回答には誤りが含まれる場合があります。個人情報は入力しないでください。" />
          </div>
        </footer>
      </div>
    );
  }

  return withFurigana(
    <div className={`container${furigana ? " furigana-on" : ""}`}>
      <header className="header">
        <div className="header-inner chat-header">
          {brand}
          {mode === "support" && <span className="mode-badge">支援制度を探す</span>}
          {furiganaToggle}
          <button type="button" className="button-secondary" onClick={reset}>
            新しい相談
          </button>
        </div>
        {settings}
      </header>

      <main className="messages" aria-label="会話" ref={messagesRef} aria-busy={loading}>
        <div className="messages-inner">
          {messages.map((m, i) => {
            const streaming = loading && i === messages.length - 1;
            const done = m.role === "assistant" && !streaming;
            return (
              <div key={i} className={`message ${m.role}${m.error ? " error" : ""}`}>
                {m.role === "assistant" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="avatar" src="/bot-avatar.webp" alt="" width={40} height={40} />
                )}
                <div className="message-body">
                  <span className="message-label">
                    {m.role === "user" ? "あなた" : m.error ? "エラー" : "ブルーム"}
                  </span>
                  {/* 生成中のメッセージは文字列が変わり続けるため、完了してから振り仮名を付ける */}
                  <FuriganaContext.Provider value={furigana && !streaming}>
                    <div className="bubble" role={m.error ? "alert" : undefined}>
                      {m.role === "assistant" && m.content && !m.error ? (
                        <Markdown text={m.content} />
                      ) : m.content ? (
                        <FuriganaText text={m.content} />
                      ) : streaming ? (
                        <TypingIndicator />
                      ) : null}
                      {m.stopped && <p className="stopped-note">（回答を途中で停止しました）</p>}
                    </div>
                  </FuriganaContext.Provider>
                  {done && m.content && (
                    <MessageActions
                      text={m.error ? undefined : m.content}
                      onRetry={m.error || m.stopped ? () => retry(i) : undefined}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {mode === "support" && !loading && messages.filter((m) => m.role === "user").length >= 3 &&
            messages[messages.length - 1]?.role === "assistant" && (
              <div className="quick-replies">
                <button type="button" className="chip-light" onClick={() => send(SUPPORT_FINISH)}>
                  <FuriganaText text="この内容で制度を案内して" />
                </button>
              </div>
            )}
        </div>

        {!atBottom && (
          <button type="button" className="jump-latest" onClick={() => scrollToBottom("smooth")}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="currentColor" d="M12 16.5 5 9.5 6.4 8.1l5.6 5.6 5.6-5.6L19 9.5z" />
            </svg>
            最新の回答へ
          </button>
        )}
      </main>

      <div className="composer">
        <div className="composer-inner">
          <Composer
            id="message-input"
            value={input}
            onChange={setInput}
            onSubmit={() => send(input)}
            busy={loading}
            onStop={stop}
            maxLength={MAX_INPUT}
            autoFocus
            placeholder={
              speech.listening
                ? "お話しください…"
                : mode === "support"
                  ? "状況を入力（個人情報は不要です）"
                  : "続けて質問する"
            }
            extra={micButton}
          />
        </div>
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {speech.error && (
        <p className="voice-error" role="alert">
          {speech.error}
        </p>
      )}
    </div>
  );
}
