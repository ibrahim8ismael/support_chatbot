import { Module } from '@nestjs/common';

import { AgentService } from './agent.service';

/**
 * The orchestrator imports the modules it composes (chatwoot, conversations,
 * retrieval, llm, settings, analytics, bindings) — keep those imports here as
 * the pipeline is implemented, not before.
 */
@Module({
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
