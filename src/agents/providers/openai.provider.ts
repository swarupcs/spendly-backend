import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config/env';
import type { ToolCapableLlm } from '../llm.factory';

/**
 * Returns a ChatOpenAI instance configured from env.
 * Models: gpt-4o, gpt-4o-mini, gpt-4-turbo, etc.
 */
export function createOpenAILlm(model?: string): ToolCapableLlm {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  return new ChatOpenAI({
    model: model || env.OPENAI_MODEL,
    apiKey: env.OPENAI_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
    timeout: 30_000,
  }) as unknown as ToolCapableLlm;
}
