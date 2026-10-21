import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE, type ChatwootWebhookJob } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { redisOptions } from '../infra/redis-options';
import { LockService } from '../infra/lock.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { BindingsService } from '../bindings/bindings.service';
import { ChatwootService } from '../chatwoot/chatwoot.service';
import {
  ConversationsService,
  type Conversation,
  type Message,
} from '../conversations/conversations.service';
import { SettingsService } from '../settings/settings.service';
import { AgentService } from './agent.service';

const WORKER_NAME = 'AgentReplyWorker';
const REPLY_CONCURRENCY = 4;
const CONTEXT_MESSAGES = 8;
const PAUSE_LABEL = 'ai-paused';
const ESCALATION_LABEL = 'ai-escalated';

export interface AgentReplyJobDeps {
  agent: AgentService;
  analytics: AnalyticsService;
  bindings: BindingsService;
  chatwoot: ChatwootService;
  conversations: ConversationsService;
  locks: LockService;
  logger: AppLogger;
  settings: SettingsService;
}

/** All Chatwoot I/O and model work stays outside the request/ack path. */
export async function processChatwootWebhookJob(
  job: Job<ChatwootWebhookJob>,
  deps: AgentReplyJobDeps,
): Promise<void> {
  const event = job.data;
  if (event.kind === 'conversation_updated') {
    await syncConversationState(event, deps);
    return;
  }

  const kbIds = await deps.bindings.getBoundKbIdsForInbox(event.chatwootInboxId);
  if (kbIds.length === 0) return;

  const conversation = await deps.conversations.upsertConversation({
    chatwootAccountId: event.accountId,
    chatwootConversationId: event.chatwootConversationId,
    chatwootInboxId: event.chatwootInboxId,
    contactChatwootId: event.contactChatwootId,
    contactName: event.contactName,
  });

  const incoming = await deps.conversations.recordMessage({
    conversationId: conversation.id,
    chatwootMessageId: event.chatwootMessageId,
    direction: 'incoming',
    senderType: 'contact',
    content: event.content || `[${event.contentType} message]`,
    createdAt: event.createdAt ? new Date(event.createdAt) : undefined,
  });

  await syncStateFromMessage(conversation, event.assigneeId, event.labels, deps);
  if (
    event.assigneeId !== null ||
    event.labels.includes(PAUSE_LABEL) ||
    event.labels.includes(ESCALATION_LABEL)
  ) {
    return;
  }

  // Webhook retries use the same Chatwoot message id. A completed answer event
  // with an attached outgoing message is the durable duplicate guard.
  const priorAnswer = await deps.analytics.findAnswerEventForIncomingMessage(incoming.message.id);
  if (priorAnswer?.outgoingMessageId) return;

  const settings = await deps.settings.get();
  if (!settings.bot_enabled) return;

  await deps.locks.withLock(
    `conversation:${event.accountId}:${event.chatwootConversationId}`,
    async () => {
      const current = await deps.conversations.findById(conversation.id);
      if (!current || current.botState !== 'active') return;

      const latestMessages = await deps.conversations.recentMessages(conversation.id, {
        limit: CONTEXT_MESSAGES + 1,
      });
      const newerIncoming = latestMessages.find(
        (message) =>
          message.direction === 'incoming' &&
          message.createdAt > incoming.message.createdAt &&
          message.id !== incoming.message.id,
      );
      if (newerIncoming) return;

      if (event.contentType !== 'text' || event.hasAttachments || !event.content.trim()) {
        if (!priorAnswer) {
          await deps.analytics.recordAnswerEvent({
            conversationId: conversation.id,
            incomingMessageId: incoming.message.id,
            outcome: 'escalated_classifier',
            queryText: event.content,
          });
        }
        await handoff(
          event,
          conversation,
          incoming.message.id,
          settings.fallback_message,
          `${event.content.trim() ? `Unsupported customer message type: ${event.contentType}` : 'Empty customer message'}` +
            `${event.hasAttachments ? ' with attachments' : ''}. A human should review it.`,
          deps,
        );
        return;
      }

      if (asksForHuman(event.content)) {
        if (!priorAnswer) {
          await deps.analytics.recordAnswerEvent({
            conversationId: conversation.id,
            incomingMessageId: incoming.message.id,
            outcome: 'escalated_request',
            queryText: event.content,
          });
        }
        await handoff(
          event,
          conversation,
          incoming.message.id,
          "I'll bring a human teammate into this conversation.",
          'The customer explicitly asked to speak with a human agent.',
          deps,
        );
        return;
      }

      const history = latestMessages
        .filter((message) => message.id !== incoming.message.id)
        .slice(-CONTEXT_MESSAGES)
        .map(toChatTurn);
      const answer = await deps.agent.ask({
        question: event.content,
        kbIds,
        history,
        event: { conversationId: conversation.id, incomingMessageId: incoming.message.id },
      });

      const stillActive = await deps.conversations.findById(conversation.id);
      if (!stillActive || stillActive.botState !== 'active') return;
      const currentSettings = await deps.settings.get();
      const currentKbIds = await deps.bindings.getBoundKbIdsForInbox(event.chatwootInboxId);
      if (!currentSettings.bot_enabled || currentKbIds.length === 0) return;

      if (answer.escalated) {
        await handoff(
          event,
          conversation,
          incoming.message.id,
          answer.answer,
          `The bot escalated this message (${answer.escalationReason ?? 'unspecified'}). ` +
            `Retrieved chunks: ${answer.chunks.map((chunk) => chunk.document).join(', ') || 'none'}.`,
          deps,
        );
        return;
      }

      const chatwootMessageId = await deps.chatwoot.sendMessage(
        event.chatwootConversationId,
        answer.answer,
      );
      const outgoing = await deps.conversations.recordMessage({
        conversationId: conversation.id,
        chatwootMessageId,
        direction: 'outgoing',
        senderType: 'bot',
        content: answer.answer,
        createdAt: new Date(),
      });
      const answerEvent = await deps.analytics.findAnswerEventForIncomingMessage(
        incoming.message.id,
      );
      if (answerEvent) {
        await deps.analytics.attachOutgoingMessage(answerEvent.id, outgoing.message.id);
      }
      deps.logger.log(
        `answered Chatwoot conversation ${event.chatwootConversationId} (message ${event.chatwootMessageId})`,
        WORKER_NAME,
      );
    },
    { ttlMs: 120_000, waitMs: 30_000 },
  );
}

async function syncConversationState(
  event: Extract<ChatwootWebhookJob, { kind: 'conversation_updated' }>,
  deps: AgentReplyJobDeps,
): Promise<void> {
  const conversation = await deps.conversations.findByChatwootId(
    event.accountId,
    event.chatwootConversationId,
  );
  if (!conversation) return;

  const nextState = event.labels?.includes(PAUSE_LABEL)
    ? 'paused'
    : event.labels?.includes(ESCALATION_LABEL) || event.assigneeId != null
      ? 'handed_off'
      : event.labels !== undefined && event.assigneeId === null
        ? 'active'
        : conversation.botState;
  if (nextState !== conversation.botState) {
    await deps.conversations.setBotState(conversation.id, nextState);
  }
}

async function syncStateFromMessage(
  conversation: Conversation,
  assigneeId: number | null,
  labels: string[],
  deps: AgentReplyJobDeps,
): Promise<void> {
  const nextState = labels.includes(PAUSE_LABEL)
    ? 'paused'
    : labels.includes(ESCALATION_LABEL) || assigneeId !== null
      ? 'handed_off'
      : conversation.botState;
  if (nextState !== conversation.botState) {
    await deps.conversations.setBotState(conversation.id, nextState);
  }
}

async function handoff(
  event: Extract<ChatwootWebhookJob, { kind: 'message_created' }>,
  conversation: Conversation,
  incomingMessageId: string,
  customerReply: string,
  privateNote: string,
  deps: AgentReplyJobDeps,
): Promise<void> {
  // Label first, then note and customer response. Label updates are idempotent;
  // BullMQ retries can safely complete a handoff interrupted by Chatwoot.
  await deps.chatwoot.setConversationLabel(event.chatwootConversationId, ESCALATION_LABEL, true);
  const noteId = await deps.chatwoot.sendMessage(event.chatwootConversationId, privateNote, {
    private: true,
  });
  await deps.conversations.recordMessage({
    conversationId: conversation.id,
    chatwootMessageId: noteId,
    direction: 'outgoing',
    senderType: 'bot',
    content: privateNote,
    isPrivate: true,
    createdAt: new Date(),
  });
  const replyId = await deps.chatwoot.sendMessage(event.chatwootConversationId, customerReply);
  const outgoing = await deps.conversations.recordMessage({
    conversationId: conversation.id,
    chatwootMessageId: replyId,
    direction: 'outgoing',
    senderType: 'bot',
    content: customerReply,
    createdAt: new Date(),
  });
  const answerEvent = await deps.analytics.findAnswerEventForIncomingMessage(incomingMessageId);
  if (answerEvent) {
    await deps.analytics.attachOutgoingMessage(answerEvent.id, outgoing.message.id);
  }
  await deps.conversations.setBotState(conversation.id, 'handed_off');
  deps.logger.warn(
    `handed off Chatwoot conversation ${event.chatwootConversationId} (message ${event.chatwootMessageId})`,
    WORKER_NAME,
  );
}

function asksForHuman(content: string): boolean {
  const normalized = content.toLowerCase().normalize('NFKC');
  return /\b(human|real person|live agent|human agent|talk to (a )?(person|human|agent)|speak to (a )?(person|human|agent)|representative)\b|موظف|انسان|إنسان|بني آدم|خدمة العملاء|اكلم حد|أكلم حد|عايز اكلم|عايز أكلم|عاوز اتكلم|عاوز أتكلم/.test(
    normalized,
  );
}

function toChatTurn(message: Message): { role: 'user' | 'assistant'; content: string } {
  return {
    role: message.direction === 'incoming' ? 'user' : 'assistant',
    content: message.content,
  };
}

@Injectable()
export class AgentReplyWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly redisUrl: string;
  private worker?: Worker<ChatwootWebhookJob>;

  constructor(
    config: ConfigService,
    private readonly agent: AgentService,
    private readonly analytics: AnalyticsService,
    private readonly bindings: BindingsService,
    private readonly chatwoot: ChatwootService,
    private readonly conversations: ConversationsService,
    private readonly locks: LockService,
    private readonly logger: AppLogger,
    private readonly settings: SettingsService,
  ) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
  }

  onModuleInit(): void {
    const connection = new Redis({
      ...redisOptions(this.redisUrl, REDIS_DB_QUEUE),
      maxRetriesPerRequest: null,
    });
    this.worker = new Worker<ChatwootWebhookJob>(
      QUEUES.reply,
      (job) =>
        processChatwootWebhookJob(job, {
          agent: this.agent,
          analytics: this.analytics,
          bindings: this.bindings,
          chatwoot: this.chatwoot,
          conversations: this.conversations,
          locks: this.locks,
          logger: this.logger,
          settings: this.settings,
        }),
      { connection, concurrency: REPLY_CONCURRENCY },
    );
    this.logger.log(
      `worker online: ${QUEUES.reply} (concurrency ${REPLY_CONCURRENCY})`,
      WORKER_NAME,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
