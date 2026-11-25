# Free-plan API migration prototype (not production)

Branch `cloudflare-free-api-migration` contains a Worker-native scaffold intended for Cloudflare Workers Free.

## Implemented in this prototype
- Liveness endpoint (`/api/v1/health/live`).
- Readiness endpoint checks whether Supabase settings exist; it does not test DB connectivity.
- Supabase Auth login, refresh, and logout proxy scaffolding.
- Organization creation, vehicle creation, and vehicle listing route prototypes through authenticated Supabase RPCs.
- Mobile enrollment, device listing, location ingestion, latest-location, history, trips, trip route, and stops through authenticated RPCs.
- GPS hardware tracker enrollment, one-time credential generation, credential rotation, revocation, JSON ingest, GT06 heartbeat, and HTTPS GT06/NMEA adapters. Hardware ingestion is service-role RPC-backed; the service-role key is a Cloudflare-only secret.
- Transaction-safe SQL RPC migration is staged for these operations; syntax checked against the live project in a transaction that was rolled back (no persistent schema change).
- Authenticated `/api/v1/auth/me` endpoint validates bearer tokens through Supabase Auth and returns a minimal profile (id/email/phone/role only).
- Origin allow-list CORS.
- 26 automated Worker tests cover health/readiness, CORS, login/refresh/logout/auth-me, organizations/vehicles, mobile enrollment, device listing, location validation/ingestion and latest-location routes.
- Supabase logout uses local-session scope and is tested to forward the access-token bearer.
- Latest Worker validation passed on commit `c569bd0b` (40 Node tests and Wrangler dry-run). Organization/vehicle and mobile RPC SQL were runtime-tested using a simulated authenticated role in rollback-only transactions; no test data remained.
- No Cloudflare Containers dependency; no secrets or placeholder credentials in Wrangler config.

## Not migrated
Vehicle membership add/revoke, raw TCP hardware reception, alert evaluation and alert API, realtime, and admin. Unported routes return 501.

## Live project review
- Supabase project was read-only inspected: schema and RLS roles confirmed; no persistent changes were made.
- A non-destructive index migration for four private alert-table foreign keys and the RPC migration are staged in this branch only.
- Supabase Auth leaked-password protection is currently disabled; project owner should enable it in Auth settings.

## Configuration
Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Worker variables/secrets through Cloudflare dashboard or Wrangler. Do not commit secrets. Do not deploy as production replacement until migration, configuration, and full tests pass.


## Migration notes from backend/client review
- Flutter client API contract expects organization/vehicle creation and listing, mobile enrollment, location ingestion/latest, device listing, trip/route/stop queries.
- Existing backend uses PostgreSQL transactions and private-schema tables for tracking-device credential records; direct PostgREST calls are not a safe drop-in replacement.
- Organization, vehicle, and mobile tracking operations use staged transaction-safe RPCs with authorization derived from `auth.uid()`. Vehicle membership add/revoke and other tracking/admin routes remain unported.
- Direct raw TCP tracker reception is not supported by the Worker fetch handler; the migrated GT06/NMEA routes accept HTTPS payload adapters, while the existing TCP gateway remains separate.
