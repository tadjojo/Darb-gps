# Free-plan API migration prototype (not production)

Branch `cloudflare-free-api-migration` contains a Worker-native scaffold intended for Cloudflare Workers Free.

## Implemented in this prototype
- Liveness endpoint (`/api/v1/health/live`).
- Readiness endpoint checks whether Supabase settings exist; it does not test DB connectivity.
- Supabase Auth login, refresh, and logout proxy scaffolding.
- Origin allow-list CORS.
- Tests for health/readiness, CORS, login input validation, and explicit 501 responses for unported routes.
- No Cloudflare Containers dependency; no secrets or placeholder credentials in Wrangler config.

## Not migrated
Organizations, vehicles, memberships, GPS mobile tracking, hardware device credentials/protocols, alerts, realtime, and admin. Unported routes return 501.

## Configuration
Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as Worker variables/secrets through Cloudflare dashboard or Wrangler. Do not commit secrets. Do not deploy as production replacement until migration, configuration, and full tests pass.
