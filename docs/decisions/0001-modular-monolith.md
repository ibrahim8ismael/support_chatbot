# ADR-0001 — Modular Monolith Repo & Deployable

- Status: Accepted
- Date: 2026-10-17

## Context

One product, one small team, internal scale (~5k conversations/month). The system has clearly separable concerns (chatwoot integration, retrieval, LLM calls, KB management, analytics) but they share one database and one deployment target. Microservices would add network boundaries, duplicate infra, and distributed debugging for zero benefit at this scale. A single unstructured app would make boundaries invisible and rot over time.

## Decision

- One repository structured as a monorepo (pnpm workspaces + Turborepo): `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared`.
- `apps/api` is a **modular monolith**: NestJS modules with explicit ownership (tables, public services), documented in [repo-structure](../architecture/repo-structure.md).
- Cross-module communication only through public service APIs — no reaching into another module's tables/entities.
- One deployable per app; background jobs run inside `apps/api` initially (see [ADR-0006](0006-job-queue.md)).

## Consequences

- **Easy:** single deploy, single DB, one language, refactoring across boundaries is cheap; module map doubles as onboarding material.
- **Hard (accepted):** boundaries are enforced by review + convention, not the compiler — the module table and checklists exist to keep this honest; one process means one failure domain.
- **Escape hatch:** if ingestion/worker load grows, extract `apps/worker` importing the same modules; module boundaries make that a packaging change, not a rewrite.
