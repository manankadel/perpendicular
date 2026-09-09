#!/usr/bin/env bash
set -Eeuo pipefail

readonly project="blueblood"
readonly compose_base="/opt/blueblood/docker-compose.yml"
readonly compose_overlay="/opt/blueblood/perpendicular.image.compose.yml"
readonly env_file="/opt/blueblood/perpendicular.env"
readonly service="perpendicular-api"
readonly container="perpendicular-api"
readonly health_url="${PERPENDICULAR_HEALTH_URL:-https://perpendicular-api.bluebloodstudio.com/api/health}"
readonly state_dir="/opt/blueblood/perpendicular-releases"
readonly rollback_file="${state_dir}/rollback-image"
readonly lock_file="${state_dir}/deploy.lock"

mkdir -p "$state_dir"
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "A Perpendicular deployment is already running." >&2
  exit 1
fi

if [[ ! -f "$compose_base" || ! -f "$compose_overlay" || ! -f "$env_file" ]]; then
  echo "Perpendicular deployment files are missing from /opt/blueblood." >&2
  exit 1
fi

compose=(docker compose -p "$project" -f "$compose_base" -f "$compose_overlay")

wait_for_container_health() {
  local status
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container" 2>/dev/null || true)"
    case "$status" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
    esac
    sleep 2
  done
  return 1
}

wait_for_http_health() {
  for _ in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 8 "$health_url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  local rollback_ref="$1"
  echo "Rolling Perpendicular API back to ${rollback_ref}." >&2
  export PERPENDICULAR_IMAGE="$rollback_ref"
  export PERPENDICULAR_PULL_POLICY=never
  "${compose[@]}" up -d --no-deps --pull never "$service" >/dev/null
  if ! wait_for_http_health; then
    echo "Rollback health check failed. Inspect: docker logs --tail 100 ${container}" >&2
    return 1
  fi
  echo "Rollback is healthy. Other Compose services were not touched."
}

if [[ "${1:-}" == "--rollback" ]]; then
  if [[ ! -s "$rollback_file" ]]; then
    echo "No local Perpendicular rollback image is recorded." >&2
    exit 1
  fi
  rollback "$(<"$rollback_file")"
  exit $?
fi

image="${1:-${PERPENDICULAR_IMAGE:-}}"
if [[ ! "$image" =~ ^ghcr\.io/manankadel/perpendicular-api@sha256:[0-9a-f]{64}$ ]]; then
  echo "Deploy an exact GHCR digest, for example ghcr.io/manankadel/perpendicular-api@sha256:<64 hex chars>." >&2
  exit 1
fi

previous_image_id="$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true)"
if [[ -z "$previous_image_id" ]]; then
  echo "The current Perpendicular API container was not found; refusing an untracked rollout." >&2
  exit 1
fi

release_stamp="$(date -u +%Y%m%d%H%M%S)"
rollback_ref="perpendicular-api-rollback:${release_stamp}"
docker tag "$previous_image_id" "$rollback_ref"

export PERPENDICULAR_IMAGE="$image"
export PERPENDICULAR_PULL_POLICY=always

echo "Pulling ${image}."
"${compose[@]}" pull "$service"

rollback_needed=0
trap 'if [[ "$rollback_needed" == "1" ]]; then rollback "$rollback_ref" || true; fi' EXIT
rollback_needed=1

echo "Replacing only ${service}."
"${compose[@]}" up -d --no-deps --pull never "$service"

if ! wait_for_container_health; then
  echo "The new container did not become healthy." >&2
  docker logs --tail 100 "$container" >&2 || true
  exit 1
fi

if ! wait_for_http_health; then
  echo "The public API health check failed." >&2
  docker logs --tail 100 "$container" >&2 || true
  exit 1
fi

running_ref="$(docker inspect --format '{{.Config.Image}}' "$container")"
if [[ "$running_ref" != "$image" ]]; then
  echo "The running container is not using the requested digest: ${running_ref}" >&2
  exit 1
fi

printf '%s\n' "$rollback_ref" > "$rollback_file"
chmod 0600 "$rollback_file"
rollback_needed=0
trap - EXIT
echo "Perpendicular API is healthy on ${image}."
echo "Rollback is available with: $0 --rollback"
