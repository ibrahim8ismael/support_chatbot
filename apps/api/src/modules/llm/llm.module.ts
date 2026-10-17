import { Module } from '@nestjs/common';

import { InfraModule } from '../infra/infra.module';
import { LlmService } from './llm.service';

/**
 * LLM — model/provider access only (ADR-0005): `embed`, `generateReply`,
 * `classify` + provider configuration. Prompt *policy* lives with the calling
 * modules (`agent`, `retrieval`) as versioned templates.
 */
@Module({
  imports: [InfraModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
