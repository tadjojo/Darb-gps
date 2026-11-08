#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 2
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
command -v docker >/dev/null 2>&1 || { echo 'Docker is required.' >&2; exit 2; }

OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/${POSTGRES_DB}-${STAMP}.dump"
export PGPASSWORD="$POSTGRES_PASSWORD"
docker compose --env-file "$ENV_FILE" -f docker-compose.yml exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$OUT"
unset PGPASSWORD
test -s "$OUT"
echo "Backup created: $OUT"
echo 'Store this backup outside the application server and test restoration periodically.'
