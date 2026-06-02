import { ChatGroq } from '@langchain/groq';
import { env } from '../../config/env';
import type { ToolCapableLlm } from '../llm.factory';

/**
 * Returns a ChatGroq instance configured from env.
 * Models: llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b-32768, etc.
 *
 * Install: npm install @langchain/groq
 */
export function createGroqLlm(model?: string): ToolCapableLlm {
  if (!env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is not set');
  }

  return new ChatGroq({
    model: model || env.GROQ_MODEL,
    apiKey: env.GROQ_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
  }) as unknown as ToolCapableLlm;
}
