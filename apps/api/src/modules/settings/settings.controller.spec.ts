import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { SessionUser, Settings } from '@support-agent/shared';

import type { EmbedResult, GenerateReplyResult } from '../llm/llm.types';
import type { LlmService } from '../llm/llm.service';
import { SettingsController } from './settings.controller';
import type { SettingsService } from './settings.service';

const USER: SessionUser = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'editor@example.com',
  name: 'Editor',
  role: 'editor',
};

const SNAPSHOT: Settings = {
  bot_enabled: true,
  system_prompt: 'prompt',
  fallback_message: 'fallback',
  retrieval_top_k: 10,
  retrieval_score_threshold: 0.35,
  context_chunks: 5,
  max_reply_chars: 800,
  embedding_model: 'text-embedding-3-small',
  chat_model: 'gpt-4.1-mini',
};

const EMBED_RESULT: EmbedResult = {
  embeddings: [[0.1, 0.2]],
  model: 'mock-embedding-1536',
  dimensions: 1536,
  tokens: 1,
  cacheHits: 0,
  latencyMs: 3,
};

const REPLY_RESULT: GenerateReplyResult = {
  text: 'I received: ping',
  model: 'mock-chat',
  usage: { inputTokens: 2, outputTokens: 3 },
  finishReason: 'stop',
  latencyMs: 4,
};

function buildHarness(options: { embedError?: Error } = {}) {
  const settingsService = {
    get: vi.fn(async () => SNAPSHOT),
    update: vi.fn(async () => SNAPSHOT),
  } as unknown as SettingsService;

  const llm = {
    embed: options.embedError
      ? vi.fn(async () => {
          throw options.embedError;
        })
      : vi.fn(async () => EMBED_RESULT),
    generateReply: vi.fn(async () => REPLY_RESULT),
  } as unknown as LlmService;

  return {
    controller: new SettingsController(settingsService, llm),
    settingsService,
    llm,
  };
}

describe('SettingsController', () => {
  it('returns the typed settings snapshot', async () => {
    const { controller } = buildHarness();

    await expect(controller.get()).resolves.toEqual(SNAPSHOT);
  });

  it('delegates partial updates with the acting user', async () => {
    const { controller, settingsService } = buildHarness();

    await controller.update({ bot_enabled: false }, USER);

    expect(settingsService.update).toHaveBeenCalledWith({ bot_enabled: false }, USER.id);
  });

  it('reports a passing LLM health check', async () => {
    const { controller, llm } = buildHarness();

    const result = await controller.checkLlm();

    expect(result).toMatchObject({
      status: 'ok',
      embedding: { model: 'mock-embedding-1536', dimensions: 1536, latencyMs: 3 },
      chat: { model: 'mock-chat', latencyMs: 4 },
    });
    expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(llm.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'ping' }],
      }),
    );
  });

  it('turns provider failures into a 503 for the admin screen', async () => {
    const { controller } = buildHarness({ embedError: new Error('provider down') });

    await expect(controller.checkLlm()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(controller.checkLlm()).rejects.toThrow(/provider down/);
  });
});
