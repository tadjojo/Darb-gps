#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.example to .env and configure secrets first." >&2
  exit 2
fi

require_secret() {
  local key="$1" minimum="$2"
  local value
  value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)"
  if [[ ${#value} -lt "$minimum" || "$value" == *CHANGE_THIS* || "$value" == *replace-with* ]]; then
    echo "$key must be set to a non-placeholder value of at least $minimum characters in $ENV_FILE" >&2
    exit 2
  fi
}
require_secret POSTGRES_PASSWORD 24
require_secret JWT_ACCESS_SECRET 32

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required for this deployment script.' >&2
  exit 2
fi
docker compose version >/dev/null

COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.multi-instance.yml)
"${COMPOSE[@]}" up -d postgres redis
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --build api-1 api-2 load-balancer

echo 'DARB API deployment started. Check readiness at http://127.0.0.1:8080/api/v1/health/ready'
echo 'This sample profile is not production HA: PostgreSQL and Redis are single instances.'
