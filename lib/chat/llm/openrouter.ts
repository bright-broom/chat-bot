// OpenRouter（OpenAI 互換の Chat Completions API）。政府・自治体サイトに限定した Web 検索つき。
import { includeDomains } from "../domains";
import type { ModelMessage } from "../types";
import { type ChatProvider, type StreamOptions, UpstreamError } from "./types";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export type OpenRouterOptions = {
  apiKey: string;
  model: string;
  webSearch: boolean;
  allowedDomains: readonly string[];
  fetch?: typeof fetch;
};

export function createOpenRouterProvider(opts: OpenRouterOptions): ChatProvider {
  const doFetch = opts.fetch ?? fetch;
  return {
    name: "openrouter",
    model: opts.model,
    webSearch: opts.webSearch,
    async stream(messages: ModelMessage[], { maxTokens, signal }: StreamOptions) {
      const res = await doFetch(OPENROUTER_URL, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "brightbroom-chat-bot",
        },
        body: JSON.stringify({
          model: opts.model,
          stream: true,
          max_tokens: maxTokens,
          reasoning: { effort: "low" },
          // 行政相談は個人情報を含みうるため、入力を学習・保存に使うプロバイダーへはルーティングしない
          provider: { data_collection: "deny" },
          messages,
          ...(opts.webSearch
            ? { plugins: [{ id: "web", include_domains: includeDomains(opts.allowedDomains) }] }
            : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new UpstreamError(
          res.status,
          res.status === 429
            ? "混み合っています。しばらく待ってからお試しください。"
            : "回答の生成に失敗しました。時間をおいてお試しください。",
          detail.slice(0, 500),
        );
      }
      return res.body;
    },
  };
}
