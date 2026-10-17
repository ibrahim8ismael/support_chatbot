import { Injectable } from '@nestjs/common';

/**
 * Agent — the orchestrator/composition point. Owns no tables.
 * Exposes to other modules: handleIncomingMessage() — the pipeline that glues
 * chatwoot → retrieval → llm → chatwoot (docs/architecture/message-flow.md).
 * Does NOT do: anything reusable — reusable code lives in the owning modules.
 *
 * TODO(agent): filter matrix (docs/integrations/chatwoot.md), reply-job worker
 * with jobId `reply:<conversation_id>`, prompt templates as versioned files,
 * decision thresholds from `settings`, handoff via `chatwoot`.
 */
@Injectable()
export class AgentService {}
