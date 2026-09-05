# Perpendicular on the Dell

This is the deployment note for the Blueblood in-house server. It does not modify the server by itself.

## Runtime shape

- Perpendicular web container: one long-running Next.js process.
- Postgres: reuse the shared Blueblood Postgres on the Docker network. The app creates only `perpendicular_workspace_state`.
- Model runtime: Ollama on the Dell, reachable from the container through the configured `OLLAMA_BASE_URL`.
- Public access: Caddy + the existing Cloudflare Tunnel. Do not open a router port.
- Heartbeats: host cron calls `/api/cron/heartbeat` with `Authorization: Bearer $CRON_SECRET`.

## First install

1. Install an open model on the Dell: `ollama pull qwen2.5:3b`.
2. Build this image on the Dell or build it off-box for amd64 and copy the image over. Follow the server rule: one build at a time and watch temperatures.
3. Put runtime values in a root-owned env file, not in this repository:

```env
DATABASE_URL=postgresql://blueblood:<password>@postgres:5432/blueblood
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=qwen2.5:3b
CRON_SECRET=<long-random-secret>
DEFAULT_COMPANY_ID=blueblood-demo
```

4. Attach the container to the existing Blueblood Docker network so `postgres` resolves. If the current compose project uses a different network name, use the real name from `docker network ls`.
5. Add a Caddy route for the chosen host, for example `perpendicular.bluebloodstudio.com`, proxying to the container port.
6. Add the matching Cloudflare Tunnel ingress and DNS route.
7. Add a single host cron entry that runs every five minutes during active hours:

```cron
*/5 7-22 * * * curl -fsS -X POST https://perpendicular.bluebloodstudio.com/api/cron/heartbeat -H "Authorization: Bearer <secret>" -H "X-Company-ID: blueblood-demo" >/dev/null
```

## Health check

```bash
curl -fsS https://perpendicular.bluebloodstudio.com/api/workspace | jq '.workspace, (.employees | length)'
```

The current app falls back to atomic JSON storage if Postgres is unavailable, which keeps local development alive. On the Dell, treat a Postgres connection failure as an incident; do not rely on the fallback for production data.
