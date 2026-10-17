import { Body, Controller, Post } from '@nestjs/common';

import {
  USER_ROLES,
  playgroundAskSchema,
  type AgentAnswer,
  type PlaygroundAsk,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { Roles } from '../auth/auth.decorators';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { AgentService } from './agent.service';

/**
 * `POST /playground/ask` (rest-api.md) — tune the RAG loop from the dashboard:
 * the full answer path with no Chatwoot involvement. Any signed-in role.
 */
@Controller('playground')
export class PlaygroundController {
  constructor(
    private readonly agent: AgentService,
    private readonly knowledgeBase: KnowledgeBaseService,
  ) {}

  @Roles(...USER_ROLES)
  @Post('ask')
  async ask(@Body(new ZodBodyPipe(playgroundAskSchema)) body: PlaygroundAsk): Promise<AgentAnswer> {
    // 404 before spending embedding/generation budget on unknown KBs.
    await Promise.all([...new Set(body.kbIds)].map((kbId) => this.knowledgeBase.getSummary(kbId)));
    return this.agent.ask({
      question: body.question,
      kbIds: body.kbIds,
      history: body.history ?? [],
    });
  }
}
