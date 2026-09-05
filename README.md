# Perpendicular

Perpendicular is an open-source work system for small teams that want autonomous AI employees with visible context, quality scores, and follow-through.

The working thesis came from the Parallel Labs audit: broad AI workspaces are easy to demo and hard to trust. Perpendicular makes the proof part of the product. A role has a prompt, memory, knowledge, schedule, runs, scores, prompt versions, and a golden evaluation set. A lead row can be enriched and enrolled without leaving the list. A support escalation has an ID, an owner, an SLA, and a customer rating.

## What works now

- Company-scoped workspace state.
- AI employee creation with versioned prompts and golden tests.
- Chat with scoped knowledge retrieval, citations, Ollama support, and an offline fallback.
- Manual runs and scheduled heartbeat runs with independent scores and trace steps.
- Prompt version history plus golden evaluation that proposes a new version instead of silently changing the live prompt.
- Knowledge source ingestion from pasted text or URLs, with immediate local retrieval.
- Smart List search, per-row local enrichment, visible Data Credit cost, dedupe-safe enrollment, and suppression-aware sequence status.
- Multi-step sequences with reply-pause and sender guardrail copy.
- Support tickets with priority, assignee, SLA clock, resolution, and CSAT.
- Activity log, usage gauges, and a Dell/Ollama/Postgres self-hosting panel.
- Docker image, Postgres adapter, local JSON fallback, and Dell deployment notes.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No paid API key is required. If Ollama is installed, run `ollama pull qwen2.5:3b`; otherwise the app uses its clearly labeled local fallback.

The first local request creates `data/workspace-state.json`. That file is ignored by git. Set `DATABASE_URL` when you want to exercise the Postgres adapter.

## Verify

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

## Architecture choices

This first slice is intentionally boring:

- Next.js App Router for the web product and Node runtime API routes.
- Postgres JSONB for the initial company-scoped state so the product can move fast without locking the domain model to a brittle schema. The migration is in `db/001_workspace_state.sql`.
- Ollama for local model inference. The LLM adapter is isolated in `src/lib/llm.ts`, so Qdrant embeddings, a different open model, or a queue worker can be added without changing the UI contract.
- A host-triggered heartbeat endpoint instead of pretending a serverless timer is durable.
- No external analytics, billing, CRM, enrichment, telephony, or hosted model provider is required for the core demo.

## What is deliberately not faked yet

Real email sending, LinkedIn automation, telephony, CRM sync, billing, SSO, and full field-level RBAC require provider credentials and operational policy. The app exposes the contracts and UI states needed to add them, but does not pretend a local deterministic enrichment function is Apollo or a local sequence is an inbox sender. Those are the next production adapters, after the core loop is validated.

## License

MIT. See `LICENSE`.
