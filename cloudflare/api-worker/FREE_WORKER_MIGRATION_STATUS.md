# Cloudflare Workers Free migration — staging prototype

**Status:** Draft PR #46. Not deployed. Production API and main branch remain unchanged.

## Included in the staging branch
- Worker-native liveness/readiness, Supabase Auth login/refresh/logout, and minimal authenticated profile route.
- Organization/vehicle operations, membership routes, mobile device enrollment/listing, location ingestion/latest/history, trips, trip route and stops using staged authenticated Supabase RPCs.
- Hardware GPS tracker enrollment, one-time bearer credential, credential rotation/revocation, JSON HTTPS ingestion, GT06 heartbeat and HTTPS GT06/NMEA adapters.
- Alerts API and rules, acknowledge/resolve actions, speed-limit and geofence evaluation, tamper and offline/recovery events.
- Flutter live-location client polls REST latest-location every 10 seconds (no Socket.IO dependency); alert tab refreshes every 30 seconds while open.
- Flutter UI for alerts and rule creation; GPS hardware enrollment (JSON/GT06/NMEA), tracker credential rotation and revocation.
- Tracker secret is shown once; server stores its hash. Never commit credentials.
- Worker uses Cloudflare Workers APIs, no Containers. Config has no secrets.

## Validation
- Cloudflare Worker validation CI: **49 Node tests passed** and Wrangler deploy dry-run succeeded on commit 70fb08db.
- Validation CI started again for subsequent Flutter tracker UI commit 11883345; Android/iOS/smoke checks were still pending at this note's time.
- SQL RPC migrations were inspected/tested in rollback-only transactions against Supabase; no persistent schema changes were made by that test.
- CI smoke check targets current legacy Render API as a baseline; it is not evidence Cloudflare Worker deployment/production test.

## Remaining before production cutover
- Configure Worker vars/secrets: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and service-role secret used by server-side ingestion RPCs. Configure only in Cloudflare dashboard; do not commit.
- Apply/verify staged Supabase migrations in dedicated staging, then production with backup/rollback plan.
- Deploy Worker and run authenticated integration tests against staging.
- Raw TCP GPS hardware reception requires a separate gateway; Worker HTTPS adapter is not a TCP listener.
- Review/complete admin console, push notifications and monitoring; validate all API endpoints and UI contracts.
- Verify Flutter builds/tests on Android/iOS and complete security review before merging/replacing production endpoint.

## Free-tier constraints and caveats
- Readiness confirms required config values exist, not live Supabase connectivity.
- Realtime fan-out is replaced by 10-second polling; update latency and request volume differ.
- No Worker deployment or production DB schema change has been performed by this migration work.
