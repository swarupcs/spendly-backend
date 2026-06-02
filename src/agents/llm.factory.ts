import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableInterface } from '@langchain/core/runnables';
import { env, type LlmProvider } from '../config/env';
import { createOpenAILlm } from './providers/openai.provider';
import { createGeminiLlm } from './providers/gemini.provider';
import { createGroqLlm } from './providers/groq.provider';
import { createCustomLlm } from './providers/custom.provider';
import { createVertexLlm } from './providers/vertex.provider';
import { prisma } from '../config/db';

// ─── Tool-bindable LLM type ───────────────────────────────────────────────────

export type ToolCapableLlm = BaseChatModel & {
  bindTools(
    tools: StructuredToolInterface[],
    kwargs?: Record<string, unknown>,
  ): RunnableInterface;
};

// ─── Provider registry ────────────────────────────────────────────────────────

type ProviderFactory = (model?: string) => ToolCapableLlm;

const PROVIDER_REGISTRY: Record<LlmProvider, ProviderFactory> = {
  openai: createOpenAILlm,
  gemini: createGeminiLlm,
  groq: createGroqLlm,
  custom: createCustomLlm,
  vertex: createVertexLlm,
};

// ─── Provider info ────────────────────────────────────────────────────────────

export async function getLlmProviderInfo(userId?: number): Promise<{ provider: LlmProvider; model: string }> {
  let provider = env.LLM_PROVIDER;
  const providerModelMap: Record<LlmProvider, string> = {
    openai: env.OPENAI_MODEL,
    gemini: env.GEMINI_MODEL,
    groq: env.GROQ_MODEL,
    custom: env.CUSTOM_MODEL,
    vertex: env.VERTEX_MODEL,
  };
  let model = providerModelMap[provider];

  try {
    const globalSettings = await prisma.globalSettings.findFirst();
    if (globalSettings?.llmProvider) {
      provider = globalSettings.llmProvider as LlmProvider;
      model = globalSettings.llmModel || providerModelMap[provider] || '';
    }

    if (userId) {
      const userSettings = await prisma.userSettings.findUnique({ where: { userId } });
      if (userSettings?.llmProvider) {
        provider = userSettings.llmProvider as LlmProvider;
        model = userSettings.llmModel || providerModelMap[provider] || '';
      }
    }
  } catch (err) {
    console.error('Failed to load LLM settings from DB, falling back to env:', err);
  }

  return { provider, model };
}

// ─── LLM Factory ──────────────────────────────────────────────────────────────

export async function getLlm(userId?: number): Promise<ToolCapableLlm> {
  const info = await getLlmProviderInfo(userId);
  const factory = PROVIDER_REGISTRY[info.provider];

  if (!factory) {
    throw new Error(
      `Unknown LLM provider: "${info.provider}". ` +
        `Valid options: ${Object.keys(PROVIDER_REGISTRY).join(', ')}`,
    );
  }

  // Pass the DB-resolved model so user/global settings take full effect.
  return factory(info.model || undefined);
}

// ─── Fallback-aware invocation ────────────────────────────────────────────────

function getFallbackOrder(primary: LlmProvider): LlmProvider[] {
  const all: LlmProvider[] = ['openai', 'gemini', 'groq', 'custom', 'vertex'];

  const isReady: Record<LlmProvider, boolean> = {
    openai: !!env.OPENAI_API_KEY,
    gemini: !!env.GEMINI_API_KEY,
    groq: !!env.GROQ_API_KEY,
    custom: !!env.CUSTOM_API_KEY && !!env.CUSTOM_BASE_URL,
    vertex: !!env.VERTEX_PROJECT,
  };

  return [primary, ...all.filter((p) => p !== primary && isReady[p])];
}

export async function invokeLlmWithFallback(
  messages: Parameters<ToolCapableLlm['invoke']>[0],
  options?: Parameters<ToolCapableLlm['invoke']>[1] & { userId?: number },
): Promise<Awaited<ReturnType<ToolCapableLlm['invoke']>>> {
  const userId = options?.userId;
  const { provider: primaryProvider } = await getLlmProviderInfo(userId);
  const order = getFallbackOrder(primaryProvider);
  let lastError: Error | null = null;

  for (const provider of order) {
    const factory = PROVIDER_REGISTRY[provider];

    const isReady: Record<LlmProvider, boolean> = {
      openai: !!env.OPENAI_API_KEY,
      gemini: !!env.GEMINI_API_KEY,
      groq: !!env.GROQ_API_KEY,
      custom: !!env.CUSTOM_API_KEY && !!env.CUSTOM_BASE_URL,
      vertex: !!env.VERTEX_PROJECT,
    };

    if (!factory || !isReady[provider]) continue;

    try {
      // For the primary provider, use the DB-resolved model; fallbacks use their env defaults.
      const resolvedModel =
        provider === primaryProvider ? (await getLlmProviderInfo(userId)).model : undefined;
      const llm = factory(resolvedModel || undefined);
      if (provider !== primaryProvider) {
        console.warn(`⚠️  Primary LLM failed — falling back to ${provider.toUpperCase()}`);
      }
      // Omit userId from options before passing to LangChain
      const { userId: _, ...invokeOptions } = options || {};
      return await llm.invoke(messages, invokeOptions);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`❌  LLM provider ${provider.toUpperCase()} failed:`, lastError.message);
    }
  }

  throw lastError ?? new Error('All LLM providers failed.');
}

export function resetLlmInstance(): void {
  // No longer a singleton
}
