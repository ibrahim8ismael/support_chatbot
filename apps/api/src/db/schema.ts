/**
 * Drizzle schema entrypoint for drizzle-kit.
 *
 * Each module owns its tables in `src/modules/<module>/entities/*` and
 * re-exports them here so migrations see the full schema (repo-structure.md).
 * Table list and columns: docs/architecture/data-model.md.
 */
export * from '../modules/analytics/entities/answer-event.entity';
export * from '../modules/analytics/entities/audit-log.entity';
export * from '../modules/auth/entities/session.entity';
export * from '../modules/auth/entities/user.entity';
export * from '../modules/bindings/entities/inbox-binding.entity';
export * from '../modules/conversations/entities/conversation.entity';
export * from '../modules/conversations/entities/message.entity';
export * from '../modules/ingestion/entities/chunk.entity';
export * from '../modules/knowledge-base/entities/document.entity';
export * from '../modules/knowledge-base/entities/knowledge-base.entity';
export * from '../modules/sandbox/entities/sandbox-case.entity';
export * from '../modules/sandbox/entities/sandbox-result.entity';
export * from '../modules/sandbox/entities/sandbox-run.entity';
export * from '../modules/settings/entities/setting.entity';
