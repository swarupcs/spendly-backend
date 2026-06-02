import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { env } from '../../config/env';
import type { ToolCapableLlm } from '../llm.factory';

/**
 * Returns a ChatGoogleGenerativeAI instance configured from env.
 * Models: gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash, etc.
 *
 * Install: npm install @langchain/google-genai
 */
export function createGeminiLlm(model?: string): ToolCapableLlm {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  return new ChatGoogleGenerativeAI({
    model: model || env.GEMINI_MODEL,
    apiKey: env.GEMINI_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
  }) as unknown as ToolCapableLlm;
}
