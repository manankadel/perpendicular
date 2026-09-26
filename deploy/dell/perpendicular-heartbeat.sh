#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/opt/blueblood/perpendicular.env"
LOCK_FILE="/run/lock/perpendicular-heartbeat.lock"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Environment file is not readable: $ENV_FILE" >&2
  exit 1
fi

cron_secret="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | head -n 1)"
api_origin="$(sed -n 's/^PERPENDICULAR_API_ORIGIN=//p' "$ENV_FILE" | head -n 1)"
api_origin="${api_origin:-https://perpendicular-api.bluebloodstudio.com}"
if [[ -z "$cron_secret" ]]; then
  echo "CRON_SECRET is missing from $ENV_FILE" >&2
  exit 1
fi

exec flock -n "$LOCK_FILE" curl --fail --silent --show-error --max-time 240 \
  -X POST "${api_origin%/}/api/cron/heartbeat" \
  -H "Authorization: Bearer $cron_secret" >/dev/null
