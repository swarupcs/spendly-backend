import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableInterface } from '@langchain/core/runnables';
import { env, type LlmProvider } from '../config/env';
import { createOpenAILlm } from './providers/openai.provider';
import { createGeminiLlm } from './providers/gemini.provider';
import { createGroqLlm } from './providers/groq.provider';

// ─── Tool-bindable LLM type ───────────────────────────────────────────────────

export type ToolCapableLlm = BaseChatModel & {
  bindTools(
    tools: StructuredToolInterface[],
    kwargs?: Record<string, unknown>,
  ): RunnableInterface;
};

// ─── Provider registry ────────────────────────────────────────────────────────

type ProviderFactory = () => ToolCapableLlm;

const PROVIDER_REGISTRY: Record<LlmProvider, ProviderFactory> = {
  openai: createOpenAILlm,
  gemini: createGeminiLlm,
  groq: createGroqLlm,
};

// ─── Singleton LLM instance ───────────────────────────────────────────────────

let _llmInstance: ToolCapableLlm | null = null;
let _activeProvider: LlmProvider | null = null;

export function getLlm(): ToolCapableLlm {
  if (_llmInstance) return _llmInstance;

  const provider = env.LLM_PROVIDER;
  const factory = PROVIDER_REGISTRY[provider];

  if (!factory) {
    throw new Error(
      `Unknown LLM provider: "${provider}". Valid options: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`,
    );
  }

  console.log(`🤖  LLM Provider → ${provider.toUpperCase()}`);
  _llmInstance = factory();
  _activeProvider = provider;
  return _llmInstance;
}

// ─── Fallback-aware invocation ────────────────────────────────────────────────

/**
 * Ordered list of fallback providers tried when the primary fails.
 * Primary is always first; others follow in priority order.
 */
function getFallbackOrder(): LlmProvider[] {
  const primary = env.LLM_PROVIDER;
  const all: LlmProvider[] = ['openai', 'gemini', 'groq'];
  // Primary first, then others that have an API key configured
  return [
    primary,
    ...all.filter((p) => {
      if (p === primary) return false;
      const keyMap: Record<LlmProvider, string | undefined> = {
        openai: env.OPENAI_API_KEY,
        gemini: env.GEMINI_API_KEY,
        groq: env.GROQ_API_KEY,
      };
      return !!keyMap[p];
    }),
  ];
}

/**
 * Invoke the LLM with automatic failover to the next available provider.
 * Falls back silently — logs a warning but never throws if at least one
 * provider succeeds.
 *
 * Usage: instead of `llm.invoke(messages)`, use `invokeLlmWithFallback(messages)`.
 */
export async function invokeLlmWithFallback(
  messages: Parameters<ToolCapableLlm['invoke']>[0],
  options?: Parameters<ToolCapableLlm['invoke']>[1],
): Promise<Awaited<ReturnType<ToolCapableLlm['invoke']>>> {
  const order = getFallbackOrder();
  let lastError: Error | null = null;

  for (const provider of order) {
    const factory = PROVIDER_REGISTRY[provider];
    const keyMap: Record<LlmProvider, string | undefined> = {
      openai: env.OPENAI_API_KEY,
      gemini: env.GEMINI_API_KEY,
      groq: env.GROQ_API_KEY,
    };
    if (!factory || !keyMap[provider]) continue;

    try {
      // Use cached instance for primary provider, create fresh for fallbacks
      const llm = provider === env.LLM_PROVIDER ? getLlm() : factory();

      if (provider !== env.LLM_PROVIDER) {
        console.warn(
          `⚠️  Primary LLM failed — falling back to ${provider.toUpperCase()}`,
        );
      }

      const result = await llm.invoke(messages, options);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `❌  LLM provider ${provider.toUpperCase()} failed:`,
        lastError.message,
      );
    }
  }

  throw lastError ?? new Error('All LLM providers failed.');
}

// ─── Provider info ────────────────────────────────────────────────────────────

export function getLlmProviderInfo(): { provider: LlmProvider; model: string } {
  const providerModelMap: Record<LlmProvider, string> = {
    openai: env.OPENAI_MODEL,
    gemini: env.GEMINI_MODEL,
    groq: env.GROQ_MODEL,
  };

  return {
    provider: env.LLM_PROVIDER,
    model: providerModelMap[env.LLM_PROVIDER],
  };
}

export function resetLlmInstance(): void {
  _llmInstance = null;
  _activeProvider = null;
}
