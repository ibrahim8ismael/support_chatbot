import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppLogger } from './common/logger/app-logger.service';
import { LoggerModule } from './common/logger/logger.module';
import { validateEnv } from './config/env';
import { DatabaseModule } from './db/database.module';
import { AgentModule } from './modules/agent/agent.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { BindingsModule } from './modules/bindings/bindings.module';
import { ChatwootModule } from './modules/chatwoot/chatwoot.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { HealthModule } from './modules/health/health.module';
import { InfraModule } from './modules/infra/infra.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { LlmModule } from './modules/llm/llm.module';
import { RetrievalModule } from './modules/retrieval/retrieval.module';
import { RetentionModule } from './modules/retention/retention.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Composition root — the module list mirrors the module table in
 * docs/architecture/repo-structure.md. Register a new module in both places.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    LoggerModule,
    DatabaseModule,
    InfraModule,
    HealthModule,
    AuthModule,
    UsersModule,
    KnowledgeBaseModule,
    IngestionModule,
    RetrievalModule,
    LlmModule,
    ConversationsModule,
    ChatwootModule,
    AgentModule,
    BindingsModule,
    AnalyticsModule,
    SettingsModule,
    RetentionModule,
  ],
  providers: [AppLogger],
})
export class AppModule {}
