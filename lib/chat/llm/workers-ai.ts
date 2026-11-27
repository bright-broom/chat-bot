// Cloudflare Workers AI。API キー不要で、無料枠（1 日 10,000 Neurons）がある。入力は学習に使われない。
import type { ModelMessage } from "../types";
import { type ChatProvider, type StreamOptions, UpstreamError } from "./types";

/** Workers AI バインディングのうち、ここで使う部分だけの型（モデル ID を環境変数で差し替えられるようにする） */
export type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export function createWorkersAiProvider(ai: WorkersAiBinding, model: string): ChatProvider {
  return {
    name: "workers-ai",
    model,
    webSearch: false,
    async stream(messages: ModelMessage[], { maxTokens }: StreamOptions) {
      let result: unknown;
      try {
        result = await ai.run(model, { messages, stream: true, max_completion_tokens: maxTokens });
      } catch (err) {
        // 無料枠（1 日 10,000 Neurons）を使い切った場合などもここに来る
        throw new UpstreamError(
          503,
          "ただいま混み合っているか、本日の利用上限に達しました。時間をおいてお試しください。",
          err instanceof Error ? err.message : String(err),
        );
      }
      if (!(result instanceof ReadableStream)) {
        throw new UpstreamError(502, "回答の生成に失敗しました。時間をおいてお試しください。", "non-stream response");
      }
      return result as ReadableStream<Uint8Array>;
    },
  };
}
