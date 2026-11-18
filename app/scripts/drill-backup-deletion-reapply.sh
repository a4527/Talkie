#!/usr/bin/env bash
# DEC-044 synthetic-only drill: deletion-state reapplication before restored DB access.
# Starts two throwaway PostgreSQL 16.15 containers on tmpfs (no volume, no logs, loopback-only random ports),
# runs tests/backup-deletion-reapply.drill.test.ts, then removes the containers. Nothing persists:
# the backup lives in test memory and the restored DB is inside the tmpfs container.
# Never point this at the Compose databases or any real user data. Usage (from app/): bash scripts/drill-backup-deletion-reapply.sh
set -euo pipefail
cd "$(dirname "$0")/.."
tag="talkie-drill-dec044-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
pw_r="$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')"; pw_t="$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cleanup() { docker rm -f "$tag-records" "$tag-transcripts" >/dev/null 2>&1 || true; }
trap cleanup EXIT
start() { # name db password
  docker run -d --name "$1" --log-driver none -e POSTGRES_USER=talkie -e "POSTGRES_DB=$2" -e "POSTGRES_PASSWORD=$3" \
    --tmpfs /var/lib/postgresql/data:rw,size=256m -p 127.0.0.1::5432 postgres:16.15 >/dev/null
}
start "$tag-records" talkie_test_drill_records "$pw_r"
start "$tag-transcripts" talkie_test_drill_transcripts "$pw_t"
for c in "$tag-records" "$tag-transcripts"; do
  for _ in $(seq 60); do docker exec "$c" pg_isready -U talkie -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
done
port() { docker port "$1" 5432/tcp | head -1 | sed 's/.*://'; }
export DATABASE_URL="postgresql://talkie:$pw_r@127.0.0.1:$(port "$tag-records")/talkie_test_drill_records"
export TRANSCRIPT_DATABASE_URL="postgresql://talkie:$pw_t@127.0.0.1:$(port "$tag-transcripts")/talkie_test_drill_transcripts"
export DRILL_RECORDS_CONTAINER="$tag-records" APP_ORIGIN="http://127.0.0.1:3000" SMTP_HOST=127.0.0.1 SMTP_PORT=1025
# No .env is loaded: voice/provider keys stay unset, so no paid call is possible.
node --conditions=react-server --import tsx --test tests/backup-deletion-reapply.drill.test.ts
