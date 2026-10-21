/** `ingest-document` job payload (ADR-0006; consumed by the ingestion worker). */
export interface IngestDocumentJob {
  documentId: string;
}

/** `sandbox-run` job payload: one job executes every pending case in the run. */
export interface SandboxRunJob {
  runId: string;
}

/** Normalized Chatwoot Agent Bot events accepted by the reply worker. */
export type ChatwootWebhookJob =
  | {
      kind: 'message_created';
      accountId: number;
      chatwootMessageId: number;
      chatwootConversationId: number;
      chatwootInboxId: number;
      contactChatwootId: number;
      contactName: string | null;
      content: string;
      contentType: string;
      hasAttachments: boolean;
      createdAt: string | null;
      assigneeId: number | null;
      labels: string[];
    }
  | {
      kind: 'conversation_updated';
      accountId: number;
      chatwootConversationId: number;
      chatwootInboxId: number;
      /** Undefined means Chatwoot omitted assignment state from this event. */
      assigneeId?: number | null;
      /** Undefined means Chatwoot omitted the label snapshot from this event. */
      labels?: string[];
    };
