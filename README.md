# Perpendicular

Perpendicular is an open-source AI work system for small teams. It turns a named employee, scoped knowledge, a scheduled task, and a visible evaluation trace into one operational loop.

The production shape is deliberate: Vercel serves the browser UI; the Dell runs the API, Postgres, Ollama, and durable integration data. Blueblood ID is the identity authority. Gmail is an explicit OAuth connection with encrypted refresh-token storage, persisted inbox messages, and reply-pause behavior.

## Functional surface

- Perpendicular-hosted sign-in with password and MFA handoff to Blueblood ID, plus product membership and workspace isolation.
- Employee creation, prompt versions, golden evaluations, chat, manual runs, schedules, and heartbeat execution.
- Knowledge capture from pasted text or a public URL, with scoped retrieval and citations.
- Smart List creation, lead import, public company research, dedupe, credit accounting, and sequence enrollment gates.
- Draft sequences with suppression/reply-pause state. No external email is sent unless Gmail is connected and a send command is explicitly called.
- Ticket queue with priority, owner, SLA deadline, resolution, and CSAT.
- Gmail OAuth with PKCE, encrypted refresh tokens, message sync, inbox persistence, and reply detection.
- Scoped API keys, revocation, audit events, OpenAPI JSON, and MCP JSON-RPC tools.
- Self-hosted pricing endpoint: Open Source is free; there is no fake Stripe checkout.

## Run locally

```bash
npm install
cp .env.example .env.local
ALLOW_UNAUTHENTICATED_LOCAL=true ALLOW_LOCAL_LLM_FALLBACK=true npm run dev
```

Local development can use the JSON state fallback. Production cannot: `DATABASE_URL`, `BLUEBLOOD_ID_*`, `INTEGRATION_ENCRYPTION_KEY`, and `CRON_SECRET` are required on the Dell. Ollama is required for production employee runs; the app fails clearly if it is unavailable.

## Database

Apply `db/001_workspace_state.sql` and then `db/002_platform.sql` to the dedicated `perpendicular` Postgres database. Do not use the shared Blueblood ID database for product state. The second migration contains integration, OAuth-state, API-key, audit, job, and inbox tables.

## Verify

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev --audit-level=high
```

The API contract is available at `/api/docs`. The launch runbook and trust boundaries are in [`docs/production-architecture.md`](docs/production-architecture.md) and [`deploy/dell/README.md`](deploy/dell/README.md).

## Required provider setup

Perpendicular owns the sign-in screen. Blueblood ID remains the server-side identity authority: it validates the password or MFA challenge and issues the signed, cross-subdomain session cookie; no identity token is returned to browser JavaScript. Gmail requires a Google Cloud OAuth web client with the exact redirect URI in `GOOGLE_GMAIL_REDIRECT_URI`, plus the Gmail scopes requested by the app. The client secret and `INTEGRATION_ENCRYPTION_KEY` stay server-side. A Gmail send has not been performed by this repository; use the Settings test-send action only against an address you control.

No enrichment vendor, hosted model, Stripe checkout, telephony provider, LinkedIn automation, or WhatsApp provider is silently substituted. If one is not configured, its action is unavailable or returns a clear configuration error.

## License

MIT. See [`LICENSE`](LICENSE).
