#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${DARB_BASE_URL:-http://127.0.0.1:8080}"
if ! command -v curl >/dev/null 2>&1; then
  echo 'curl is required.' >&2
  exit 2
fi

check() {
  local label="$1" url="$2" expected="$3" body
  body="$(curl --fail --silent --show-error --max-time 8 "$url")" || {
    echo "FAIL: $label ($url)" >&2
    exit 1
  }
  if [[ "$body" != *"$expected"* ]]; then
    echo "FAIL: $label returned unexpected body: $body" >&2
    exit 1
  fi
  echo "PASS: $label"
}

check 'API liveness' "$BASE_URL/api/v1/health/live" '"status":"ok"'
check 'API readiness (PostgreSQL + Redis)' "$BASE_URL/api/v1/health/ready" '"status":"ready"'
echo 'DARB API stack is responding. Authentication and GPS hardware still require separate acceptance tests.'
