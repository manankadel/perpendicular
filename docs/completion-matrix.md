# Perpendicular implementation matrix

This is the implementation truth for the supplied product and audit documents. A row is only marked **live** when the repository contains the behavior and a test or production check exists. Provider credentials, deliverability outcomes, and offsite backup copies cannot be marked live from source code alone.

## Live product loop

| Area | Status | Evidence |
| --- | --- | --- |
| Product-owned sign-in with Blueblood ID session authority | Live | `src/app/api/auth/*`, `src/lib/identity.ts`, auth tests |
| Workspace discovery from a real public URL or operator brief | Live | `bootstrap-workspace`, `src/lib/public-research.ts` |
| Discovery creates a usable operator pod, company profile, missions, three content briefs, a persisted public research source, and a five-step draft sequence | Live | `buildOnboardingArtifacts`, `bootstrap-workspace`, onboarding UI, domain migration tests |
| Onboarding proof gate and explicit manual-vs-heartbeat handoff | Live | `proved` onboarding state, first mission linkage, `finish-onboarding`, `enable-onboarding-schedule`, onboarding UI |
| Employee → scoped knowledge → local Ollama run → score → trace | Live | `run-employee`, `llm.ts`, `Run.trace`, domain tests |
| Company context, persisted Chat, Scheduled work, and workspace Dashboard | Live at launch scope | `PlatformViews.tsx`, `update-profile`, `create-schedule`, `run-scheduled`, workspace state |
| Mission queue with run → review → approve, delegation, due dates, and audit activity | Live at launch scope | `run-mission`, `approve-mission`, `delegate-mission`, Missions view |
| Grounded content workflow with draft → review → approve → schedule → publish state | Live at launch scope for native Website/Blog delivery; external channels remain approved provider handoffs | `generate-content`, `approve-content`, `schedule-content`, `publish-content`, Content view |
| Native scheduled website/blog publication | Live at launch scope | Shared `content-runtime`, heartbeat `scheduled-content` lease, collision-safe `/site/{slug}` publication |
| Inspectable playbook catalog that executes through a live employee and creates scored review missions | Live at launch scope | `install-playbook`, executable `run-playbook`, Playbooks view, persisted run/mission output |
| Compatibility migration for existing one-operator workspaces | Live | `normalizeWorkspaceState`, `server-store.ts`, legacy migration test |
| Prompt versions, golden tests, evaluate, activate, rollback | Live | Employee detail UI and workspace actions |
| Employee runtime controls: local model, temperature, reasoning, tools, attached knowledge, memory, admin lock | Live | `update-employee-config`, employee memory actions, `generateEmployeeReply` |
| Smart List batch actions with conditions, bounded execution, and credit accounting | Live at launch scope | `create-list-action`, `run-list-action`, `toggle-list-action` |
| Heartbeat scheduling with Postgres-leased idempotency | Live | `src/lib/job-store.ts`, heartbeat route, job tests |
| Smart Lists, public research, dedupe, credit decrement, sequence enrollment | Live at launch scope | Workspace actions and UI |
| People and Lead Data records with explicit public qualification and source runs | Live at launch scope | `create-person`, `qualify-person`, `create-lead-source`, `run-lead-source`, persisted public result links, People and Lead Data views |
| Lite CRM pipeline with value, stages, owners, next actions, close dates, sources, and stage history | Live at launch scope | `create-deal`, `update-deal`, Pipeline view, dashboard pipeline metrics, additive workspace migration |
| Revenue attribution from public touch to pipeline | Live at launch scope | UTM/session capture on published site and widget chats, persisted attribution touches, first-touch/last-touch/linear deal summaries, dashboard source performance, REST/MCP deal inputs, attribution tests |
| Pipeline REST and MCP resources with shared persistence | Live at launch scope | `/api/deals`, `/api/deals/{dealId}`, MCP `deal_create`/`deal_update`, shared `deal-runtime` used by UI, REST, and MCP |
| Draft sequences with a bounded five-step builder, activation, explicit Gmail step send, manual LinkedIn/Task handoffs, reply-pause/suppression guardrails, outbound daily limits/time windows/weekend rules/domain suppression, and durable send idempotency | Live at launch scope | `buildSequenceSteps`, sequence builder in `src/components/PerpendicularConsole.tsx`, `activate-sequence`, `send-sequence-step`, `Outbound safety` in Settings, `db/005_outbound_messages.sql`, Gmail reply handling |
| Deliverability diagnostics and bounce quarantine | Live at launch scope; provider deliverability guarantees not claimed | Dell DNS checks for MX/SPF/DMARC/optional DKIM selector, persisted Settings diagnostics, Gmail delivery-failure address quarantine, deliverability tests |
| Ticket queue, priority SLA, resolution, CSAT | Live at launch scope | `ticketSlaMinutes`, inbox UI, workspace actions |
| Grounded support reply drafts and explicit Gmail send | Live at launch scope; provider E2E pending | `draft-ticket-reply`, `send-ticket-reply`, `/api/tickets/{ticketId}/reply`, `ticket_reply_send`, Inbox reply actions, ticket citations and durable outbound idempotency |
| Campaign drafts, native scheduling, and human-triggered Gmail broadcasts | Live at launch scope; provider E2E pending | `create-campaign`, `schedule-campaign`, `send-campaign`, `/api/campaigns/{campaignId}/send`, MCP `campaign_broadcast_send`, Campaigns view, per-recipient outbound idempotency |
| Native content campaign execution | Live at launch scope | Shared `campaign-runtime`, heartbeat `scheduled-campaign` lease, campaign result persisted after public-page publication |
| Public keyword monitoring from the self-hosted Dell | Live at launch scope | `researchPublicKeyword`, `create-keyword-monitor`, `check-keyword`, Keywords view |
| Inbound agent records, published site/landing-page routes, and session-aware public site chat | Live at launch scope | `create-inbound-agent`, `create-site`, `/site/[slug]`, `/api/site/[slug]/chat`, persisted visitor session messages |
| Native public booking page with availability, buffers, round-robin assignment, conflict prevention, cancellation, and ICS calendar download | Live at launch scope | `/book/[slug]`, `/api/book/[slug]`, `save-booking-settings`, Postgres advisory-locked workspace write, `tests/booking.test.ts` |
| Workspace Apps definitions with explicit activation state | Live at launch scope | `create-app`, `toggle-app`, Apps view |
| Workspace Apps execute a saved task through a local employee | Live at launch scope | `run-app`, `/api/apps/{appId}/run`, MCP `app_run`, persisted output/score/trace, Apps view |
| Onboarding creates a ready lead workspace, runnable public research source, content briefs, and grounded public operator page | Live at launch scope | `buildOnboardingArtifacts`, additive legacy migration, `/site/{slug}` and `/api/site/{slug}/chat` |
| Gmail OAuth, encrypted refresh tokens, sync, watch renewal, webhook dedupe | Implemented; incomplete mailbox scopes are now degraded instead of reported connected; provider E2E pending | Gmail routes, scope guard, and integration health tables |
| Persisted Gmail inbox plus inbound ticket creation | Live in code; provider E2E pending | `/api/inbox`, Gmail sync, Inbox view, `inbox-store.ts`; new inbound messages create deduplicated SLA tickets |
| Capability-keyed inbound website widget with persisted visitor conversations | Live in code; deployed provider/model evidence pending | `/widget/{workspaceId}`, `/api/widget/{workspaceId}/chat`, Inbox → Website conversations |
| MCP parity for workspace read, employee chat/run, integration list | Live | `/api/mcp` and shared workspace persistence |
| API keys hashed, scoped, revocable, rate-limited | Live | `api-keys.ts`, rate-limit tests |
| Usage ledger and usage endpoint | Live and deployed | `db/004_usage_ledger.sql`, `/api/usage`, Dell health confirms the table is present |
| Credit burn forecasting | Live at launch scope | `src/lib/usage-forecast.ts`, Settings → Usage ledger, forecast unit tests |
| Workspace JSON/CSV export and owner-confirmed deletion | Implemented; destructive E2E pending | `/api/workspace/export`, `/api/workspace/privacy` |
| Webhook catalog and dead-letter replay controls | Implemented; provider E2E pending | `/api/ops`, Settings → Operations |
| Operational health counts for dead letters, failed webhooks, and degraded integrations | Live and deployed | `/api/health`, required schema includes outbound send records |
| Dell local backup schedule, clean-database restore rehearsal, and off-machine copy | Live | Root cron at 02:15, verified custom-format dump, restore into `perpendicular_restore_check` with 13 platform tables, and Mac launchd pull of `/opt/blueblood/backups/perpendicular` via the existing least-privilege sudo rule |
| Read-only production smoke gate | Live and verified on the promoted Dell release | `npm run smoke:production`, image `sha256:a6d365cf5b4135d24dc6f32f225d1e59f40be4ac8177cac8ccfeb7f4a33ba217`, commit `7d4edb0`, ten checks including public site delivery and booking availability, 2026-09-27 |
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

- 1,000 integrations, LinkedIn automation, WhatsApp, voice, warmup pools, inbox rotation, or deliverability guarantees. Perpendicular does provide real DNS diagnostics and Gmail bounce quarantine at launch scope.
- Stripe checkout, paid plans, dunning, proration, subscriptions, or billing entitlements.
- Warehouse sync, mobile apps, browser task automation, or white-label operator billing.
- SOC 2, GDPR/CCPA certification, customer-managed keys, regional residency, or a legal DPA.
- Qdrant semantic retrieval and n8n custom-node delivery as production behavior. The launch app uses deterministic scoped retrieval and leaves these as adapters.

## Remaining launch evidence

The code is launchable for the documented open-source launch scope. The Dell API, public UI, public GitHub repository, and Git-triggered Vercel release path are live. Public launch evidence still requires one real external provider state:

1. Run an authenticated Gmail OAuth → test-send → reply → sync → sequence-pause test with a mailbox the operator controls.
2. Keep the authenticated browser walkthrough as a regression check after each production release; the previous release passed it, and this release must be re-run against a signed-in workspace.

None of these are replaced with sample data or a green UI state.

## Observed release state

Read-only checks on 2026-09-27 found:

- The live API is healthy on promoted immutable image `7d4edb0` (`sha256:a6d365cf5b4135d24dc6f32f225d1e59f40be4ac8177cac8ccfeb7f4a33ba217`); the production smoke suite passed all eight checks, Google sign-in starts directly at Google while preserving the shared OAuth state cookie, external content channels cannot claim native publication, the inbound Gmail ticket loop is live, pipeline PATCH preflight works from the public Vercel origins, the human-triggered Gmail broadcast contract is deployed in REST, MCP, and workspace actions, health verifies the reachable installed Ollama model (`ollama:qwen3:1.7b`), sequence creation persists up to five bounded steps with manual LinkedIn/Task steps creating real Missions, qualified People records can enter Smart List workflows, and Lead Data source runs execute source-specific behavior for Smart List-backed CSV, public research, and manual People sources with persisted result links. The release also fixes free public-search parsing, makes onboarding generate up to three grounded launch drafts, supports Anthropic-compatible streaming with preserved text boundaries, blocks Smart List enrollment actions until the sequence and required Gmail connection are valid, exposes the Gmail handoff directly in the onboarding proof summary, automatically suppresses inbound unsubscribe requests, quarantines Gmail delivery failures, exposes real MX/SPF/DMARC/DKIM diagnostics in Settings, shows persisted credit-burn forecasts in Settings, keeps the chained public-research/first-brief progress visible during onboarding, captures public UTM/session touches for first-touch, last-touch, and linear revenue attribution, and adds a live onboarding-created booking page with availability, buffers, round-robin assignment, cancellation, and ICS download.
- The public-site delivery path was then verified on Vercel commit `ecea03a`: `https://perpendicular.bluebloodstudio.com/site/blueblood-studio-blueblood-studio` loads the discovered Blueblood Studio content from Dell without a Vercel database, the public booking CTA resolves to the live booking page, and a real site-chat request returned an Ollama response with a scoped citation and persisted visitor session `live-smoke-20260927`.
- A prior authenticated browser session reached the live workbench, completed a real mission through Dell → Ollama → Postgres, answered a real employee chat, approved the mission, generated grounded content, and created/enriched a Smart List row; the signed-in regression walkthrough should be repeated for this release.
- The verified UI is live on the Git-connected production deployment (`perpendicular.bluebloodstudio.com`, with `perpendicular-nine.vercel.app` retained as an alias); the production target is `READY` with the expected Company / Chat / Scheduled / People / Lead Data / Pipeline / Campaigns / Keywords / Inbound / Apps navigation.
- The onboarding proof now attaches the scored first run to the first real mission, so opening the workbench produces a reviewable mission instead of an empty queue.
- The compatibility migration was exercised against the existing `blueblood-studio` workspace: the Dell row now persists `seq-onboarding-blueblood-studio` with all five draft steps, without resetting the workspace.
- The Dell host heartbeat is installed as a root-owned helper with a non-overlap lock and calls `https://perpendicular-api.bluebloodstudio.com/api/cron/heartbeat`; an authenticated tick returned successfully.
- Dell reports all required workspace, platform, Gmail event/health, usage-ledger, and outbound-message tables present; schema health has no missing tables.
- The API-key rate-limit table is applied additively on Dell; the transactional workspace write path, outbound safety guardrails, CSV lead import, and public widget are live on the promoted image.
- Dell local backups are scheduled at 02:15, a fresh dump was created, restore rehearsal into `perpendicular_restore_check` succeeded with one workspace row and 13 platform tables, and the latest dump was copied to `/Users/manankadel/blueblood-backups/perpendicular` with a matching SHA-256 checksum.
- The canonical login UI and self-serve workspace form load in Chrome. The prior authenticated production walkthrough covered the Git-connected UI and API; the Gmail provider test-send/reply/sync walkthrough remains outstanding, and no external email was sent during this release.
- The existing Dell Gmail row for `manankadel@gmail.com` was inspected without reading its refresh token: it was marked connected but contained only identity scopes. Release `a31adfa` now classifies that state as degraded, blocks mailbox actions with an explicit reconnect message, and only marks a new OAuth connection connected when both `gmail.modify` and `gmail.send` are present.
- Product-owned Google sign-in/MFA and Gmail OAuth are implemented and configured; the complete test-send → reply → sync → sequence-pause evidence is still outstanding.
- A second disposable Blueblood ID account received an isolated empty workspace (`personal-47`) while the audit workspace remained populated as `personal-46`; no cross-tenant records were returned.
- A disposable scoped API key was created, used against `/api/integrations`, and revoked; the live response returned its name, prefix, scopes, and one-time secret metadata correctly.
