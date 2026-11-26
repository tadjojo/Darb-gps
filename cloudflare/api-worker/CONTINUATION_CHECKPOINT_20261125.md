# DARB GPS — Continuation checkpoint (2026-11-26)

## Current repository state
- Repository: https://github.com/tadjojo/Darb-gps
- Branch: `cloudflare-free-api-migration-next`
- Draft PR #46: https://github.com/tadjojo/Darb-gps/pull/46
- Verified branch head before this checkpoint update: `cabef5802c996c86f866c6507b25b638f0a67d2b`
- Main branch and production API URL remain unchanged; PR remains draft.

## Latest CI at commit cabef580
All four PR workflows completed successfully:
- Cloudflare Worker validation — success (52 Node tests, Wrangler dry-run)
- Android CI — success (Flutter checks and split-ABI debug APK build)
- iOS CI — success (simulator validation)
- Production API smoke test — success, but checks the legacy API baseline, not a deployed Worker.

## Worker security baseline
- Added Cloudflare Rate Limiting bindings: auth 20/min per IP (login/refresh), authenticated API 300/min per SHA-256 bearer hash, tracker endpoints 120/min keyed by SHA-256 credential hash. Rejected calls return 429/Retry-After; configured limiter errors fail closed. These limits are approximate per Cloudflare location and may require production tuning.
- Strict CORS allowlist; non-allowlisted origins rejected.
- Response headers: restrictive CSP, nosniff, no-referrer, anti-frame, no-store.
- Request body limited to 64 KiB, both declared Content-Length and streamed bytes.
- Tracker credentials generated with crypto randomness; only SHA-256 hash stored server-side; credential returned once.
- HTTPS JSON/GT06/NMEA ingestion adapters; raw TCP receiver is not part of Fetch Worker.
- Node test files currently contain 52 test cases; validation and Wrangler dry-run are green for the verified commit.

## Current implementation coverage
- Health live/ready; readiness checks configuration only.
- Supabase Auth login/refresh/logout/me.
- Organization/vehicle CRUD routes implemented for available RPCs; membership routes.
- Mobile tracker enrollment, location write, latest/history/trips/routes/stops.
- Hardware tracker enroll/rotate/revoke and HTTPS protocol adapters.
- Alert list, rules, acknowledge/resolve, speed-limit/geofence and tamper/offline/recovery logic.

## External deployment blockers (not safely executable from this session)
1. Cloudflare staging Worker deployment requires authenticated Cloudflare access; no usable deployment credential is available here. Never reuse previously pasted token; rotate it if still active.
2. Staging Supabase URL/keys and dedicated staging database must be configured privately in Cloudflare; production schema has not been modified.
3. Apply staged SQL only to staging, then run end-to-end integration tests for auth, tenant membership, vehicle/device access, location, alerts, protocol adapters, CORS and credential revocation.
4. Inspect protected Cloudflare Git-build logs in the account dashboard to diagnose the existing services' build failures.
5. Realtime fan-out, admin console, push notifications and raw-TCP gateway are still not delivered; the Worker currently uses polling for mobile live location.
6. After staging acceptance: security review, test both mobile platforms against staging, controlled cutover plan, rollback test, and signed release APK/AAB.

## Guardrails
- No production DB migration or Cloudflare deployment performed.
- Production Flutter API default remains unchanged.
- PR #46 stays draft until staging verification and review.
- Debug APKs are not release-signed.

## Added staging deployment automation (2026-11-26 continuation)
- Manual Cloudflare Worker API staging deployment workflow: `.github/workflows/cloudflare-api-worker-staging.yml`. Requires explicit confirmation and Cloudflare secrets; runs tests and Wrangler dry-run before deployment.
- Manual static dashboard Pages staging workflow: `.github/workflows/cloudflare-static-dashboard-staging.yml`. Copies only `index.html`, `app.js`, `styles.css` to a clean static output directory and deploys to a separate Pages project `darb-gps-web-staging` on preview branch `staging`.
- Updated Cloudflare guide to describe Free Workers/Pages migration as the target; legacy NestJS Container requires paid plan and remains separate.
- Worker validation on commit `0b151531` passed (55 tests + Wrangler dry-run). Subsequent code adds authenticated API throttling and one test; the current test suite has 56 tests and CI is being rechecked on the current head.
- Neither staging workflow has been run; Cloudflare credentials are not connected in this session. Production remains unchanged.

## Web dashboard compatibility work
- Static dashboard now accepts the Worker vehicle-list envelope `{data:[...]}`, unwraps trip/stop/device envelopes, and uses REST latest-location polling (60-second cadence) for the free Worker instead of repeatedly attempting Socket.IO. This cadence is intended to keep Free-plan request usage bounded; tune it in staging based on fleet size and usage.
- JavaScript syntax and Pages asset-bundle validation are now part of the static dashboard CI workflow.
