import { ChatOpenAI } from '@langchain/openai';
import { env } from '../../config/env';
import type { ToolCapableLlm } from '../llm.factory';

/**
 * Custom LLM provider — wraps any OpenAI-compatible chat completions endpoint.
 *
 * The base URL and API key are read exclusively from environment variables.
 * No service name, vendor, or endpoint URL is ever hard-coded in source code.
 *
 * Required .env variables:
 *   LLM_PROVIDER=custom
 *   CUSTOM_API_KEY=<your key>
 *   CUSTOM_BASE_URL=<your endpoint base URL>   # e.g. https://.../.../v1
 *   CUSTOM_MODEL=<model identifier>            # e.g. gpt-4.1-mini
 */
export function createCustomLlm(): ToolCapableLlm {
  if (!env.CUSTOM_API_KEY) {
    throw new Error('CUSTOM_API_KEY is not set. Add it to your .env file.');
  }

  if (!env.CUSTOM_BASE_URL) {
    throw new Error(
      'CUSTOM_BASE_URL is not set. Add the endpoint base URL to your .env file.',
    );
  }

  return new ChatOpenAI({
    model: env.CUSTOM_MODEL,
    apiKey: env.CUSTOM_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
    timeout: 30_000,
    configuration: {
      baseURL: env.CUSTOM_BASE_URL,
    },
  }) as unknown as ToolCapableLlm;
}
