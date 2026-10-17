/**
 * Rough token estimate (~word count) shared by the mock provider (usage
 * accounting) and ingestion (chunk sizing). Words are not BPE tokens, but the
 * pipeline only needs a stable yardstick; swap in a real tokenizer if exact
 * counts ever matter.
 */
export function estimateTokens(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}
