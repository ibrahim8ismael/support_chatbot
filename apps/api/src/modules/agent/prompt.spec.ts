import { describe, expect, it } from 'vitest';

import type { RetrievedChunk } from '@support-agent/shared';

import { buildRetrievalQuery, renderAnswerPrompt } from './prompt';
import { ANSWER_PROMPT_V1 } from './prompts/answer.v1';

function chunk(id: string, content: string, filename = 'guide.pdf'): RetrievedChunk {
  return {
    chunkId: id,
    documentId: 'd1',
    kbId: 'k1',
    filename,
    score: 0.8,
    metadata: {},
    content,
  };
}

describe('renderAnswerPrompt', () => {
  it('fills every placeholder and emits one kb block per chunk', () => {
    const rendered = renderAnswerPrompt({
      template: ANSWER_PROMPT_V1,
      companyName: 'Acme Support',
      maxReplyChars: 800,
      chunks: [chunk('c1', 'Reset via Settings.'), chunk('c2', 'Then confirm by email.')],
      history: [{ role: 'user', content: 'My password is gone.' }],
      question: 'How do I reset my password?',
    });

    expect(rendered).not.toContain('{{');
    expect(rendered).toContain('<kb id="c1">\nReset via Settings.\n</kb>');
    expect(rendered).toContain('<kb id="c2">\nThen confirm by email.\n</kb>');
    expect(rendered).toContain('Customer: My password is gone.');
    expect(rendered).toContain('How do I reset my password?');
    expect(rendered).toContain('max 800 characters');
    expect(rendered).toContain('for Acme Support');
    // The repetition marker is consumed together with the block.
    expect(rendered).toContain('</kb>\n[CONVERSATION SO FAR]');
  });

  it('inserts user text literally (no $-pattern expansion)', () => {
    const rendered = renderAnswerPrompt({
      template: ANSWER_PROMPT_V1,
      companyName: 'Acme Support',
      maxReplyChars: 100,
      chunks: [chunk('c1', 'Use $& carefully.')],
      history: [],
      question: 'Cost is $&100?',
    });

    expect(rendered).toContain('Use $& carefully.');
    expect(rendered).toContain('Cost is $&100?');
    expect(rendered).toContain('(no earlier messages)');
  });

  it('appends knowledge when an edited template lost the kb block', () => {
    const rendered = renderAnswerPrompt({
      template: 'Custom instructions.\n{{chunk_content}}',
      companyName: 'Acme',
      maxReplyChars: 200,
      chunks: [chunk('c1', 'Only truth.')],
      history: [],
      question: 'Q?',
    });

    expect(rendered).toContain('Custom instructions.');
    expect(rendered).toContain('[KNOWLEDGE]\n<kb id="c1">\nOnly truth.\n</kb>');
    expect(rendered).not.toContain('{{chunk_content}}');
  });

  it('keeps only the most recent turns in the conversation section', () => {
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: 'user' as const,
      content: `turn ${index + 1}`,
    }));

    const rendered = renderAnswerPrompt({
      template: ANSWER_PROMPT_V1,
      companyName: 'Acme Support',
      maxReplyChars: 800,
      chunks: [chunk('c1', 'x')],
      history,
      question: 'q',
    });

    expect(rendered).not.toContain('Customer: turn 2\nCustomer: turn 3');
    expect(rendered).toContain('Customer: turn 3\nCustomer: turn 4');
    expect(rendered).toContain('Customer: turn 10');
  });
});

describe('buildRetrievalQuery', () => {
  it('passes long standalone questions through', () => {
    const question = 'What are the exact steps to configure the annual enterprise plan?';

    expect(buildRetrievalQuery(question, [{ role: 'user', content: 'earlier' }])).toBe(question);
  });

  it('prefixes short referential questions with recent customer turns', () => {
    const query = buildRetrievalQuery('And the price?', [
      { role: 'user', content: 'Tell me about the annual plan' },
      { role: 'assistant', content: 'It starts at...' },
      { role: 'user', content: 'Does it include support?' },
    ]);

    expect(query).toBe('Tell me about the annual plan\nDoes it include support?\nAnd the price?');
  });

  it('truncates by keeping the tail of overly long queries', () => {
    const long = 'x'.repeat(1_200);

    expect(buildRetrievalQuery(long, [])).toBe(long.slice(200));
  });
});
