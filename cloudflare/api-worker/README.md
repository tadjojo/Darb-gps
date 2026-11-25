# DARB GPS Free Cloudflare Worker API (prototype)

This Worker is an incremental migration target for the DARB GPS API. **It is not a production replacement yet.** Keep the existing API endpoint unchanged until all required endpoints, security review, database migrations, and mobile integration tests pass.

## Implemented routes

| Route | Method | Status |
|---|---|---|
| `/api/v1/health/live` | GET | Worker liveness |
| `/api/v1/health/ready` | GET | Config presence only (does not verify DB) |
| `/api/v1/auth/login` | POST | Supabase Auth password login proxy |
| `/api/v1/auth/refresh` | POST | Supabase Auth refresh proxy |
| `/api/v1/auth/logout` | POST | Local session sign-out using bearer token |
| `/api/v1/auth/me` | GET | Bearer validation and minimal user profile |

Routes for alerts, raw TCP reception, Socket.IO realtime, device membership, and admin remain unported and return HTTP 501.

## Required Cloudflare settings

Configure these in Worker Settings, not in source control:

- `SUPABASE_URL`: project HTTPS URL
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable/anon key (not a service-role secret)
- `SUPABASE_SERVICE_ROLE_KEY`: **required only for GPS hardware credential-based ingestion/protocol adapters**. Keep as a Cloudflare secret; it is never returned to clients. This key grants elevated database/API access.
- `ALLOWED_ORIGINS`: comma-separated approved browser origins; mobile clients without Origin are supported

Auth and user API routes use the caller's JWT. Hardware tracker ingestion currently uses the service-role key in server-side Worker RPC calls; do not use this key in the Flutter app or web client.

## Local checks

```bash
npm install
npm test
npm run check
npm run dev
```

## Deploy only after migration review

Once all required routes and integration tests are ready, authenticate Wrangler with a Cloudflare account and deploy:

```bash
npx wrangler login
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY\nnpx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler deploy
```

Set `SUPABASE_URL` and `ALLOWED_ORIGINS` through Worker vars in Cloudflare Dashboard or Wrangler before deploy. Confirm the worker name and URL from Cloudflare after deployment. This guide is not an instruction to replace the current production API now.

## Migration safety requirements

- Organization and vehicle writes must use transactional Postgres RPCs or equivalent transactions; do not chain independent REST inserts for multi-table writes.
- Enforce caller identity and roles from the verified Supabase JWT; never accept user IDs as trusted identity from request payloads.
- Private schema tracker credentials, alert rules, and alert rows must remain inaccessible to public/anon/authenticated direct table access unless narrowly reviewed RPCs are provided.
- Validate every location payload and enforce vehicle membership before writing.
- Hardware protocols such as GT06/NMEA TCP require a separate receiver architecture; a normal HTTP Worker cannot accept raw TCP sessions.
- Realtime/trip/stops features need compatible service logic and tests before marking them migrated.
