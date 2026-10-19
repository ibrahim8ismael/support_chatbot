/**
 * Rough USD price table (per 1M tokens) for `answer_events.estimated_cost_usd`.
 * Prices are list prices, checked 2026-10; they drift, so the recorded value is
 * an *estimate* for trend lines, never billing. Unknown models return `null` —
 * analytics shows "—" instead of a wrong number. OpenRouter ids are normalised
 * (`openai/gpt-4.1-mini` prices as `gpt-4.1-mini`).
 */
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

/** Estimated chat cost in USD, or `null` when the model has no known price. */
export function estimateCostUsd(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
): number | null {
  if (!model) {
    return null;
  }
  const normalized = model.toLowerCase().split('/').pop();
  const price = normalized ? PRICES_PER_MILLION[normalized] : undefined;
  if (!price) {
    return null;
  }
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

/** `numeric(10,6)` string for the DB — avoids float drift on money. */
export function toCostString(cost: number | null): string | null {
  return cost === null ? null : cost.toFixed(6);
}
