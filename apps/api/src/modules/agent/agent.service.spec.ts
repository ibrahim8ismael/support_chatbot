import { describe, expect, it, vi } from 'vitest';

import type { ConfigService } from '@nestjs/config';

import type { RetrievedChunk } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { GenerateReplyInput } from '../llm/llm.types';
import type { LlmService } from '../llm/llm.service';
import type { RetrievalService } from '../retrieval/retrieval.service';
import type { SettingsService } from '../settings/settings.service';
import { AgentService } from './agent.service';
import { ANSWER_PROMPT_V1 } from './prompts/answer.v1';

const KB = '11111111-1111-4111-8111-111111111111';

interface HarnessOptions {
  chunks?: RetrievedChunk[];
  reply?: string;
  replyUsage?: { inputTokens: number; outputTokens: number };
  maxReplyChars?: number;
  contextChunks?: number;
  systemPrompt?: string;
}

function buildHarness(options: HarnessOptions = {}) {
  const chunks = options.chunks ?? [];
  const retrieve = vi.fn(async (_query: string, _kbIds: string[]) => ({
    chunks,
    trace: {
      query: 'q',
      normalizedQuery: 'q',
      kbIds: [KB],
      topK: 10,
      threshold: 0.35,
      bestScore: chunks[0]?.score ?? null,
      returnedChunks: chunks.length,
      cacheHit: false,
      embeddingMs: 0,
      searchMs: 0,
      totalMs: 1,
    },
  }));
  const retrieval = { retrieve } as unknown as RetrievalService;

  const usage = options.replyUsage ?? { inputTokens: 42, outputTokens: 7 };
  const generateReply = vi.fn(async (_input: GenerateReplyInput) => ({
    text: options.reply ?? 'Here is how to reset your password.',
    model: 'mock-chat',
    usage,
    finishReason: 'stop',
    latencyMs: 1,
  }));
  const llm = { generateReply } as unknown as LlmService;

  const settings = {
    get: vi.fn(async () => ({
      bot_enabled: true,
      system_prompt: options.systemPrompt ?? ANSWER_PROMPT_V1,
      fallback_message: 'Fallback answer.',
      retrieval_top_k: 10,
      retrieval_score_threshold: 0.35,
      context_chunks: options.contextChunks ?? 5,
      max_reply_chars: options.maxReplyChars ?? 800,
      embedding_model: 'mock-embedding',
      chat_model: 'mock-chat',
    })),
  } as unknown as SettingsService;

  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
  const config = {
    get: vi.fn((key: string) => (key === 'COMPANY_NAME' ? 'Acme Support' : undefined)),
  } as unknown as ConfigService;

  const recordAnswerEvent = vi.fn(async (_input: unknown) => undefined);
  const analytics = { recordAnswerEvent } as unknown as AnalyticsService;

  const service = new AgentService(retrieval, llm, settings, analytics, logger, config);
  return { service, retrieve, generateReply, recordAnswerEvent, logger };
}

function chunk(id: string, content: string, score = 0.8, filename = 'guide.pdf'): RetrievedChunk {
  return { chunkId: id, documentId: 'd1', kbId: KB, filename, score, metadata: {}, content };
}

describe('AgentService.ask', () => {
  it('answers from retrieved chunks with the full trace', async () => {
    const { service, generateReply } = buildHarness({
      chunks: [chunk('c1', 'Reset via Settings.'), chunk('c2', 'Then confirm by email.')],
    });

    const result = await service.ask({
      question: 'How do I reset my password?',
      kbIds: [KB],
      history: [{ role: 'user', content: 'My password is gone.' }],
    });

    expect(result.escalated).toBe(false);
    expect(result.answer).toBe('Here is how to reset your password.');
    expect(result.chunks.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(result.chunks[0]).toMatchObject({ document: 'guide.pdf', score: 0.8 });
    expect(result.tokens).toEqual({ input: 42, output: 7 });
    expect(result.model).toBe('mock-chat');
    expect(result.promptVersion).toBe('answer.v1');
    expect(result.latency.totalMs).toBeGreaterThanOrEqual(0);

    expect(generateReply).toHaveBeenCalledTimes(1);
    const input = generateReply.mock.calls[0]?.[0];
    expect(input?.messages).toEqual([{ role: 'user', content: 'How do I reset my password?' }]);
    expect(input?.system).toContain('<kb id="c1">');
    expect(input?.system).toContain('Reset via Settings.');
    expect(input?.system).toContain('Customer: My password is gone.');
    expect(input?.maxOutputTokens).toBe(400);
  });

  it('feeds recent customer turns into the retrieval query for short messages', async () => {
    const { service, retrieve } = buildHarness({ chunks: [chunk('c1', 'x')] });

    await service.ask({
      question: 'And the price?',
      kbIds: [KB],
      history: [{ role: 'user', content: 'Tell me about the annual plan' }],
    });

    expect(retrieve).toHaveBeenCalledWith('Tell me about the annual plan\nAnd the price?', [KB]);
  });

  it('passes long standalone questions through as-is', async () => {
    const { service, retrieve } = buildHarness({ chunks: [chunk('c1', 'x')] });
    const question = 'What are the exact steps to configure the annual enterprise plan?';

    await service.ask({ question, kbIds: [KB], history: [{ role: 'user', content: 'ignored' }] });

    expect(retrieve).toHaveBeenCalledWith(question, [KB]);
  });

  it('escalates without generating when nothing clears the threshold', async () => {
    const { service, generateReply } = buildHarness({ chunks: [] });

    const result = await service.ask({ question: 'q', kbIds: [KB], history: [] });

    expect(result).toMatchObject({
      answer: 'Fallback answer.',
      escalated: true,
      escalationReason: 'low_score',
      model: null,
    });
    expect(result.tokens).toEqual({ input: 0, output: 0 });
    expect(result.chunks).toEqual([]);
    expect(generateReply).not.toHaveBeenCalled();
  });

  it('caps the grounded context at context_chunks', async () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      chunk(`c${index + 1}`, `content ${index + 1}`),
    );
    const { service, generateReply } = buildHarness({ chunks: many, contextChunks: 2 });

    const result = await service.ask({ question: 'q', kbIds: [KB], history: [] });

    expect(result.chunks.map((c) => c.id)).toEqual(['c1', 'c2']);
    const system = generateReply.mock.calls[0]?.[0]?.system ?? '';
    expect(system.match(/<kb id="/g)).toHaveLength(2);
  });

  it('escalates through the guard when the reply leaks internals', async () => {
    const { service } = buildHarness({
      chunks: [chunk('c1', 'x')],
      reply: 'I checked the knowledge base and file guide.pdf.',
    });

    const result = await service.ask({ question: 'q', kbIds: [KB], history: [] });

    expect(result).toMatchObject({
      answer: 'Fallback answer.',
      escalated: true,
      escalationReason: 'guard',
    });
    expect(result.tokens).toEqual({ input: 42, output: 7 });
  });

  it('caps long replies at max_reply_chars', async () => {
    const { service } = buildHarness({
      chunks: [chunk('c1', 'x')],
      reply: 'y'.repeat(1_200),
      maxReplyChars: 100,
    });

    const result = await service.ask({ question: 'q', kbIds: [KB], history: [] });

    expect(result.escalated).toBe(false);
    expect(result.answer.length).toBe(100);
    expect(result.answer.endsWith('…')).toBe(true);
  });

  it('records an answer event with the retrieval trace when context is given', async () => {
    const conversationId = '44444444-4444-4444-8444-444444444444';
    const incomingMessageId = '55555555-5555-4555-8555-555555555555';
    const { service, recordAnswerEvent } = buildHarness({
      chunks: [chunk('c1', 'Reset via Settings.', 0.9), chunk('c2', 'Then confirm.')],
      contextChunks: 1,
    });

    await service.ask({
      question: 'How do I reset my password?',
      kbIds: [KB],
      history: [],
      event: { conversationId, incomingMessageId },
    });

    expect(recordAnswerEvent).toHaveBeenCalledTimes(1);
    expect(recordAnswerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId,
        incomingMessageId,
        outcome: 'answered',
        queryText: 'How do I reset my password?',
        topK: 10,
        topScore: 0.9,
        // All retrieved candidates, not just the ones that fit the prompt.
        retrievedChunkIds: ['c1', 'c2'],
        chatModel: 'mock-chat',
        tokensIn: 42,
        tokensOut: 7,
      }),
    );
  });

  it('maps guard and low-score escalations to their outcomes', async () => {
    const event = { conversationId: 'conv-1', incomingMessageId: 'msg-1' };

    const guarded = buildHarness({
      chunks: [chunk('c1', 'x')],
      reply: 'I checked the knowledge base and file guide.pdf.',
    });
    await guarded.service.ask({ question: 'q', kbIds: [KB], history: [], event });
    expect(guarded.recordAnswerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'escalated_guard', chatModel: 'mock-chat' }),
    );

    const empty = buildHarness({ chunks: [] });
    await empty.service.ask({ question: 'q', kbIds: [KB], history: [], event });
    expect(empty.recordAnswerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'escalated_low_score', topScore: null }),
    );
  });

  it('does not touch analytics without conversation context', async () => {
    const { service, recordAnswerEvent } = buildHarness({ chunks: [chunk('c1', 'x')] });

    await service.ask({ question: 'q', kbIds: [KB], history: [] });

    expect(recordAnswerEvent).not.toHaveBeenCalled();
  });
});
