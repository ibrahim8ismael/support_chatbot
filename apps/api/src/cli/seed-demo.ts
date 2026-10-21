import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  answerEvents,
  chunks,
  conversations,
  documents,
  inboxBindings,
  knowledgeBases,
  messages,
  users,
} from '../db/schema';
import { cleanBlocks } from '../modules/ingestion/cleaning';
import { chunkBlocks } from '../modules/ingestion/chunking';
import { parseDocument } from '../modules/ingestion/parsers';
import { mockEmbedText } from '../modules/llm/providers/mock.provider';

/** Local UI fixtures only. Does not call Chatwoot or a paid model, or reset existing data. */
loadEnv({ path: ['.env.local', '.env'], quiet: true });
const id = (value: number): string => `de000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to the local demo database.');
  const target = new URL(url);
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  ) {
    throw new Error('Demo seeding is restricted to a local, non-production database.');
  }
  if (process.env.LLM_PROVIDER !== 'mock')
    throw new Error('Demo embeddings require LLM_PROVIDER=mock.');
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client);
  try {
    const [actor] = await db.select().from(users).where(eq(users.email, 'demo@example.com'));
    if (!actor) throw new Error('Create demo@example.com before seeding demo content.');
    const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? './data/uploads');
    await mkdir(uploadDir, { recursive: true });
    const libraries = [
      {
        id: id(1),
        name: 'Demo · Customer support',
        description: 'Sample account access, password reset and support information.',
      },
      {
        id: id(2),
        name: 'Demo · Orders & delivery',
        description: 'Sample delivery, tracking and returns policies for UI exploration.',
      },
      {
        id: id(3),
        name: 'Demo · Billing',
        description: 'Sample billing and subscription knowledge. All content is fictional.',
      },
    ];
    for (const library of libraries) {
      await db
        .insert(knowledgeBases)
        .values({ ...library, createdBy: actor.id })
        .onConflictDoNothing();
    }
    const sources = [
      {
        kb: 1,
        title: 'support-faq.md',
        source: 'text' as const,
        mime: 'text/markdown',
        content:
          '# Customer support\n\nTo reset your password, open Settings, select Security, then Reset password. Confirm the reset link sent to your account email. The reset link expires after 30 minutes.\n\nSupport is available Monday to Friday from 9 AM to 5 PM UTC. This is fictional demo content.',
      },
      {
        kb: 2,
        title: 'delivery-policy.md',
        source: 'upload' as const,
        mime: 'text/markdown',
        content:
          '# Delivery and returns\n\nStandard delivery takes 3 to 5 business days. Tracking details are emailed after the order is dispatched.\n\nUnused products may be returned within 14 days of delivery in their original packaging. Contact support with your order number to request a return. This is fictional demo content.',
      },
      {
        kb: 3,
        title: 'billing-guide.md',
        source: 'text' as const,
        mime: 'text/markdown',
        content:
          '# Billing and subscriptions\n\nInvoices are available under Settings, then Billing. Download each invoice as a PDF.\n\nUpdate your payment card in Billing, Payment methods. Subscription cancellation takes effect at the end of the current billing period. This is fictional demo content.',
      },
      {
        kb: 1,
        title: 'reset-guide.pdf',
        source: 'upload' as const,
        mime: 'application/pdf',
        fixture: 'reset-guide.pdf',
      },
      {
        kb: 1,
        title: 'reset-guide.docx',
        source: 'upload' as const,
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fixture: 'reset-guide.docx',
      },
    ];
    const sourceChunks: string[][] = [];
    for (const [index, source] of sources.entries()) {
      const documentId = id(100 + index);
      const buffer = source.fixture
        ? await readFile(path.resolve('test/fixtures', source.fixture))
        : Buffer.from(source.content ?? '', 'utf8');
      const storedName = `demo-${documentId}${path.extname(source.title)}`;
      await writeFile(path.join(uploadDir, storedName), buffer);
      const drafts = chunkBlocks(cleanBlocks(await parseDocument(buffer, source.mime)));
      if (drafts.length === 0)
        throw new Error(`No text extracted from demo source ${source.title}`);
      await db
        .insert(documents)
        .values({
          id: documentId,
          kbId: id(source.kb),
          sourceType: source.source,
          filename: source.title,
          mimeType: source.mime,
          sizeBytes: buffer.byteLength,
          storagePath: storedName,
          status: 'ready',
          chunkCount: drafts.length,
          contentHash: createHash('sha256').update(buffer).digest('hex'),
          createdBy: actor.id,
        })
        .onConflictDoNothing();
      const chunkIds: string[] = [];
      for (const [chunkIndex, draft] of drafts.entries()) {
        const chunkId = id(1000 + index * 100 + chunkIndex);
        chunkIds.push(chunkId);
        await db
          .insert(chunks)
          .values({
            id: chunkId,
            kbId: id(source.kb),
            documentId,
            content: draft.content,
            tokenCount: draft.tokenCount,
            embedding: mockEmbedText(draft.content),
            chunkIndex,
            metadata: draft.metadata,
          })
          .onConflictDoNothing();
      }
      sourceChunks.push(chunkIds);
    }
    const inboxNames = ['Demo · Website support', 'Demo · Orders', 'Demo · Billing'];
    for (const [index, displayName] of inboxNames.entries()) {
      await db
        .insert(inboxBindings)
        .values({
          id: id(200 + index),
          chatwootAccountId: 999999,
          chatwootInboxId: 99001 + index,
          kbIds: [id(index + 1)],
          enabled: false,
          displayName,
        })
        .onConflictDoNothing();
    }
    const examples = [
      {
        question: 'How do I reset my password?',
        answer:
          'Open Settings → Security → Reset password, then confirm the link sent to your email.',
        contact: 'Sarah Ahmed',
      },
      {
        question: 'Where is my order tracking?',
        answer:
          'Your tracking details are emailed when the order is dispatched. Standard delivery takes 3–5 business days.',
        contact: 'Omar Hassan',
      },
      {
        question: 'How can I download an invoice?',
        answer: 'Open Settings → Billing and download the invoice as a PDF.',
        contact: 'Maya Ali',
      },
      {
        question: 'Can you arrange delivery this evening?',
        answer: 'I’ll ask a support colleague to help with your delivery request.',
        contact: 'Noor Ibrahim',
      },
      {
        question: 'I want to speak to a person about a refund.',
        answer: 'A support colleague will help you with the refund request.',
        contact: 'Adam Khaled',
      },
      {
        question: 'ممكن أعرف طريقة استرجاع المنتج؟',
        answer:
          'يمكن إرجاع المنتج غير المستخدم خلال 14 يومًا من الاستلام في عبوته الأصلية. تواصل مع الدعم برقم الطلب.',
        contact: 'ليلى محمد',
      },
    ];
    for (let index = 0; index < 18; index += 1) {
      const sample = examples[index % examples.length]!;
      const createdAt = new Date(Date.now() - ((index % 7) * 24 + (index % 5) + 1) * 3600000);
      const responseAt = new Date(createdAt.getTime() + 2000);
      const escalated = index % 6 === 3 || index % 6 === 4;
      const inboxIndex = index % 3;
      const conversationId = id(300 + index);
      const incomingId = id(400 + index * 3);
      const outgoingId = id(401 + index * 3);
      await db
        .insert(conversations)
        .values({
          id: conversationId,
          chatwootAccountId: 999999,
          chatwootConversationId: 990000001 + index,
          chatwootInboxId: 99001 + inboxIndex,
          contactChatwootId: 990000001 + index,
          contactName: `Demo · ${sample.contact}`,
          botState: escalated ? 'handed_off' : index % 5 === 0 ? 'paused' : 'active',
          lastMessageAt: responseAt,
          createdAt,
        })
        .onConflictDoNothing();
      await db
        .insert(messages)
        .values([
          {
            id: incomingId,
            conversationId,
            chatwootMessageId: 990000001 + index * 3,
            direction: 'incoming',
            senderType: 'contact',
            content: sample.question,
            createdAt,
          },
          {
            id: outgoingId,
            conversationId,
            chatwootMessageId: 990000002 + index * 3,
            direction: 'outgoing',
            senderType: escalated ? 'human_agent' : 'bot',
            content: sample.answer,
            createdAt: responseAt,
          },
          {
            id: id(402 + index * 3),
            conversationId,
            chatwootMessageId: 990000003 + index * 3,
            direction: 'outgoing',
            senderType: 'human_agent',
            isPrivate: true,
            content: 'Demo note: fictional conversation for layout preview.',
            createdAt: new Date(createdAt.getTime() + 1000),
          },
        ])
        .onConflictDoNothing();
      await db.update(messages).set({ senderType: 'contact' }).where(eq(messages.id, incomingId));
      await db
        .insert(answerEvents)
        .values({
          id: id(600 + index),
          conversationId,
          incomingMessageId: incomingId,
          outgoingMessageId: outgoingId,
          outcome: escalated ? 'escalated_low_score' : 'answered',
          queryText: sample.question,
          topK: 10,
          topScore: escalated ? 0.21 : 0.86,
          retrievedChunkIds: sourceChunks[inboxIndex] ?? [],
          retrievalMs: 30 + index,
          generationMs: escalated ? 0 : 720 + index * 12,
          totalMs: escalated ? 50 : 800 + index * 12,
          chatModel: 'demo-sample',
          tokensIn: escalated ? 0 : 520 + index * 7,
          tokensOut: escalated ? 0 : 85 + index,
          estimatedCostUsd: escalated ? '0' : '0.000120',
          createdAt: responseAt,
        })
        .onConflictDoNothing();
    }
    console.log(
      'Demo data ready: 3 knowledge bases, 5 indexed sources, 3 disabled demo inboxes, 18 conversations and analytics events.',
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Demo seeding failed');
  process.exitCode = 1;
});
