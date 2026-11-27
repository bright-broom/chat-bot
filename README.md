# BrightBroom Bot（chat-bot）

行政手続きや公的制度について相談できる、公開の行政相談チャットボットです。BrightBroom が運営しています。

**公開中: https://bot.brightbroom.dpdns.org**

[チームみらい](https://github.com/team-mirai) の [mirai-gbot](https://github.com/team-mirai/mirai-gbot) をフォークして改変したものです（ライセンスは同じ AGPL-3.0-or-later）。

Next.js (App Router) + TypeScript のチャットボットで、回答は [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) の LLM（既定は Google Gemma 4）で生成します。API キーは不要で、Workers AI の無料枠（1 日 10,000 Neurons）の範囲なら無料で動きます。[Cloudflare Workers](https://developers.cloudflare.com/workers/) 上で [OpenNext](https://opennext.js.org/cloudflare) を使って動かしています。

## ローカルで動かす

```bash
npm install
npx wrangler login   # Workers AI はローカルからも Cloudflare 上で実行されるため、ログインが必要
npm run dev
```

http://localhost:3000 を開きます。

Cloudflare の実行環境（workerd）で確認したいときは:

```bash
cp .dev.vars.example .dev.vars   # 必要な設定だけ記入（空でも動く）
npm run preview                  # http://localhost:8787
```

## Cloudflare にデプロイ

設定は `wrangler.jsonc`（Worker 名 `chat-bot`）と `open-next.config.ts` にあります。

### GitHub 連携（Workers Builds、推奨）

GitHub Actions の実行枠を使わずに、Cloudflare 側でビルド・デプロイします。

1. Cloudflare ダッシュボードの **Workers & Pages → Create → Import a repository** でこのリポジトリを選ぶ
2. ビルド設定
   - Build command: `npx opennextjs-cloudflare build`
   - Deploy command: `npx opennextjs-cloudflare deploy`
3. 任意の設定値があれば、Worker の **Settings → Variables and Secrets** に追加（Workers AI を使うだけなら不要）
4. デプロイすると `https://chat-bot.<アカウント>.workers.dev` で公開される

以降は `main` への push で本番が自動デプロイされます。

### 手元から直接デプロイ

```bash
npx wrangler login
npm run deploy
```

## 構成

- `app/page.tsx` — チャット画面（クライアントコンポーネント）。画面上部で文字サイズ（標準・大・特大）と「やさしい日本語」モードを切り替えられます（設定はブラウザに保存）
- `app/useSpeechRecognition.ts` — ブラウザの Web Speech API による日本語の音声入力。対応ブラウザ（Chrome・Edge・Safari など）でのみ入力欄にマイクボタンが表示されます
- `app/api/chat/route.ts` — LLM を呼び出し、テキストをストリーミング返却
- LLM: 既定は Cloudflare Workers AI の `@cf/google/gemma-4-26b-a4b-it`（`wrangler.jsonc` の `ai` バインディング）。環境変数 `WORKERS_AI_MODEL` で別のモデル（例: `@cf/zai-org/glm-4.7-flash`）に変えられます
  - 費用: Workers AI は 1 日 10,000 Neurons まで無料（毎日 0 時 UTC にリセット）。1 往復あたり数十 Neurons 程度なので、1 日数百回の会話までは無料枠に収まる見込みです。**Workers の無料プランなら、無料枠を超えた分はエラーになるだけで課金されません**（有料プランでは超過分が $0.011 / 1,000 Neurons で課金）
  - Workers AI では Web 検索をしないため、出典リンクは付きません。金額や期限は公式サイト・窓口で確認するよう案内します
  - `OPENROUTER_API_KEY` を設定すると OpenRouter に切り替わり、政府・自治体サイトに限定した Web 検索と出典表示が使えます（モデルは `OPENROUTER_MODEL`、既定 `openai/gpt-6-luna`）
- 振り仮名: 画面右上のスイッチで、漢字に振り仮名（HTML の `<ruby>` 要素）を付けて表示できます。読みは形態素解析ライブラリ [kuromoji](https://github.com/takuyaa/kuromoji.js) を使って**ブラウザ上で**求めます（`app/Furigana.tsx` / `lib/furigana-core.ts`、外部 API は使いません）。辞書（約 17MB）は Worker に同梱できないため、ビルド時に `public/kuromoji-dict/` へコピーして静的ファイルとして配り、振り仮名を初めてオンにしたときだけ読み込みます
- 支援制度を探す（AI インタビュー）: 最初の画面の「使える支援制度を探す」ボタンで開始。ボットが困りごと・世帯構成・市区町村・収入の目安などを一問ずつ聞き取り、利用できそうな給付・手当・減免・貸付・相談窓口を、申請先・期限・出典つきで一覧表示します。氏名や詳しい住所などの個人情報は聞きません。API には `mode: "support"` を付けて送り、専用のシステムプロンプトに切り替えます
- 回答しない話題: `app/api/chat/blocked.ts` に名前（表記ゆれは正規化して比較）を登録すると、その人物についての質問には LLM を呼ばずに定型の断り文を返します。間接的に指す質問用の指示文も `BLOCKED_TOPIC_RULE` に書けます。既定では何も登録していません
- Web 検索（OpenRouter 利用時のみ）: OpenRouter の web プラグインで最新情報を検索した上で回答します。検索対象は政府・自治体の公式ドメイン（`go.jp` / `lg.jp` とそのサブドメイン）だけに限定しており、それ以外のサイトは検索・出典表示の対象になりません。対象ドメインは `SEARCH_ALLOWED_DOMAINS`（カンマ区切り）で変更できます。参照したページは回答末尾に出典として表示されます。`OPENROUTER_WEB_SEARCH=false` で無効化できます（検索 1 回あたり追加コストがかかります）

## セキュリティ

アプリ側で行っている対策:

- `/api/chat` の入力検証: 文字列以外の content を拒否、1 メッセージ 2000 文字・履歴 20 件・本文 64KB まで（下記「不正利用・コスト対策」の環境変数で変更可）
- IP ごとの簡易レート制限（既定 10 回/分・100 回/日）
- 他サイトからのブラウザ経由の呼び出し（`Sec-Fetch-Site: cross-site` / Origin 不一致）を拒否
- LLM（Workers AI / OpenRouter）のエラー詳細はクライアントに返さずサーバーログのみに出す
- Workers AI は入力をモデルの学習に使わない。OpenRouter 利用時は `provider.data_collection: "deny"` を指定し、入力を学習・保存するプロバイダーを使わない
- CSP・`X-Frame-Options`・HSTS などのセキュリティヘッダー（`next.config.ts`）
- Markdown 表示は innerHTML を使わず、リンクは http(s)/mailto のみ許可

運用側で設定してください（コードでは防ぎきれないもの）:

- **Workers の無料プランのまま使う**か、有料プランなら Workers AI の使用量を確認する（無料プランなら無料枠超過はエラーになるだけで課金されない）。OpenRouter を使う場合は **API キーに利用上限（クレジット上限）を設定**する。`/api/chat` は認証なしの公開エンドポイントなので、上限が最後の砦になります
- **Cloudflare の WAF でレート制限ルールを追加**する（例: `/api/chat` に IP あたり 10 回/分）。アプリ内のレート制限はアイソレートごとのメモリなので完全ではありません。WAF のルールは独自ドメイン（Cloudflare に追加したゾーン）で配信する場合に使えます
- 必要なら Bot Fight Mode や Cloudflare Turnstile を有効にする

## 不正利用・コスト対策

`/api/chat` は 1 回ごとに LLM の利用量（Workers AI の Neurons、または OpenRouter の従量課金）を消費するため、次の制限を入れています（`app/api/chat/guard.ts`）。値は環境変数で変更でき、`0` で無効になります。

| 環境変数 | 既定値 | 内容 |
| --- | --- | --- |
| `RATE_LIMIT_PER_MINUTE` | 10 | IP あたり 1 分間のリクエスト上限。超えると 429 |
| `RATE_LIMIT_PER_DAY` | 100 | IP あたり 1 日のリクエスト上限。超えると 429 |
| `MAX_INPUT_CHARS` | 2000 | 1 メッセージの最大文字数。超えると 400 |
| `MAX_HISTORY_MESSAGES` | 20 | モデルに送る会話履歴の最大件数（古い分は切り捨て） |
| `MAX_HISTORY_CHARS` | 12000 | モデルに送る会話履歴の合計最大文字数（古い分は切り捨て） |

レート制限のカウンタはサーバーのメモリ上に持っているため、Cloudflare Workers のように複数のアイソレートで動く環境や再起動後はカウントが分散・リセットされます。あくまで目安の上限なので、**確実な上限として OpenRouter 側でも利用上限を設定してください**。

### OpenRouter の利用上限を設定する（OpenRouter を使う場合）

1. [OpenRouter の Keys ページ](https://openrouter.ai/settings/keys) で本番用の API キーを開き（または新しく作成し）、**Credit limit** に上限額（例: 月の予算）を設定する
2. 上限に達するとそのキーでのリクエストは失敗するので、ボットはエラーを返して止まり、それ以上は課金されない
3. 自動チャージ（Auto top-up）を使う場合は、チャージ額・上限も予算に合わせておく
4. [Activity ページ](https://openrouter.ai/activity) で利用状況を定期的に確認する

さらに強い対策が必要になった場合は、Cloudflare WAF のレート制限ルールや Bot 対策（Bot Fight Mode）、Cloudflare Turnstile の導入を検討してください。

## 元プロジェクトからの主な変更点

- ボットの名前・運営者を BrightBroom Bot / BrightBroom に変更（`app/api/chat/route.ts` の `BOT_PROFILE`、画面のロゴ、タイトル）
- ロゴ（ほうきときらり）とキャラクター「ブルーム」（`public/bot-avatar.svg`）を新しく作成（元のロゴとキャラクター画像は使っていません）
- 元プロジェクト固有の回答 NG 人物の指定を削除（仕組みは残しています）
- トップのプロトタイプ告知（YouTube 配信へのリンク）を削除
- Issue 自動実装・コンフリクト自動解決の GitHub Actions を削除
- ブラウザ保存キーの接頭辞を `bb-chat-bot:` に変更
- LLM の既定を OpenRouter から Cloudflare Workers AI（無料枠あり・API キー不要）に変更。OpenRouter はキーを設定したときだけ使う
- 公開先を Vercel から Cloudflare Workers（OpenNext）に変更。振り仮名の解析をサーバーからブラウザへ移動、クライアント IP は `cf-connecting-ip` を優先

## ライセンス

[GNU Affero General Public License v3.0 or later](LICENSE)（AGPL-3.0-or-later）で公開しています。

AGPL のため、このソフトウェアを改変してネットワーク越しにサービスとして提供する場合は、利用者に対して改変後のソースコードを入手できる手段を提供する必要があります。このリポジトリ（https://github.com/bright-broom/chat-bot）を公開しておくことで、その条件を満たしています。

Copyright (C) チームみらい（mirai-gbot の原著作者）  
Copyright (C) 2026 BrightBroom（改変部分）
