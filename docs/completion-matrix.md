# Perpendicular implementation matrix

This is the implementation truth for the supplied product and audit documents. A row is only marked **live** when the repository contains the behavior and a test or production check exists. Provider credentials, deliverability outcomes, and offsite backup copies cannot be marked live from source code alone.

## Live product loop

| Area | Status | Evidence |
| --- | --- | --- |
| Product-owned sign-in with Blueblood ID session authority | Live | `src/app/api/auth/*`, `src/lib/identity.ts`, auth tests |
| Workspace discovery from a real public URL or operator brief | Live | `bootstrap-workspace`, `src/lib/public-research.ts` |
| Discovery creates a usable operator pod, company profile, missions, first content brief, and a five-step draft sequence | Live | `buildOnboardingArtifacts`, `bootstrap-workspace`, onboarding UI, domain migration tests |
| Onboarding proof gate and explicit manual-vs-heartbeat handoff | Live | `proved` onboarding state, first mission linkage, `finish-onboarding`, `enable-onboarding-schedule`, onboarding UI |
| Employee → scoped knowledge → local Ollama run → score → trace | Live | `run-employee`, `llm.ts`, `Run.trace`, domain tests |
| Mission queue with run → review → approve, delegation, due dates, and audit activity | Live at launch scope | `run-mission`, `approve-mission`, `delegate-mission`, Missions view |
| Grounded content workflow with draft → review → approve → schedule → publish state | Live at launch scope | `generate-content`, `approve-content`, `schedule-content`, Content view |
| Inspectable playbook catalog that creates durable missions | Live at launch scope | `install-playbook`, `run-playbook`, Playbooks view |
| Compatibility migration for existing one-operator workspaces | Live | `normalizeWorkspaceState`, `server-store.ts`, legacy migration test |
| Prompt versions, golden tests, evaluate, activate, rollback | Live | Employee detail UI and workspace actions |
| Heartbeat scheduling with Postgres-leased idempotency | Live | `src/lib/job-store.ts`, heartbeat route, job tests |
| Smart Lists, public research, dedupe, credit decrement, sequence enrollment | Live at launch scope | Workspace actions and UI |
| Draft sequences with activation, explicit Gmail first-step send, reply-pause/suppression guardrails, outbound daily limits/time windows/weekend rules/domain suppression, and durable send idempotency | Live at launch scope | `activate-sequence`, `send-sequence-step`, `Outbound safety` in Settings, `db/005_outbound_messages.sql`, Gmail reply handling |
| Ticket queue, priority SLA, resolution, CSAT | Live at launch scope | `ticketSlaMinutes`, inbox UI, workspace actions |
| Gmail OAuth, encrypted refresh tokens, sync, watch renewal, webhook dedupe | Implemented; provider E2E pending | Gmail routes and integration health tables |
| Persisted Gmail inbox message read surface | Live in code; provider E2E pending | `/api/inbox`, Inbox view, `inbox-store.ts` |
| Capability-keyed inbound website widget with persisted visitor conversations | Live in code; deployed provider/model evidence pending | `/widget/{workspaceId}`, `/api/widget/{workspaceId}/chat`, Inbox → Website conversations |
| MCP parity for workspace read, employee chat/run, integration list | Live | `/api/mcp` and shared workspace persistence |
| API keys hashed, scoped, revocable, rate-limited | Live | `api-keys.ts`, rate-limit tests |
| Usage ledger and usage endpoint | Live and deployed | `db/004_usage_ledger.sql`, `/api/usage`, Dell health confirms the table is present |
| Workspace JSON/CSV export and owner-confirmed deletion | Implemented; destructive E2E pending | `/api/workspace/export`, `/api/workspace/privacy` |
| Webhook catalog and dead-letter replay controls | Implemented; provider E2E pending | `/api/ops`, Settings → Operations |
| Operational health counts for dead letters, failed webhooks, and degraded integrations | Live and deployed | `/api/health`, required schema includes outbound send records |
| Dell local backup schedule and clean-database restore rehearsal | Live locally; offsite copy pending | Root cron at 02:15, verified custom-format dump, restore into `perpendicular_restore_check` with 13 platform tables |
| Read-only production smoke gate | Live and verified on the promoted Dell release | `npm run smoke:production`, image `sha256:a2bbcb46…`, build `ca1e3ab`, eight checks, 2026-09-27 |
| Dell heartbeat trigger | Live and verified on the host | Root-owned `/usr/local/sbin/perpendicular-heartbeat`, `flock` lock, API-origin request, and successful authenticated tick on 2026-09-26 |
| CI verification before image publication | Live | `.github/workflows/perpendicular-image.yml` runs check and production audit before publish |

## Dated launch-audit fixes

The supplied launch-readiness PDF is a dated audit. Its F-01–F-08 items reconcile to the current source as follows:

| Fix | Current status | Evidence |
| --- | --- | --- |
| F-01 credit seed drift | Closed in code; production empty-state behavior is tested | `createEmptyState`, production seed contract in `tests/domain.test.ts` |
| F-02 stale navigation counts | Closed in code | `navCount()` in `src/components/PerpendicularConsole.tsx` |
| F-03 heartbeat idempotency | Implemented and Dell health-verified | Postgres lease/idempotency path in `src/lib/job-store.ts`, heartbeat route and job tests |
| F-04 API-key rate limits | Live with durable Postgres counters and bounded outage fallback | `db/006_rate_limits.sql`, `src/lib/rate-limit.ts`, API-key tests |
| F-05 Gmail renewal and webhook dedupe | Implemented; provider E2E pending | `src/app/api/webhooks/gmail/route.ts`, `src/lib/integration-store.ts`, `db/003_gmail_events_health.sql` |
| F-06 origin-check unification | Closed in code | `src/lib/cors.ts`, `src/lib/security.ts`, CORS tests |
| F-07 local workspace discovery | Closed in code; production uses Postgres only | `listWorkspaceIds()` and production fallback guard in `src/lib/server-store.ts` |
| F-08 collision-safe IDs | Closed in code | `crypto.randomUUID()` in `src/lib/domain.ts` |

## Explicitly not claimed

These are present in the comparison/audit documents but are not silently faked in Perpendicular:

- 1,000 integrations, LinkedIn automation, WhatsApp, voice, warmup pools, inbox rotation, or deliverability guarantees.
- Stripe checkout, paid plans, dunning, proration, subscriptions, or billing entitlements.
- CRM attribution, warehouse sync, mobile apps, browser task automation, or white-label operator billing.
- SOC 2, GDPR/CCPA certification, customer-managed keys, regional residency, or a legal DPA.
- Qdrant semantic retrieval and n8n custom-node delivery as production behavior. The launch app uses deterministic scoped retrieval and leaves these as adapters.

## Remaining launch evidence

The code is launchable for the documented open-source launch scope. The canonical API is live, but the public UI release is still blocked by Vercel account state. Public launch evidence still requires real external state:

1. Configure and retrieve an offsite backup through `PERPENDICULAR_BACKUP_REMOTE`.
2. Run an authenticated Gmail OAuth → test-send → reply → sync → sequence-pause test with a mailbox the operator controls.
3. Run a second-workspace isolation test against the deployed Blueblood ID memberships.
4. Resolve the Vercel deployment block, promote the verified UI commit, and run the final authenticated browser walkthrough against that UI and API.

None of these are replaced with sample data or a green UI state.

## Observed release state

Read-only checks on 2026-09-27 found:

- The live API is healthy on promoted immutable image `ca1e3ab` (`sha256:a2bbcb46aa3ebef39fcb0be625f94034fe51b9e71694317ee1bc05ee843173a2`); the production smoke suite passed all eight checks, including the public widget entry route.
- The authenticated browser session reaches the live workbench and completed a real mission through Dell → Ollama → Postgres; the API now also identifies Perpendicular correctly in the same chat path instead of borrowing another product identity.
- The verified UI commits `8f8b74b` and `ca1e3ab` are pushed to `main`, but Vercel blocks subsequent production deployments before alias promotion with no build error. A separate fallback project built once and was also blocked on its next production deployment; its GitHub connection is pending a Vercel Login Connection for the owning account.
- The onboarding proof now attaches the scored first run to the first real mission, so opening the workbench produces a reviewable mission instead of an empty queue.
- The Dell host heartbeat is installed as a root-owned helper with a non-overlap lock and calls `https://perpendicular-api.bluebloodstudio.com/api/cron/heartbeat`; an authenticated tick returned successfully.
- Dell reports all required workspace, platform, Gmail event/health, usage-ledger, and outbound-message tables present; schema health has no missing tables.
- The API-key rate-limit table is applied additively on Dell; the transactional workspace write path, outbound safety guardrails, CSV lead import, and public widget are live on the promoted image.
- Dell local backups are scheduled at 02:15, a fresh dump was created, and restore rehearsal into `perpendicular_restore_check` succeeded with one workspace row and 13 platform tables; the rclone configuration and offsite remote are absent.
- The canonical login UI and self-serve workspace form load in Chrome. An authenticated browser session is now available and the signed-in workbench/mission path has been exercised; the final walkthrough must be repeated after the verified UI commit is actually promoted.
- Product-owned Google sign-in/MFA and Gmail OAuth are implemented and configured; an authenticated browser walkthrough and the complete test-send → reply → sync → sequence-pause evidence are still outstanding.
