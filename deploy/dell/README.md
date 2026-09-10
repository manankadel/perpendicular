# Perpendicular on the Dell

This is the deployment note for the Blueblood in-house server. It does not modify the server by itself.

## Runtime shape

- Perpendicular web container: one long-running Next.js process.
- Postgres: reuse the shared Blueblood Postgres on the Docker network. The app never mutates production schema; the dedicated database must be migrated before rollout.
- Model runtime: Ollama on the Dell, reachable from the container through the configured `OLLAMA_BASE_URL`.
- Public access: Caddy + the existing Cloudflare Tunnel. Do not open a router port.
- Heartbeats: host cron calls `/api/cron/heartbeat` with `Authorization: Bearer $CRON_SECRET`; the endpoint scans all persisted workspaces and executes only due schedules.

## First install

1. Install an open model on the Dell: `ollama pull qwen2.5:3b`.
2. Do not build application images on the Dell. GitHub Actions publishes a Linux amd64 image to `ghcr.io/manankadel/perpendicular-api` for every `main` release. Dell only pulls an exact image digest and never runs `git pull`, `npm ci`, or `docker build` for Perpendicular.
3. Create the dedicated `perpendicular` database, apply `db/001_workspace_state.sql`, `db/002_platform.sql`, `db/003_gmail_events_health.sql`, and then `db/004_usage_ledger.sql`. Put runtime values in a root-owned env file, not in this repository:

```env
DATABASE_URL=postgresql://blueblood:<password>@postgres:5432/perpendicular
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_TIMEOUT_MS=60000
CRON_SECRET=<long-random-secret>
BLUEBLOOD_ID_ISSUER=https://id.bluebloodstudio.com
BLUEBLOOD_ID_JWKS_URL=https://id.bluebloodstudio.com/api/.well-known/jwks.json
BLUEBLOOD_ID_PRODUCT_SLUG=perpendicular
PERPENDICULAR_WEB_ORIGIN=https://perpendicular.bluebloodstudio.com
# Exact browser origins allowed to call the API. No wildcard is permitted with credentials.
PERPENDICULAR_WEB_ORIGINS=https://perpendicular.bluebloodstudio.com,https://perpendicular-nine.vercel.app
PERPENDICULAR_API_ORIGIN=https://perpendicular-api.bluebloodstudio.com
GOOGLE_GMAIL_CLIENT_ID=<google-web-client-id>
GOOGLE_GMAIL_CLIENT_SECRET=<google-web-client-secret>
GOOGLE_GMAIL_REDIRECT_URI=https://perpendicular-api.bluebloodstudio.com/api/integrations/google/callback
INTEGRATION_ENCRYPTION_KEY=<32-byte-key>
GMAIL_PUBSUB_TOPIC=projects/<project>/topics/<topic>
GMAIL_WEBHOOK_SECRET=<long-random-secret>
API_KEY_RATE_LIMIT_PER_MINUTE=120
ALLOW_LOCAL_LLM_FALLBACK=false
```

4. Install `deploy/dell/perpendicular.image.compose.yml` as `/opt/blueblood/perpendicular.image.compose.yml` and `deploy/dell/deploy-image.sh` as `/opt/blueblood/deploy-image.sh` with root ownership. The overlay is deliberately image-only; it removes the old `build:` source checkout from the Perpendicular service.
5. If the GHCR package is private, authenticate Docker on the Dell with a dedicated read-only `read:packages` credential. Do not put that credential in this repository or in `perpendicular.env`.
6. Attach the container to the existing Blueblood Docker network so `postgres` resolves. If the current compose project uses a different network name, use the real name from `docker network ls`.
7. Add a Caddy route for the chosen host, for example `perpendicular.bluebloodstudio.com`, proxying to the container port.
8. Add the matching Cloudflare Tunnel ingress and DNS route.
9. Add a single host cron entry that runs every five minutes during active hours:

```cron
*/5 7-22 * * * curl -fsS -X POST https://perpendicular.bluebloodstudio.com/api/cron/heartbeat -H "Authorization: Bearer <secret>" -H "X-Company-ID: blueblood-demo" >/dev/null
```

Install `deploy/dell/backup-postgres.sh` as `/opt/blueblood/backup-postgres.sh` with root ownership. Run it daily from root cron. It creates a verified custom-format dump of only the dedicated `perpendicular` database using the Dell's `blueblood` Postgres role by default, keeps fourteen local days, and copies to `PERPENDICULAR_BACKUP_REMOTE` when configured with rclone. A launch gate is not complete until one dump has been restored into a clean, separately named database and the offsite copy has been retrieved successfully.

## Release and rollback

The workflow uploads a release manifest containing the immutable digest. Deploy that exact digest as root on the Dell:

```bash
/opt/blueblood/deploy-image.sh ghcr.io/manankadel/perpendicular-api@sha256:<64-hex-digest>
```

The script uses a lock, pulls only `perpendicular-api`, replaces only that container, waits for the container health check and public `/api/health`, verifies the running image reference, and records the previous local image for rollback:

```bash
/opt/blueblood/deploy-image.sh --rollback
```

It never runs `docker compose down`, `--remove-orphans`, database migrations, or a whole-stack `up`.

## Health check

```bash
curl -fsS https://perpendicular-api.bluebloodstudio.com/api/health | jq '{ok, database, schema, configuration, version}'
```

The workspace endpoint is authenticated and should not be used as an anonymous health probe. A production release is not ready when `schema.ok` is false or when `configuration.gaps` contains a required provider setting.

The app falls back to atomic JSON storage only outside production. On the Dell, a Postgres connection failure is an incident and the API returns an unavailable status; it does not silently accept writes into ephemeral container storage.

Gmail OAuth automatically registers a watch when `GMAIL_PUBSUB_TOPIC` is configured. The heartbeat renews watches inside the 12-hour renewal window, and the Settings page exposes a manual renewal action. Configure the Pub/Sub push subscription with the same `GMAIL_WEBHOOK_SECRET`; events are persisted and deduplicated before the mailbox is synchronized.
