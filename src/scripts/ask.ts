/**
 * ask.ts — Ask a single question to your custom LLM provider.
 *
 * Run:
 *   npx tsx --env-file=.env src/scripts/ask.ts "your question here"
 *
 * Examples:
 *   npx tsx --env-file=.env src/scripts/ask.ts "What is the capital of France?"
 *   npx tsx --env-file=.env src/scripts/ask.ts "Give me 3 tips to save money"
 *   npx tsx --env-file=.env src/scripts/ask.ts          ← uses default question
 */

import 'dotenv/config';

const API_KEY = process.env.CUSTOM_API_KEY;
const BASE_URL = process.env.CUSTOM_BASE_URL;
const MODEL = process.env.CUSTOM_MODEL ?? 'gpt-4.1-mini';

async function main(): Promise<void> {
  if (!API_KEY || !BASE_URL) {
    console.error('❌  CUSTOM_API_KEY or CUSTOM_BASE_URL is not set in .env');
    process.exit(1);
  }

  const question =
    process.argv.slice(2).join(' ') || 'Who are you and what can you do?';

  console.log(`\n🤖  Model   : ${MODEL}`);
  console.log(`❓  Question: ${question}`);
  console.log('⏳  Waiting for response…\n');

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: question }],
      temperature: 0.7,
    }),
  });

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!res.ok || json.error) {
    console.error(
      `❌  Error (HTTP ${res.status}):`,
      json.error?.message ?? res.statusText,
    );
    process.exit(1);
  }

  const answer =
    json.choices?.[0]?.message?.content?.trim() ?? '(empty response)';
  console.log(`💬  Answer:\n\n${answer}\n`);
}

main().catch((err: unknown) => {
  console.error('❌  Unexpected error:', err);
  process.exit(1);
});
