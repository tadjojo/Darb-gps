# DARB GPS API migration matrix

The Worker is a prototype branch; this list maps the mobile API contract and migration order. The production API is not replaced.

## Stage 0 — Worker foundation (implemented)

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready` (configuration check only)
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

CI validates Node tests and Wrangler bundle.

## Stage 1 — Organizations and vehicles (prototype routes implemented; SQL migration staged)

- `GET /api/v1/organizations` — list active organizations for the authenticated user (new RPC)
- `POST /api/v1/organizations`
- `POST /api/v1/organizations/:organizationId/vehicles`
- `GET /api/v1/organizations/:organizationId/vehicles`
- `GET /api/v1/organizations/:organizationId/locations/latest` (bounded pagination: `limit` 1–500, `offset` 0–1,000,000; default 250)
- `POST /api/v1/vehicles/:vehicleId/members`
- `DELETE /api/v1/vehicles/:vehicleId/members/:memberUserId`

Prototype routes now exist for create organization, create vehicle, list vehicles, paginated batch latest locations, add vehicle member, and revoke vehicle member using transaction-safe RPC functions. The batch latest-location RPC checks active organization membership and returns location rows only for vehicles where the caller has active membership. RPC SQL was syntax-tested against the live project in a transaction that was rolled back. Migration is staged only and not applied. Remaining: review/apply RPC migration and add real API/Flutter integration tests. Schema and role rules were verified read-only against the connected project.

## Stage 2 — Mobile tracking and history (prototype routes implemented; SQL migrations staged)

- `POST /api/v1/tracking/devices/enroll-mobile`
- `GET /api/v1/tracking/devices/vehicle/:vehicleId`
- `POST /api/v1/tracking/locations`
- `GET /api/v1/tracking/vehicles/:vehicleId/latest`
- `GET /api/v1/tracking/vehicles/:vehicleId/history`
- `GET /api/v1/tracking/vehicles/:vehicleId/trips`
- `GET /api/v1/tracking/vehicles/:vehicleId/trip-route`
- `GET /api/v1/tracking/vehicles/:vehicleId/stops`

Prototype routes now exist for mobile enrollment, device listing, location ingestion, latest location, history, trips, trip route, and stop detection. The location-history RPC and mobile RPCs were tested under simulated authenticated role in rollback-only transactions. Remaining: alerts evaluation and realtime fan-out; location ingestion is not yet wired to Socket.IO/realtime. Migrations are staged, not applied.

## Stage 3 — Hardware tracking device administration and HTTPS protocol adapters (prototype routes implemented; SQL migration staged)

- GPS device enrollment, credential rotation, revocation, and device list.
- Protocol profiles: JSON, GT06, NMEA; IMEI validation and time-zone handling.
- Hardware credentials are stored hashed and in private schema. Never expose private credential hashes or secrets in API output.

Prototype routes now include GPS tracker enrollment with one-time random credential, rotation/revocation, credential-hash JSON ingestion, GT06 heartbeat, and HTTPS adapters for GT06 frames and NMEA sentences. SQL functions were rollback-tested. Raw TCP receiving still needs a separate gateway, and these migrations have not been applied.

## Stage 4 — Alerts and rules (prototype routes and evaluation implemented; SQL migration staged)

- List alerts with status/vehicle filters.
- Acknowledge and resolve alerts.
- List and create speed-limit and geofence rules.
- Device-offline alerts and tamper events.

Alert APIs are implemented for listing, acknowledging, resolving, listing rules, and creating speed/geofence rules. SQL functions now evaluate speed-limit crossings, geofence entry/exit, tamper, and offline-device recovery. Runtime tests were performed in rollback-only transactions. Remaining: real integration testing and notification/realtime delivery.

## Stage 5 — Realtime, admin, and release

- Realtime latest-location updates with access control.
- Admin console/backend routes and audit logging.
- Cross-platform Flutter tests, API integration tests, staging deployment, rollback plan, and security review.

## Worker security baseline (implemented)

- Strict CORS allowlist and browser-origin handling.
- Restrictive CSP, no-referrer, nosniff, anti-frame, and no-store response headers.
- Request payload cap of 64 KiB enforced from declared length and streamed body bytes; oversized requests return HTTP 413.
- Tests cover security headers, oversized requests, and rate-limiter rejection/fail-closed behavior.
- Auth login/refresh: 20/min per IP; authenticated API: 300/min per bearer-token hash; tracker ingest/heartbeat: 120/min per credential hash. Cloudflare limits are approximate per location; production tuning is required.
- Hardware credentials are not returned after enrollment and private hashes are not exposed.

## Migration safety gate

Do not change the Flutter default API base URL or replace production until every endpoint the released app uses is migrated and validated against the actual Supabase project/schema. Use a staging Worker and preserve the existing production API for rollback.
