# Perpendicular implementation matrix

This is the implementation truth for the supplied product and audit documents. A row is only marked **live** when the repository contains the behavior and a test or production check exists. Provider credentials, deliverability outcomes, and offsite backup copies cannot be marked live from source code alone.

## Live product loop

| Area | Status | Evidence |
| --- | --- | --- |
| Product-owned sign-in with Blueblood ID session authority | Live | `src/app/api/auth/*`, `src/lib/identity.ts`, auth tests |
| Workspace discovery from a real public URL or operator brief | Live | `bootstrap-workspace`, `src/lib/public-research.ts` |
| Employee → scoped knowledge → local Ollama run → score → trace | Live | `run-employee`, `llm.ts`, `Run.trace`, domain tests |
| Prompt versions, golden tests, evaluate, activate, rollback | Live | Employee detail UI and workspace actions |
| Heartbeat scheduling with Postgres-leased idempotency | Live | `src/lib/job-store.ts`, heartbeat route, job tests |
| Smart Lists, public research, dedupe, credit decrement, sequence enrollment | Live at launch scope | Workspace actions and UI |
| Draft sequences with reply-pause/suppression guardrails | Live at launch scope | Sequence state and Gmail reply handling |
| Ticket queue, priority SLA, resolution, CSAT | Live at launch scope | `ticketSlaMinutes`, inbox UI, workspace actions |
| Gmail OAuth, encrypted refresh tokens, sync, watch renewal, webhook dedupe | Implemented; provider E2E pending | Gmail routes and integration health tables |
| Persisted Gmail inbox message read surface | Live in code; provider E2E pending | `/api/inbox`, Inbox view, `inbox-store.ts` |
| MCP parity for workspace read, employee chat/run, integration list | Live | `/api/mcp` and shared workspace persistence |
| API keys hashed, scoped, revocable, rate-limited | Live | `api-keys.ts`, rate-limit tests |
| Usage ledger and usage endpoint | Implemented; migration must be applied | `db/004_usage_ledger.sql`, `/api/usage` |
| Workspace JSON/CSV export and owner-confirmed deletion | Implemented; destructive E2E pending | `/api/workspace/export`, `/api/workspace/privacy` |
| Webhook catalog and dead-letter replay controls | Implemented; provider E2E pending | `/api/ops`, Settings → Operations |
| Operational health counts for dead letters, failed webhooks, and degraded integrations | Live in code; deployed verification pending | `/api/health` |
| Read-only production smoke gate | Live in code; current Dell image fails until the next release is promoted | `npm run smoke:production`, `scripts/production-smoke.mjs` |
| CI verification before image publication | Live | `.github/workflows/perpendicular-image.yml` runs check and production audit before publish |

## Explicitly not claimed

These are present in the comparison/audit documents but are not silently faked in Perpendicular:

- 1,000 integrations, LinkedIn automation, WhatsApp, voice, warmup pools, inbox rotation, or deliverability guarantees.
- Stripe checkout, paid plans, dunning, proration, subscriptions, or billing entitlements.
- CRM attribution, warehouse sync, mobile apps, browser task automation, or white-label operator billing.
- SOC 2, GDPR/CCPA certification, customer-managed keys, regional residency, or a legal DPA.
- Qdrant semantic retrieval and n8n custom-node delivery as production behavior. The launch app uses deterministic scoped retrieval and leaves these as adapters.

## Remaining launch evidence

The code is launchable for the documented open-source launch scope after the additive usage migration is applied. Public launch evidence still requires real external state:

1. Apply `db/004_usage_ledger.sql` to the dedicated Dell database.
2. Configure and retrieve an offsite backup through `PERPENDICULAR_BACKUP_REMOTE`.
3. Run an authenticated Gmail OAuth → test-send → reply → sync → sequence-pause test with a mailbox the operator controls.
4. Run a second-workspace isolation test against the deployed Blueblood ID memberships.
5. Run the final production browser/API smoke suite after the next image is promoted.

None of these are replaced with sample data or a green UI state.

## Observed release state

Read-only checks on 2026-09-10 found:

- The live API is healthy on image `98d0c7d1d6e17c9dd4eaabedad3e26712e516577`; the locally verified source is ahead of `origin/main` and has not been promoted.
- Dell has the workspace, platform, and Gmail event/health tables (migrations 001–003). The additive usage ledger migration (004) is not applied yet.
- Dell local backups exist and restore rehearsal passed, but the rclone configuration and offsite remote are absent.
- Gmail OAuth client ID and secret are empty on the live container, so provider E2E cannot pass yet. Blueblood ID's deployed portal also has no Google OAuth client variables, so product Google sign-in requires provider configuration before it can be verified.
