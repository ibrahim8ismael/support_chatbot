# API e2e tests

E2E specs (`*.e2e-spec.ts`) live here and boot the Nest app against real
infrastructure — testcontainers Postgres & Redis, with Chatwoot HTTP calls and
model providers mocked (docs/contributing/development.md § Testing strategy).

No specs yet: webhook fixtures and the first full message-flow test land with
the `agent`/`chatwoot` implementation.
