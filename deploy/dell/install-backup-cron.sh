#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-/opt/blueblood/perpendicular.env}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_path="/opt/blueblood/backup-postgres.sh"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root so the backup script and cron entry stay protected." >&2
  exit 1
fi

if [[ ! -r "$env_file" ]]; then
  echo "Environment file is not readable: $env_file" >&2
  exit 1
fi

install -m 0750 -o root -g root "$script_dir/backup-postgres.sh" "$backup_path"
existing="$(crontab -l 2>/dev/null || true)"
without_backup="$(printf '%s\n' "$existing" | sed '/\/opt\/blueblood\/backup-postgres\.sh/d')"
printf '%s\n15 2 * * * %s\n' "$without_backup" "$backup_path" | crontab -
echo "Installed Perpendicular daily backup cron using $env_file."
