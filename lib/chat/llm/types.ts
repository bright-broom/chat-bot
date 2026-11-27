import type { ModelMessage } from "../types";

export type StreamOptions = {
  /** 出力トークンの上限 */
  maxTokens: number;
  /** クライアントが切断したら生成を止める */
  signal?: AbortSignal;
};

/** LLM の呼び出し先（OpenRouter / Workers AI）の共通インターフェース */
export interface ChatProvider {
  /** ログ用の識別名 */
  readonly name: string;
  /** 使うモデル（回答キャッシュのキーにも使う） */
  readonly model: string;
  /** Web 検索（と出典表示）に対応しているか */
  readonly webSearch: boolean;
  /** 会話を送り、SSE 形式の応答ストリームを返す。失敗時は UpstreamError を投げる */
  stream(messages: ModelMessage[], options: StreamOptions): Promise<ReadableStream<Uint8Array>>;
}

/**
 * 上流（LLM）の失敗。userMessage は利用者に見せてよい文言、
 * detail はログ専用（アカウント・設定情報を含みうるのでクライアントには返さない）。
 */
export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
    readonly detail = "",
  ) {
    super(`upstream error ${status}`);
    this.name = "UpstreamError";
  }
}
