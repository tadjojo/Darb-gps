# DARB GPS Free Cloudflare Worker API (prototype)

Incremental migration target for DARB GPS. **Not a production replacement.** Keep the current API endpoint unchanged until migrations, configuration, security review, and Flutter integration tests are complete.

## Implemented Worker routes (prototype)

| Route | Method | Purpose |
|---|---|---|
| `/api/v1/health/live` | GET | Worker liveness |
| `/api/v1/health/ready` | GET | Configuration presence only; no database check |
| `/api/v1/auth/login` | POST | Supabase Auth login proxy |
| `/api/v1/auth/refresh` | POST | Token refresh |
| `/api/v1/auth/logout` | POST | Local sign-out |
| `/api/v1/auth/me` | GET | Bearer validation and minimal user profile |
| `/api/v1/organizations` | POST | Create organization via transaction RPC |
| `/api/v1/organizations/:id/vehicles` | GET/POST | List/create vehicles via scoped RPCs |
| `/api/v1/tracking/devices/enroll-mobile` | POST | Mobile device enrollment |
| `/api/v1/tracking/devices/vehicle/:id` | GET | List mobile and GPS hardware devices |
| `/api/v1/tracking/locations` | POST | Mobile location ingestion |
| `/api/v1/tracking/vehicles/:id/latest` | GET | Latest location |
| `/api/v1/tracking/vehicles/:id/history` | GET | Bounded location history |
| `/api/v1/tracking/vehicles/:id/trips` | GET | Trip segmentation |
| `/api/v1/tracking/vehicles/:id/trip-route` | GET | Ordered route points |
| `/api/v1/tracking/vehicles/:id/stops` | GET | Stop detection |
| `/api/v1/tracking/devices/gps` | POST | Hardware device enrollment |
| `/api/v1/tracking/devices/gps/:id/rotate-credential` | POST | Rotate hardware credential |
| `/api/v1/tracking/devices/gps/:id/revoke` | POST | Revoke tracker credential |
| `/api/v1/device-gateway/ingest` | POST | JSON tracker telemetry |
| `/api/v1/device-gateway/heartbeat/gt06` | POST | GT06 heartbeat |
| `/api/v1/device-gateway/ingest/nmea` | POST | NMEA HTTPS adapter |
| `/api/v1/device-gateway/ingest/gt06` | POST | GT06 HTTPS adapter |

Unported: vehicle membership add/remove, alert rules/evaluation and API, Socket.IO realtime, admin, and raw TCP device reception. Unported routes explicitly return HTTP 501.

## Required Cloudflare variables/secrets

Configure in Worker Settings, not source control:

- `SUPABASE_URL`: project HTTPS URL
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable/anon API key
- `ALLOWED_ORIGINS`: approved browser origins (mobile requests without Origin are supported)
- `SUPABASE_SERVICE_ROLE_KEY`: Cloudflare **secret**, needed only for GPS hardware credential-based ingestion and protocol adapters. It grants elevated access; never expose to Flutter, browser code, or logs.

User-facing API routes use the caller's Supabase JWT. Tracker credential routes hash the device credential in the Worker and call restricted service-role RPCs. Only hashes are stored.

## Local checks

```bash
npm install
npm test
npm run check
npm run dev
```

CI currently validates Node tests and Wrangler bundling/dry-run.

## Deployment (do not replace production yet)

After reviewed migrations are applied to a staging Supabase project and integration tests pass:

```bash
npx wrangler login
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `ALLOWED_ORIGINS` through the Cloudflare dashboard or Wrangler. Do not deploy this prototype as a replacement until the migration gate is met.

## Migration safety

- Multi-table writes use transactional Postgres RPCs.
- User identity is derived from `auth.uid()`; do not trust client-provided user IDs.
- Private tracker/alert tables remain inaccessible through direct anon/authenticated REST grants.
- Hardware credentials are generated randomly, shown once, and stored hashed.
- The HTTPS GT06/NMEA adapters do not accept raw TCP; the legacy raw TCP receiver needs a separate gateway.
- Realtime/alerts are not yet ported; location ingestion does not fan out Socket.IO events or evaluate alert rules.
