#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-/opt/blueblood/perpendicular.env}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper_path="/usr/local/sbin/perpendicular-heartbeat"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root so the cron helper and secret stay protected." >&2
  exit 1
fi

if [[ ! -r "$env_file" ]]; then
  echo "Environment file is not readable: $env_file" >&2
  exit 1
fi

install -m 0750 -o root -g root "$script_dir/perpendicular-heartbeat.sh" "$helper_path"
existing="$(crontab -l 2>/dev/null || true)"
without_heartbeat="$(printf '%s\n' "$existing" | sed '/perpendicular-heartbeat\.lock.*api\/cron\/heartbeat/d')"
without_heartbeat="$(printf '%s\n' "$without_heartbeat" | sed '/perpendicular-heartbeat$/d')"
printf '%s\n*/5 7-22 * * * %s\n' "$without_heartbeat" "$helper_path" | crontab -
echo "Installed Perpendicular heartbeat cron using $env_file."
