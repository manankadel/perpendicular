# Perpendicular production architecture

## Product flow

Perpendicular is a multi-tenant AI work system. The primary user journey is:

1. A person signs in through Perpendicular's product-owned screen with email/password and, when enabled, MFA.
2. The product API validates those credentials through Blueblood ID and forwards only signed HttpOnly session cookies.
3. Blueblood ID's session contains the user and organization memberships.
4. The product resolves the active organization and enforces its role before every read or write.
5. On a new workspace, Perpendicular derives a public company URL from the signed-in business email when possible. The operator can replace it or provide a short brief.
6. A discovery command fetches only that public source, persists the readable content, and creates one goal-specific Employee with a versioned prompt and golden test. No sample leads or fake metrics are inserted.
7. The operator runs a first brief through the Dell Ollama worker. The result is persisted as a scored, traced Run before the onboarding flow is complete.
8. Only after that proof does the product offer a daily Heartbeat schedule. Gmail remains disconnected and send-gated until the operator explicitly connects and tests it.
9. A Smart List discovers or imports people and companies, enriches rows, scores fit, removes duplicates, and applies suppression rules.
10. Qualified rows can enter a Sequence. The sender adapter sends through a connected mailbox, respects timezone and daily limits, pauses on replies or suppression, and records every provider event.
11. Inbox events are normalized into conversations. Employees can draft or send only when the workspace policy allows it; otherwise a human approval gate is required.
12. Heartbeat jobs run through a Postgres-leased worker path at launch. Every run is idempotent, retryable, scored, traced, and visible in Activity; Redis is the scale-out seam.
13. The Executive Assistant, API, and MCP surfaces call the same application commands as the web UI.

## Runtime layout

```text
Browser
  └─ Vercel UI (perpendicular.bluebloodstudio.com)
       ├─ Perpendicular-hosted login form → server-side Blueblood ID auth
       ├─ Blueblood ID session cookie (*.bluebloodstudio.com)
       └─ HTTPS API calls → Dell API (perpendicular-api.bluebloodstudio.com)

Dell / Docker Compose
  ├─ Perpendicular API (Next.js Node runtime)
  ├─ Perpendicular heartbeat runner (authenticated host cron + Postgres leases)
  ├─ Postgres 16 (perpendicular database)
  ├─ Redis 7 (queues, locks, rate limits, cache)
  ├─ Ollama (local inference)
  ├─ Qdrant (knowledge vectors)
  ├─ n8n (long-tail connector router)
  ├─ Blueblood ID (identity, memberships, product JWTs)
  └─ Caddy + Cloudflare Tunnel (TLS edge and routing)
```

The initial launch target is Tier 1/2: one monolithic API, one worker process, one Postgres primary, Redis, and one region. The design leaves clear seams for read replicas, separate workers, and queue partitioning without prematurely splitting the domain into microservices.

## Trust boundaries

- Blueblood ID is the identity authority. Perpendicular never trusts a browser-supplied company header.
- Every request must carry a valid `bb_session` cookie or a hashed, revocable Perpendicular API key.
- JWTs are verified with the Blueblood ID JWKS, issuer, algorithm, expiry, and product membership claims.
- Organization membership and role are resolved server-side for every command.
- Cookies are only useful on `*.bluebloodstudio.com`; the Vercel default hostname is a demo surface and cannot be the canonical authenticated host.
- Mutating browser requests require same-origin checks and a valid session. API-key requests are explicitly stateless and scoped.
- Secrets stay on the Dell/Vercel environment. They never enter the browser bundle, Git history, logs, or audit payloads.
- Workspace operators can export portable JSON without credentials, or permanently delete workspace-scoped data after an owner-only exact-ID confirmation.

## Current launch data model

Postgres is the source of truth for production. The current workspace aggregate is stored in `perpendicular_workspace_state` so the first launch can preserve the domain contract while the remaining normalized domain tables are introduced. Integration credentials, OAuth states, API keys, audit events, jobs, Gmail inbox records, provider health, webhook events, and usage ledger records are separate tables in `db/002_platform.sql`, `db/003_gmail_events_health.sql`, and `db/004_usage_ledger.sql`.

Target normalized tables:

- `workspaces`, `workspace_memberships`
- `employees`, `employee_prompt_versions`, `employee_golden_tests`
- `knowledge_sources`, `knowledge_documents`, `knowledge_chunks`
- `smart_lists`, `smart_list_fields`, `smart_list_rows`, `smart_list_row_events`
- `sequences`, `sequence_steps`, `sequence_enrollments`
- `mailboxes`, `inbox_threads`, `inbox_messages`
- `tickets`, `ticket_events`
- `runs`, `run_steps`, `scheduled_jobs`
- `integrations`, `oauth_accounts`, `webhook_events`
- `api_keys`, `audit_events`, `usage_ledger`, `subscriptions`

All tenant-owned tables include `workspace_id`, indexes begin with that key where appropriate, and repository queries require the workspace context. The migration will also enable database-level row security when the shared Postgres role and deployment path support it.

## Async and failure handling

- The launch runner is a host-triggered heartbeat endpoint. It scans persisted due schedules, claims `perpendicular_jobs` with a lease and idempotency key, runs only due employees, and advances the next run time after success.
- The launch worker uses Postgres leases for restart safety. Redis remains the scale-out seam for queue partitioning and distributed rate limits; the current API-key limiter is bounded in-memory per API process.
- Credit consumption is persisted in `perpendicular_usage_ledger` and exposed through `/api/usage`; the aggregate credit balance remains the fast product guardrail.
- Gmail sync is explicit and deduplicates by provider message ID. Sequence sends remain approval-gated until a durable sender worker is deployed.
- Heartbeat jobs use bounded retries and a dead-letter state; no UI may report a background job as complete before its persisted result exists.
- Provider webhooks are persisted before processing and deduplicated by provider event ID.
- A worker restart must be safe: a job can run twice without sending a duplicate message or charging twice.
- Synchronous HTTP routes are limited to validation, command creation, and fast reads. Long work returns a job ID.

## Integration policy

Every integration has three explicit states: `not_configured`, `connected`, or `degraded`. A button may not report success until the provider call succeeds and the credential is encrypted and persisted.

- Google login uses Blueblood ID's existing OAuth and MFA flow.
- Gmail uses a separate OAuth grant with Gmail scopes, encrypted refresh tokens, Gmail history sync, send-as verification, thread/message normalization, and webhook renewal.
- n8n is used for long-tail connectors and custom workflows, not as the system of record.
- Ollama is the default free/local model runtime. Provider-specific models are optional adapters.
- Stripe/billing is isolated behind the billing service and a local usage ledger; no UI-only plan switch is considered billing.

## Launch gates

The product is launchable only when all of these are true:

- No unauthenticated workspace read or write succeeds.
- A second organization cannot read or mutate the first organization's records.
- A signed-in user can create an Employee, attach a real source, run a real task, and inspect the persisted run.
- A new workspace can complete discovery → first brief → optional daily schedule without sample data or a UI-only success state.
- A connected Gmail mailbox can send a test message to an owned test address, receive a reply, and pause the Sequence.
- Heartbeats survive an API restart and do not duplicate work.
- API keys are hashed, scoped, revocable, rate-limited, and shown once.
- Every provider webhook is authenticated, deduplicated, and auditable.
- Database backups restore into a clean database and are copied off the Dell.
- Vercel is the UI only; durable state and workers run on Dell Postgres/Redis.
- Browser, API, worker, migration, and security tests pass in CI and against the deployed stack.

## Deliberate non-claims

The app must not claim 1,000 integrations, verified enrichment, deliverability, CRM attribution, voice, WhatsApp, LinkedIn automation, billing, or enterprise compliance until each adapter has a working provider contract, persisted state, failure handling, and an end-to-end test.
