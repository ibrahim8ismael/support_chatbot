# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/) — curated entries are added
here in the same PR as user-visible changes. Ticket IDs refer to the
[build plan](docs/contributing/build-plan.md).

## [Unreleased]

### Added

- **Monorepo scaffold** (T-000): pnpm workspaces + Turborepo; `apps/api` (NestJS 12
  modular monolith with the 14 modules from the repo-structure doc), `apps/web`
  (Next.js 16 App Router: login + dashboard routes), `packages/shared` (zod schemas,
  domain enums, queue/Redis constants), `packages/config` (tsconfig / eslint / prettier
  presets).
- **API foundations**: zod-validated environment (fail fast), pino JSON logger with
  secret redaction, Drizzle + migration plumbing, BullMQ/Redis infra (db 0 queue /
  db 1 cache), `GET /health` contract, and the
  `POST /api/webhooks/chatwoot/:secret` edge (bad secret → 404).
- **Local environment**: docker compose for Postgres (pgvector) + Redis (AOF,
  noeviction), multistage Dockerfiles for api/web, `pnpm simulate:webhook` script,
  repo-wide `lint` / `typecheck` / `test` / `build` via Turborepo.
- **Testing**: Vitest + SWC setup for `apps/api` (Nest 12 is ESM-only) with unit tests
  for env validation and the health contract.
- **Database schema** (T-101): all 11 tables from
  [data-model](docs/architecture/data-model.md) in their owning modules (users,
  sessions, knowledge_bases, documents, chunks, inbox_bindings, conversations,
  messages, answer_events, audit_logs, settings) with the first forward-only
  migration; `chunks.embedding vector(1536)` with an HNSW
  (`vector_cosine_ops`, m=16, ef_construction=64) index, case-insensitive
  `citext` emails, and the `chatwoot_message_id` dedupe key. Closes D3
  (`text-embedding-3-small`, 1536) and D6 (Drizzle).
- **Build plan**: ticket-level execution list for M0–M4 in
  [docs/contributing/build-plan.md](docs/contributing/build-plan.md).

### Fixed

- Prettier now ignores the Next.js-generated `apps/web/next-env.d.ts` and the
  drizzle-kit-generated `apps/api/src/db/migrations/meta` JSON (both are rewritten by
  tooling).

<!--
Sections: Added, Changed, Deprecated, Removed, Fixed, Security.
When a release is cut: move [Unreleased] entries under a new version heading with
the date (e.g. `## [0.2.0] - 2026-11-01`) and start a fresh [Unreleased] block.
-->
