#!/usr/bin/env bash
set -Eeuo pipefail

readonly env_file="/opt/blueblood/perpendicular.env"
readonly compose_base="/opt/blueblood/docker-compose.yml"

if [[ ! -f "$compose_base" || ! -f "$env_file" ]]; then
  echo "Perpendicular database deployment files are missing from /opt/blueblood." >&2
  exit 1
fi

# The env file is root-owned and is the source of truth for cron-run backups.
# Load it before resolving the optional remote and retention settings.
set -a
# shellcheck disable=SC1091
source "$env_file"
set +a

readonly project="blueblood"
readonly backup_dir="${PERPENDICULAR_BACKUP_DIR:-/opt/blueblood/backups/perpendicular}"
readonly db_service="${PERPENDICULAR_DB_SERVICE:-postgres}"
readonly db_name="${PERPENDICULAR_DB_NAME:-perpendicular}"
readonly db_user="${PERPENDICULAR_DB_USER:-blueblood}"
readonly retention_days="${PERPENDICULAR_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"
compose=(docker compose -p "$project" -f "$compose_base")
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/perpendicular-${stamp}.dump"
temporary_file="${backup_file}.tmp"

cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

echo "Creating a custom-format Postgres backup at ${backup_file}."
"${compose[@]}" exec -T "$db_service" pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --username="$db_user" \
  --dbname="$db_name" > "$temporary_file"

"${compose[@]}" exec -T "$db_service" pg_restore --list < "$temporary_file" >/dev/null
mv "$temporary_file" "$backup_file"
chmod 0600 "$backup_file"

find "$backup_dir" -type f -name 'perpendicular-*.dump' -mtime "+${retention_days}" -delete

if [[ -n "${PERPENDICULAR_BACKUP_REMOTE:-}" ]]; then
  command -v rclone >/dev/null || { echo "PERPENDICULAR_BACKUP_REMOTE is set but rclone is not installed." >&2; exit 1; }
  rclone copy --immutable "$backup_file" "$PERPENDICULAR_BACKUP_REMOTE"
  echo "Offsite copy completed."
else
  echo "Local backup completed. Configure PERPENDICULAR_BACKUP_REMOTE for an offsite copy."
fi

echo "Backup verified: ${backup_file}"
