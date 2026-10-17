import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '@support-agent/shared';

import {
  createEchoLanguageModel,
  createFeatureHashEmbeddingModel,
  estimateTokens,
  mockEmbedText,
  mockJsonFromSchema,
} from './mock.provider';

function l2Norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

/** Vectors are unit-length, so the dot product is the cosine similarity. */
function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

describe('mockEmbedText', () => {
  it('is deterministic and unit-length with the locked dimensions', () => {
    const first = mockEmbedText('How do I reset my password?');
    const second = mockEmbedText('How do I reset my password?');

    expect(first).toEqual(second);
    expect(first).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(l2Norm(first)).toBeCloseTo(1, 6);
  });

  it('scores shared wording higher than unrelated wording', () => {
    const query = mockEmbedText('reset my password steps');
    const related = mockEmbedText('steps to reset a password quickly');
    const unrelated = mockEmbedText('where is the billing invoice for october');

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it('returns the zero vector when there is nothing to hash', () => {
    expect(mockEmbedText('   ')).toEqual(new Array<number>(EMBEDDING_DIMENSIONS).fill(0));
  });
});

describe('mockJsonFromSchema', () => {
  it('builds a schema-shaped sample (booleans true, enums first, nullable null)', () => {
    const sample = mockJsonFromSchema({
      type: 'object',
      properties: {
        can_answer: { type: 'boolean' },
        escalate_reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        intent: { enum: ['question', 'other'] },
        nested: { type: 'object', properties: { count: { type: 'integer' } } },
      },
    });

    expect(sample).toEqual({
      can_answer: true,
      escalate_reason: null,
      intent: 'question',
      nested: { count: 0 },
    });
  });
});

describe('mock embedding model', () => {
  it('embeds values in order and reports token usage', async () => {
    const model = createFeatureHashEmbeddingModel();
    const result = await model.doEmbed({ values: ['alpha beta', 'gamma'] });

    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toEqual(mockEmbedText('alpha beta'));
    expect(result.embeddings[1]).toEqual(mockEmbedText('gamma'));
    expect(result.usage?.tokens).toBe(3);
    expect(model.maxEmbeddingsPerCall).toBe(100);
  });
});

describe('mock echo language model', () => {
  it('echoes the last user message (M0 loop: "I received: …")', async () => {
    const model = createEchoLanguageModel();
    const result = await model.doGenerate({
      prompt: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: [{ type: 'text', text: 'where is my order?' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'checking' }] },
        { role: 'user', content: [{ type: 'text', text: 'any update?' }] },
      ],
    });

    expect(result.content).toEqual([{ type: 'text', text: 'I received: any update?' }]);
    expect(result.finishReason.unified).toBe('stop');
    expect(result.usage.inputTokens.total).toBeGreaterThan(0);
    expect(result.usage.outputTokens.total).toBe(estimateTokens('I received: any update?'));
  });
});
