import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import {
  sandboxCaseInputSchema,
  sandboxCaseUpdateSchema,
  sandboxResultReviewSchema,
  sandboxRunInputSchema,
  type SandboxCase,
  type SandboxCaseInput,
  type SandboxCaseUpdate,
  type SandboxResult,
  type SandboxResultReview,
  type SandboxRun,
  type SandboxRunInput,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { SandboxService } from './sandbox.service';

/**
 * /api/sandbox — owner-facing accuracy testing (docs/product/sandbox.md).
 * Try-it uses the existing `/playground/ask`. Cases and batch runs are
 * editor/admin; deleting a case is admin-only. Runs are paid model calls, so
 * creation is capped per user per day inside the service.
 */
@Controller('sandbox')
export class SandboxController {
  constructor(private readonly sandbox: SandboxService) {}

  @Roles('editor', 'admin')
  @Get('cases')
  listCases(): Promise<SandboxCase[]> {
    return this.sandbox.listCases();
  }

  @Roles('editor', 'admin')
  @Post('cases')
  createCase(
    @Body(new ZodBodyPipe(sandboxCaseInputSchema)) body: SandboxCaseInput,
    @CurrentUser() user: SessionUser,
  ): Promise<SandboxCase> {
    return this.sandbox.createCase(body, user.id);
  }

  @Roles('editor', 'admin')
  @Patch('cases/:id')
  updateCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(sandboxCaseUpdateSchema)) body: SandboxCaseUpdate,
    @CurrentUser() user: SessionUser,
  ): Promise<SandboxCase> {
    return this.sandbox.updateCase(id, body, user.id);
  }

  @Roles('admin')
  @Delete('cases/:id')
  async deleteCase(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<{ status: 'ok' }> {
    await this.sandbox.deleteCase(id, user.id);
    return { status: 'ok' };
  }

  @Roles('editor', 'admin')
  @Get('runs')
  listRuns(): Promise<SandboxRun[]> {
    return this.sandbox.listRuns();
  }

  @Roles('editor', 'admin')
  @Post('runs')
  createRun(
    @Body(new ZodBodyPipe(sandboxRunInputSchema)) body: SandboxRunInput,
    @CurrentUser() user: SessionUser,
  ): Promise<SandboxRun> {
    return this.sandbox.createRun(body, user.id);
  }

  @Roles('editor', 'admin')
  @Get('runs/:id')
  getRun(@Param('id', ParseUUIDPipe) id: string): Promise<SandboxRun> {
    return this.sandbox.getRun(id);
  }

  @Roles('editor', 'admin')
  @Get('runs/:id/results')
  listResults(@Param('id', ParseUUIDPipe) id: string): Promise<SandboxResult[]> {
    return this.sandbox.listResults(id);
  }

  @Roles('editor', 'admin')
  @Post('runs/:id/cancel')
  cancelRun(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<SandboxRun> {
    return this.sandbox.cancelRun(id, user.id);
  }

  @Roles('editor', 'admin')
  @Post('runs/:id/retry-failed')
  retryFailed(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<SandboxRun> {
    return this.sandbox.retryFailed(id, user.id);
  }

  @Roles('editor', 'admin')
  @Patch('results/:id/review')
  reviewResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(sandboxResultReviewSchema)) body: SandboxResultReview,
    @CurrentUser() user: SessionUser,
  ): Promise<SandboxResult> {
    return this.sandbox.reviewResult(id, body, user.id);
  }
}
