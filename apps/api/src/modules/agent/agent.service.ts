import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  type AgentAnswer,
  type AgentChunk,
  type EscalationReason,
  type RetrievedChunk,
} from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import type { ChatTurn } from '../llm/llm.types';
import { LlmService } from '../llm/llm.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { SettingsService } from '../settings/settings.service';
import { ANSWER_PROMPT_VERSION } from './prompts/answer.v1';
import { buildRetrievalQuery, renderAnswerPrompt } from './prompt';
import { guardReply } from './reply-guard';

/** Char budget → token budget: ~4 chars per token, ×2 headroom. */
const TOKENS_PER_REPLY_CHAR = 0.5;

export interface AskInput {
  question: string;
  kbIds: string[];
  /** Recent turns, oldest first (the playground supplies what it has). */
  history: ChatTurn[];
}

/**
 * Agent — the orchestrator/composition point. Owns no tables.
 * `ask()` is the answer core (FR-4): query build → retrieve → threshold gate →
 * grounded prompt → generate → output guard. The playground exposes it now;
 * the live reply pipeline (T-203/T-204) reuses it and adds Chatwoot I/O,
 * locking, and `answer_events` — those need conversation context this core
 * does not have.
 */
@Injectable()
export class AgentService {
  private readonly companyName: string;

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmService,
    private readonly settings: SettingsService,
    private readonly logger: AppLogger,
    config: ConfigService,
  ) {
    this.companyName = config.get<string>('COMPANY_NAME') ?? 'Acme Support';
  }

  async ask(input: AskInput): Promise<AgentAnswer> {
    const startedAt = Date.now();
    const settings = await this.settings.get();

    const query = buildRetrievalQuery(input.question, input.history);
    const retrievalStarted = Date.now();
    const retrieval = await this.retrieval.retrieve(query, input.kbIds);
    const retrievalMs = Date.now() - retrievalStarted;
    const context = retrieval.chunks.slice(0, settings.context_chunks);

    const chunks = context.map(toAgentChunk);
    const escalate = (
      reason: EscalationReason,
      overrides: Partial<AgentAnswer> = {},
    ): AgentAnswer => ({
      answer: settings.fallback_message,
      escalated: true,
      escalationReason: reason,
      chunks,
      latency: { retrievalMs, generationMs: 0, totalMs: Date.now() - startedAt },
      tokens: { input: 0, output: 0 },
      model: null,
      promptVersion: ANSWER_PROMPT_VERSION,
      ...overrides,
    });

    if (retrieval.trace.bestScore === null) {
      this.logger.log(
        `escalating (low_score): nothing above threshold ${retrieval.trace.threshold} — no grounded answer possible`,
        AgentService.name,
      );
      return escalate('low_score');
    }

    const system = renderAnswerPrompt({
      template: settings.system_prompt,
      companyName: this.companyName,
      maxReplyChars: settings.max_reply_chars,
      chunks: context,
      history: input.history,
      question: input.question,
    });

    const generationStarted = Date.now();
    const reply = await this.llm.generateReply({
      system,
      messages: [{ role: 'user', content: input.question }],
      maxOutputTokens: Math.ceil(settings.max_reply_chars * TOKENS_PER_REPLY_CHAR),
    });
    const generationMs = Date.now() - generationStarted;

    const guarded = guardReply({
      reply: reply.text,
      maxChars: settings.max_reply_chars,
      filenames: [...new Set(context.map((chunk) => chunk.filename))],
      chunkContents: context.map((chunk) => chunk.content),
    });

    if (!guarded.ok) {
      this.logger.warn(`escalating (guard): ${guarded.reason}`, AgentService.name);
      return escalate('guard', {
        latency: { retrievalMs, generationMs, totalMs: Date.now() - startedAt },
        tokens: { input: reply.usage.inputTokens, output: reply.usage.outputTokens },
        model: reply.model,
      });
    }

    return {
      answer: guarded.reply,
      escalated: false,
      escalationReason: null,
      chunks,
      latency: { retrievalMs, generationMs, totalMs: Date.now() - startedAt },
      tokens: { input: reply.usage.inputTokens, output: reply.usage.outputTokens },
      model: reply.model,
      promptVersion: ANSWER_PROMPT_VERSION,
    };
  }
}

function toAgentChunk(chunk: RetrievedChunk): AgentChunk {
  return {
    id: chunk.chunkId,
    score: chunk.score,
    content: chunk.content,
    document: chunk.filename,
    metadata: chunk.metadata,
  };
}
