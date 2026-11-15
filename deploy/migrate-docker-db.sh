#!/usr/bin/env bash
set -euo pipefail

legacy_project=${1:-order-guard}
cosign_project=${2:-cosign}
legacy_db="$legacy_project-db-1"
destination="${cosign_project}_postgres"
helper="cosign-db-migration-$$"
data_dir=/var/lib/postgresql/data
created=false
verified=false

fail() { echo "$*" >&2; exit 1; }
cleanup() {
  if docker container inspect "$helper" >/dev/null 2>&1; then
    docker stop "$helper" >/dev/null 2>&1 || true
  fi
  if [[ "$created" == true && "$verified" == false ]]; then
    docker volume rm "$destination" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "$legacy_project" != "$cosign_project" ]] || fail "The source and destination Compose projects must differ."
[[ -z $(docker ps --filter "label=com.docker.compose.project=$legacy_project" --quiet) ]] ||
  fail "Stop all containers in $legacy_project before copying the database. Keep the stopped containers."
image=$(docker container inspect --format '{{.Image}}' "$legacy_db") ||
  fail "Could not find the stopped database container $legacy_db."
source=$(docker container inspect --format '{{range .Mounts}}{{if and (eq .Type "volume") (eq .Destination "/var/lib/postgresql/data")}}{{.Name}}{{end}}{{end}}' "$legacy_db")
[[ -n "$source" && "$source" != "$destination" ]] || fail "Could not identify a separate source PostgreSQL volume."
[[ -z $(docker ps --filter "volume=$source" --quiet) ]] || fail "Stop all containers using $source."
if docker volume inspect "$destination" >/dev/null 2>&1; then
  fail "The destination volume $destination already exists. The migration does not replace an existing database."
fi

docker volume create --label "com.docker.compose.project=$cosign_project" \
  --label com.docker.compose.volume=postgres \
  --label "com.valio.cosign.migrated-from=$source" "$destination" >/dev/null
created=true
docker run --rm --network none --user 0:0 --entrypoint sh \
  --mount "type=volume,src=$source,dst=/source,readonly" \
  --mount "type=volume,src=$destination,dst=/destination" "$image" \
  -ec 'cp -a /source/. /destination/; chown postgres:postgres /destination; chmod 700 /destination'

docker run --rm -d --name "$helper" --network none --user postgres \
  --stop-signal SIGINT --entrypoint postgres \
  --mount "type=volume,src=$destination,dst=$data_dir" "$image" \
  -D "$data_dir" -c listen_addresses= >/dev/null

ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker exec "$helper" pg_isready -q -U orderguard -d postgres; then
    ready=true
    break
  fi
  sleep 1
done
[[ "$ready" == true ]] || fail "The copied PostgreSQL cluster did not start."

docker exec -i "$helper" psql -U orderguard -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_authid WHERE rolname = current_user AND rolpassword LIKE 'md5%') THEN
    RAISE EXCEPTION 'Set a SCRAM password on the source role before migration';
  END IF;
END
$$;
CREATE ROLE cosign_volume_migrator LOGIN SUPERUSER;
SQL

docker exec -i "$helper" psql -U cosign_volume_migrator -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
ALTER ROLE orderguard RENAME TO cosign;
ALTER DATABASE orderguard RENAME TO cosign;
SELECT 'ALTER DATABASE orderguard_simulator RENAME TO cosign_simulator'
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = 'orderguard_simulator') \gexec
SELECT 'CREATE DATABASE cosign_simulator OWNER cosign'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'cosign_simulator') \gexec
SQL

docker exec "$helper" psql -U cosign -d postgres -v ON_ERROR_STOP=1 -q -c 'DROP ROLE cosign_volume_migrator'
docker exec "$helper" psql -U cosign -d cosign -v ON_ERROR_STOP=1 -q -c 'SELECT 1' >/dev/null
docker exec "$helper" psql -U cosign -d cosign_simulator -v ON_ERROR_STOP=1 -q -c 'SELECT 1' >/dev/null
docker exec "$helper" touch "$data_dir/.cosign-migration-complete"
docker stop "$helper" >/dev/null
verified=true
echo "Migrated $source to $destination. The original volume is available for rollback."
