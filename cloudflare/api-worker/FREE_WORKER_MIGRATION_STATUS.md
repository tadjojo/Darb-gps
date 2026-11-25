# Free-plan API migration prototype (not production)

Branch `cloudflare-free-api-migration` contains a Worker-native scaffold intended for Cloudflare Workers Free.

## Implemented in this prototype
- Liveness endpoint (`/api/v1/health/live`).
- Readiness endpoint checks whether Supabase settings exist; it does not test DB connectivity.
- Supabase Auth login, refresh, and logout proxy scaffolding.
- Organization creation, vehicle creation, and vehicle listing route prototypes through authenticated Supabase RPCs.
- Transaction-safe SQL RPC migration is staged for these operations; syntax checked against the live project in a transaction that was rolled back (no persistent schema change).
- Authenticated `/api/v1/auth/me` endpoint validates bearer tokens through Supabase Auth and returns a minimal profile (id/email/phone/role only).
- Origin allow-list CORS.
- Tests for health/readiness, CORS, login input validation, Supabase auth proxy happy-path (login/refresh/logout), and explicit 501 responses for unported routes.
- Supabase logout uses local-session scope and is tested to forward the access-token bearer.
- Latest Worker validation passed on commit `f091f596` (22 Node tests and Wrangler dry-run). Subsequent org/vehicle code was tested and passed on commit `f091f596`; PR branch includes newer documentation/migration commits.
- No Cloudflare Containers dependency; no secrets or placeholder credentials in Wrangler config.

## Not migrated
Organizations, vehicles, memberships, GPS mobile tracking, hardware device credentials/protocols, alerts, realtime, and admin. Unported routes return 501.

## Live project review
- Supabase project was read-only inspected: schema and RLS roles confirmed; no persistent changes were made.
- A non-destructive index migration for four private alert-table foreign keys and the RPC migration are staged in this branch only.
- Supabase Auth leaked-password protection is currently disabled; project owner should enable it in Auth settings.

## Configuration
Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Worker variables/secrets through Cloudflare dashboard or Wrangler. Do not commit secrets. Do not deploy as production replacement until migration, configuration, and full tests pass.


## Migration notes from backend/client review
- Flutter client API contract expects organization/vehicle creation and listing, mobile enrollment, location ingestion/latest, device listing, trip/route/stop queries.
- Existing backend uses PostgreSQL transactions and private-schema tables for tracking-device credential records; direct PostgREST calls are not a safe drop-in replacement.
- Organization creation and vehicle enrollment/member actions need atomic database operations and explicit authorization. Plan to implement through reviewed Supabase SQL RPC functions or equivalent transactional routines, not multiple independent REST writes.
- Raw hardware tracker protocols (TCP/GT06/NMEA) cannot be hosted by a standard HTTP Worker fetch handler. Keep hardware ingest out of this Worker until a supported receiver/transport architecture is selected.
