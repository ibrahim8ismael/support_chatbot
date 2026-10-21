import { describe, expect, it } from 'vitest';

import { estimateCostUsd, toCostString } from './pricing';

describe('estimateCostUsd', () => {
  it('prices known models from tokens in and out', () => {
    // 1M in + 1M out on gpt-4.1-mini: 0.4 + 1.6
    expect(estimateCostUsd('gpt-4.1-mini', 1_000_000, 1_000_000)).toBeCloseTo(2, 10);
    expect(estimateCostUsd('gpt-4.1', 500_000, 0)).toBeCloseTo(1, 10);
  });

  it('normalises provider-qualified and OpenRouter-style prefixed ids', () => {
    expect(estimateCostUsd('openai/gpt-4.1-mini', 1_000_000, 0)).toBeCloseTo(0.4, 10);
    expect(estimateCostUsd('openai:gpt-4.1-mini', 1_000_000, 0)).toBeCloseTo(0.4, 10);
    expect(estimateCostUsd('openrouter:openai/gpt-4.1-mini', 1_000_000, 0)).toBeCloseTo(0.4, 10);
  });

  it('prices Gemini models with provider-qualified ids', () => {
    expect(estimateCostUsd('gemini:gemini-3.8-flash', 1_000_000, 1_000_000)).toBeCloseTo(4.5, 10);
    expect(estimateCostUsd('gemini:gemini-3.1-flash-lite', 1_000_000, 0)).toBeCloseTo(0.25, 10);
    // Vertex serves the same Gemini models — the provider prefix is normalised.
    expect(estimateCostUsd('vertex:gemini-3.8-flash', 1_000_000, 1_000_000)).toBeCloseTo(4.5, 10);
  });

  it('returns null for unknown or missing models (no wrong numbers)', () => {
    expect(estimateCostUsd('mock-chat', 100, 100)).toBeNull();
    expect(estimateCostUsd('anthropic/claude-x', 100, 100)).toBeNull();
    expect(estimateCostUsd(null, 100, 100)).toBeNull();
    expect(estimateCostUsd(undefined, 100, 100)).toBeNull();
  });
});

describe('toCostString', () => {
  it('formats as numeric(10,6) and passes null through', () => {
    expect(toCostString(0.00042)).toBe('0.000420');
    expect(toCostString(0)).toBe('0.000000');
    expect(toCostString(null)).toBeNull();
  });
});
