#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
export GIT_TERMINAL_PROMPT=0
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
STATE=${COSIGN_DEPLOY_STATE:-/var/lib/cosign-deploy}
REPO=${COSIGN_REPO:-$STATE/checkout}
HEALTH_URL=${COSIGN_HEALTH_URL:-}

check_database_migration() {
  local legacy_containers legacy_volume migrated_volume
  legacy_containers=$(docker container ls --quiet --filter label=com.docker.compose.project=orderguard-live)
  if [[ -n "$legacy_containers" ]]; then
    echo 'Stop the old orderguard-live Compose services before deploying cosign-live.' >&2
    return 1
  fi
  legacy_volume=$(docker volume ls --format '{{.Name}}' --filter name=orderguard-live_postgres | awk '$0 == "orderguard-live_postgres"')
  [[ -n "$legacy_volume" ]] || return 0
  migrated_volume=$(docker volume ls --format '{{.Name}}' --filter "label=com.valio.cosign.migrated-from=$legacy_volume" | awk '$0 == "cosign-live_postgres"')
  if [[ -z "$migrated_volume" ]]; then
    echo 'Migrate the existing PostgreSQL data with ./deploy/migrate-docker-db.sh orderguard-live cosign-live before deploying.' >&2
    return 1
  fi
  if [[ ! -s "$STATE/deployed-sha" ]] &&
    ! docker run --rm --pull never --network none --user 0:0 --entrypoint sh \
      --mount "type=volume,src=$migrated_volume,dst=/data,readonly" \
      postgres:17-alpine -c 'test -f /data/.cosign-migration-complete'; then
    echo 'The Cosign database copy has no completion marker. Verify the migration before starting the deployment.' >&2
    return 1
  fi
}

if [[ ${1:-} == --check-migration ]]; then
  check_database_migration
  exit
fi

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
trap 'log "Deployment failed at line $LINENO; successful revision unchanged. Next poll will retry."' ERR
install -d -m 700 "$STATE"
exec 9>"$STATE/update.lock"
flock -n 9 || exit 0
cd "$REPO"
REPO=$(pwd -P)
[[ $(git branch --show-current) == main ]] || { log 'Refusing deployment: checkout must be on main.'; exit 1; }
[[ -z $(git status --porcelain) ]] || { log 'Refusing deployment: checkout has local changes.'; exit 1; }
check_database_migration
timeout 60 git fetch --quiet origin refs/heads/main:refs/remotes/origin/main
target=$(git rev-parse refs/remotes/origin/main)
current=$(git rev-parse HEAD)
[[ ! -f "$STATE/deployed-sha" ]] || deployed=$(cat "$STATE/deployed-sha")
[[ "$target" != "${deployed:-}" || "$current" != "$target" ]] || exit 0
# Never discard server edits or silently accept a rewritten branch.
git merge-base --is-ancestor HEAD "$target"
git merge --ff-only "$target"
log "Building main revision $target"
compose=(docker compose --project-name cosign-live --file "$REPO/compose.yaml" --env-file "$REPO/.env")
# Build failures do not recreate any running container.
"${compose[@]}" build api migrate web
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 db
# Run migrations for every revision, including retries after a failed rollout.
"${compose[@]}" run --rm --no-deps migrate
# Recreate only the application; preserve the database and its volume.
"${compose[@]}" up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 api web
if [[ -z "$HEALTH_URL" ]]; then
  endpoint=$("${compose[@]}" port web 8080)
  [[ -n "$endpoint" ]]
  HEALTH_URL="http://$endpoint/healthz"
fi
curl --fail --silent --show-error --max-time 20 "$HEALTH_URL" >/dev/null
printf '%s\n' "$target" >"$STATE/deployed-sha.tmp"
chmod 600 "$STATE/deployed-sha.tmp"
mv "$STATE/deployed-sha.tmp" "$STATE/deployed-sha"
log "Deployment healthy: $target"
