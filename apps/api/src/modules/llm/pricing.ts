/**
 * Rough USD price table (per 1M tokens) for `answer_events.estimated_cost_usd`.
 * Prices are list prices, checked 2026-10; they drift, so the recorded value is
 * an *estimate* for trend lines, never billing. Unknown models return `null` —
 * analytics shows "—" instead of a wrong number. Provider qualifiers and
 * OpenRouter vendor prefixes are normalised (`gemini:gemini-3.8-flash`,
 * `vertex:gemini-3.8-flash` and `openrouter:openai/gpt-4.1-mini` price as their
 * model id).
 */
const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  // Gemini list prices (Gemini 3.8/3.6 Flash are promotional through Dec 2026).
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
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
  const withoutProvider = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model;
  const normalized = withoutProvider.toLowerCase().split('/').pop();
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
