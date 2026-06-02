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

// Fields that many OpenAI-compat providers (e.g. Euron with Gemini models)
// reject with 400. LangChain's ChatOpenAI adds them automatically for OpenAI
// models, so we strip them at the HTTP level before the request is sent.
const UNSUPPORTED_FIELDS = ['parallel_tool_calls', 'stream_options'];

// Use Parameters<typeof fetch> so we don't depend on DOM types (RequestInfo,
// RequestInit, Response) which are not available in Node-targeted projects.
async function compatFetch(
  ...args: Parameters<typeof fetch>
): ReturnType<typeof fetch> {
  let [input, init] = args;

  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      let modified = false;

      for (const field of UNSUPPORTED_FIELDS) {
        if (field in body) {
          delete body[field];
          modified = true;
        }
      }

      if (Array.isArray(body.messages)) {
        body.messages = body.messages.map((msg: any) => {
          // Euron rejects tool_calls in history. Convert to text.
          if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
            const calls = msg.tool_calls.map((tc: any) => 
              `${tc.function?.name || 'unknown'}(${tc.function?.arguments || ''})`
            ).join(', ');
            
            return {
              role: 'assistant',
              content: msg.content ? `${msg.content}\n[Tool Calls: ${calls}]` : `[Tool Calls: ${calls}]`
            };
          }
          // Euron rejects the 'tool' role. Convert to a user message.
          if (msg.role === 'tool') {
            return {
              role: 'user',
              content: `[Tool Result for ${msg.name || msg.tool_call_id || 'tool'}]: ${msg.content}`
            };
          }
          return msg;
        });
        modified = true;
      }

      if (modified) {
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // Body is not JSON — pass through unchanged
    }
  }

  const response = await globalThis.fetch(input, init);
  if (!response.ok) {
    console.error(`[compatFetch] Error response: ${response.status} ${response.statusText}`);
  }
  return response;
}

export function createCustomLlm(model?: string): ToolCapableLlm {
  if (!env.CUSTOM_API_KEY) {
    throw new Error('CUSTOM_API_KEY is not set. Add it to your .env file.');
  }

  if (!env.CUSTOM_BASE_URL) {
    throw new Error(
      'CUSTOM_BASE_URL is not set. Add the endpoint base URL to your .env file.',
    );
  }

  return new ChatOpenAI({
    model: model || env.CUSTOM_MODEL,
    apiKey: env.CUSTOM_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
    timeout: 30_000,
    configuration: {
      baseURL: env.CUSTOM_BASE_URL,
      // Strip fields unsupported by Gemini-based OpenAI-compat endpoints.
      fetch: compatFetch,
    },
  }) as unknown as ToolCapableLlm;
}
