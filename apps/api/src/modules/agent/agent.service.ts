import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  type AgentAnswer,
  type AgentChunk,
  type AnswerOutcome,
  type EscalationReason,
  type RetrievedChunk,
  type RetrievalResult,
} from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { AnalyticsService } from '../analytics/analytics.service';
import type { ChatTurn } from '../llm/llm.types';
import { LlmService } from '../llm/llm.service';
import { estimateCostUsd, toCostString } from '../llm/pricing';
import { RetrievalService } from '../retrieval/retrieval.service';
import { SettingsService } from '../settings/settings.service';
import { ANSWER_PROMPT_VERSION } from './prompts/answer.v2';
import { buildRetrievalQuery, renderAnswerPrompt } from './prompt';
import { guardReply } from './reply-guard';

/** Char budget → token budget: ~4 chars per token, ×2 headroom. */
const TOKENS_PER_REPLY_CHAR = 0.5;

export interface AskInput {
  question: string;
  kbIds: string[];
  /** Recent turns, oldest first (the playground supplies what it has). */
  history: ChatTurn[];
  /**
   * Conversation context for the `answer_events` row (T-301). The playground
   * and evals omit it; the live reply pipeline (T-203) supplies the ids.
   */
  event?: {
    conversationId: string;
    incomingMessageId: string;
    /** Set only when the caller already posted the answer message. */
    outgoingMessageId?: string;
  };
}

/**
 * Agent — the orchestrator/composition point. Owns no tables.
 * `ask()` is the answer core (FR-4): query build → retrieve → threshold gate →
 * grounded prompt → generate → output guard. The playground exposes it now;
 * the live reply pipeline (T-203/T-204) reuses it and adds Chatwoot I/O and
 * locking. When the caller passes `event` context, the attempt is folded into
 * `answer_events` (T-301).
 */
@Injectable()
export class AgentService {
  private readonly companyName: string;

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmService,
    private readonly settings: SettingsService,
    private readonly analytics: AnalyticsService,
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

    let answer: AgentAnswer;
    if (retrieval.trace.bestScore === null) {
      this.logger.log(
        `escalating (low_score): nothing above threshold ${retrieval.trace.threshold} — no grounded answer possible`,
        AgentService.name,
      );
      answer = escalate('low_score');
    } else {
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
        answer = escalate('guard', {
          latency: { retrievalMs, generationMs, totalMs: Date.now() - startedAt },
          tokens: { input: reply.usage.inputTokens, output: reply.usage.outputTokens },
          model: reply.model,
        });
      } else {
        answer = {
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

    await this.recordEvent(input, answer, query, retrieval);
    return answer;
  }

  /**
   * Fold the attempt into `answer_events` — only when the caller passed
   * conversation context. Failures are swallowed inside AnalyticsService:
   * analytics never breaks a reply (tests: "records an answer event …").
   */
  private async recordEvent(
    input: AskInput,
    answer: AgentAnswer,
    query: string,
    retrieval: RetrievalResult,
  ): Promise<void> {
    if (!input.event) {
      return;
    }

    await this.analytics.recordAnswerEvent({
      conversationId: input.event.conversationId,
      incomingMessageId: input.event.incomingMessageId,
      outgoingMessageId: input.event.outgoingMessageId ?? null,
      outcome: outcomeOf(answer),
      queryText: query,
      topK: retrieval.trace.topK,
      topScore: retrieval.trace.bestScore,
      retrievedChunkIds: retrieval.chunks.map((chunk) => chunk.chunkId),
      embeddingMs: retrieval.trace.embeddingMs,
      retrievalMs: answer.latency.retrievalMs,
      generationMs: answer.latency.generationMs,
      totalMs: answer.latency.totalMs,
      chatModel: answer.model,
      tokensIn: answer.tokens.input,
      tokensOut: answer.tokens.output,
      estimatedCostUsd: toCostString(
        estimateCostUsd(answer.model, answer.tokens.input, answer.tokens.output),
      ),
    });
  }
}

function outcomeOf(answer: AgentAnswer): AnswerOutcome {
  if (!answer.escalated) {
    return 'answered';
  }
  return answer.escalationReason === 'guard' ? 'escalated_guard' : 'escalated_low_score';
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
