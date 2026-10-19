import { Body, Controller, Post } from '@nestjs/common';

import {
  USER_ROLES,
  playgroundAskSchema,
  type AgentAnswer,
  type PlaygroundAsk,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { LlmQuotaService } from '../infra/llm-quota.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { AgentService } from './agent.service';

/**
 * `POST /playground/ask` (rest-api.md) — tune the RAG loop from the dashboard:
 * the full answer path with no Chatwoot involvement. Any signed-in role, but
 * rate-capped per user (and by the global daily budget) — paid calls must not
 * be loopable (backend audit HIGH).
 */
@Controller('playground')
export class PlaygroundController {
  constructor(
    private readonly agent: AgentService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly quota: LlmQuotaService,
  ) {}

  @Roles(...USER_ROLES)
  @Post('ask')
  async ask(
    @Body(new ZodBodyPipe(playgroundAskSchema)) body: PlaygroundAsk,
    @CurrentUser() user: SessionUser,
  ): Promise<AgentAnswer> {
    await this.quota.enforce(user.id);
    // 404 before spending embedding/generation budget on unknown KBs.
    await Promise.all([...new Set(body.kbIds)].map((kbId) => this.knowledgeBase.getSummary(kbId)));
    return this.agent.ask({
      question: body.question,
      kbIds: body.kbIds,
      history: body.history ?? [],
    });
  }
}
