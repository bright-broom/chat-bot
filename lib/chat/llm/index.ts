// 設定に応じて LLM の呼び出し先を選ぶ
import type { ChatConfig } from "../config";
import { createOpenRouterProvider } from "./openrouter";
import type { ChatProvider } from "./types";
import { type WorkersAiBinding, createWorkersAiProvider } from "./workers-ai";

export type { ChatProvider } from "./types";
export { UpstreamError } from "./types";

/**
 * OPENROUTER_API_KEY があれば OpenRouter（Web 検索つき）、なければ Workers AI を使う。
 * Workers AI のバインディングがない場合は null（設定ミス）。
 */
export function selectProvider(
  config: ChatConfig,
  getAi: () => WorkersAiBinding | undefined,
): ChatProvider | null {
  if (config.openRouter) {
    return createOpenRouterProvider({ ...config.openRouter, allowedDomains: config.allowedDomains });
  }
  const ai = getAi();
  return ai ? createWorkersAiProvider(ai, config.workersAi.model) : null;
}
