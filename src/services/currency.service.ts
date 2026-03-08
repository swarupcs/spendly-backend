// ─── Exchange Rate Service ────────────────────────────────────────────────────
// Uses open.er-api.com (free, no API key, updates every 24h)

interface RateCache {
  rates: Record<string, number>;
  expiresAt: number;
}

const cache = new Map<string, RateCache>();
const TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getRatesService(base: string): Promise<Record<string, number>> {
  const upper = base.toUpperCase();
  const cached = cache.get(upper);
  if (cached && Date.now() < cached.expiresAt) return cached.rates;

  const res = await fetch(`https://open.er-api.com/v6/latest/${upper}`);
  if (!res.ok) throw new Error(`Exchange rate fetch failed: ${res.status}`);

  const json = await res.json() as { result: string; rates: Record<string, number> };
  if (json.result !== 'success') throw new Error('Exchange rate API error');

  cache.set(upper, { rates: json.rates, expiresAt: Date.now() + TTL_MS });
  return json.rates;
}

// Returns how many units of `to` equal 1 unit of `from`
export async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const rates = await getRatesService(from.toUpperCase());
  const rate = rates[to.toUpperCase()];
  if (!rate) throw new Error(`Unknown currency: ${to}`);
  return rate;
}
