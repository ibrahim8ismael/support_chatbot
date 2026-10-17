# Roadmap

Phases are ordered by dependency, not by calendar. Durations are rough estimates for one full-time engineer (adjust freely). The rule that does not bend: **no bot answers real customers until the evaluation set says answers are grounded** ([RAG pipeline § Quality](../architecture/rag-pipeline.md)).

## Phase 0 — Foundations (≈ 1–2 weeks)

**Goal:** skeleton that talks to Chatwoot and Postgres, deployable in Docker.

- Monorepo scaffold: pnpm workspaces + Turborepo, `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared`.
- Docker compose: Postgres + pgvector + Redis (queue + cache); api & web dev containers.
- CI: lint, typecheck, test.
- Chatwoot: create Agent Bot, point webhook to a **test** endpoint, verify payloads for real channels (widget is easiest to test).
- Echo bot: reply "I received: …" through the Chatwoot API. Prove the full loop.
- Auth skeleton (login, sessions) and empty dashboard shell.

**Exit criteria:** message sent in a Chatwoot test inbox → bot echoes the reply → logged in DB; `docker compose up` works on a clean machine.

## Phase 1 — MVP answering (≈ 3–4 weeks)

**Goal:** grounded answers from a KB, with safe escalation.

- KB + document management (upload, status, reprocess, delete).
- Ingestion pipeline (parse → chunk → embed) with queue and retries.
- Retrieval + answer generation through Vercel AI SDK, prompt templates, thresholds.
- Escalation rules + private note handoff + `ai-paused` label (D7).
- Settings: model names, thresholds, prompts, per-inbox toggles.
- Evaluation set for the launch KBs (50–100 Q/A pairs); iterate until groundedness target is met.
- Playground (P1 pulled early — it is the fastest way to tune quality).

**Exit criteria:** eval run passes (see quality gates in [RAG pipeline](../architecture/rag-pipeline.md)); bot live in **one** real inbox (suggest the website widget first), humans can pause/resume it.

## Phase 2 — Dashboard & analytics (≈ 2–3 weeks)

**Goal:** the team can operate the agent without engineering.

- Analytics screen: deflection, escalation rate, latency, usage/cost, top unanswered questions.
- Conversation explorer with retrieval details (which chunks answered what).
- Bindings UI to activate additional inboxes one by one.
- Audit log screen; user management (admin).
- Runbook crons: weekly "top unanswered" digest to the support channel.

**Exit criteria:** support lead reviews analytics weekly without asking engineering for numbers; bot rolled out to all intended inboxes.

## Phase 3 — Quality & scale (ongoing)

- Hybrid search, reranking, query rewriting improvements.
- Cost/latency optimizations (expand caching — reply-level reuse for exact repeats, smaller models for classification).
- Optional: agent-assist mode, SSO, URL sources, chatwoot CSAT correlation.
- Load test against NFR-1/NFR-2 targets; alerting on webhook/LLM error rates.

## Milestones at a glance

| Milestone | Phase | Definition of done |
| --- | --- | --- |
| M0 — Loop proven | 0 | Echo through Chatwoot, deployable stack |
| M1 — One KB answers | 1 | Uploaded PDF answered correctly in playground |
| M2 — Live in one inbox | 1 | Real customers get RAG answers; escalation works |
| M3 — Operable by the team | 2 | Analytics + playground + toggles used without eng |
| M4 — All inboxes | 2 | Rollout complete, kill switches tested |

## Dependencies & risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Chatwoot version quirks (webhook payloads, bot API) | Integration rework | Verify payloads in Phase 0 against our exact version; keep a payload fixture test suite |
| Data policy blocks external LLM APIs (D2) | Delays / changes provider plan | Decide D2 **before** Phase 1 starts; Vercel AI SDK + OpenAI-compatible interface keeps both options viable |
| PDFs are messy (scans, tables, headers) | Bad retrieval | Start with clean sources (help center, docs); status + error surfaced; manual paste/URL as fallback |
| Prompt injection / bot says something wrong | Trust damage | Groundedness rules + thresholds + evals + human pause; private-note trail for every escalation |
| Low KB coverage in the launch topics | Low deflection | Pick 2–3 high-volume topics to launch with; weekly "top unanswered" loop |
| Team changes support tooling | Rework | Chatwoot integration isolated in one module + documented contract |

## Cadence

- Weekly: review "top unanswered questions" and add/fix KB content.
- Biweekly: eval run; compare groundedness/deflection before and after KB or prompt changes.
- Per release: update these docs in the same PR (see [contributing](../contributing/development.md)).
