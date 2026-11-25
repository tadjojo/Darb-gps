# DARB GPS on Cloudflare

## Current migration stage

- The static dashboard is served by the Cloudflare Worker `darb-gps-web-2026` at `https://darb-gps-web-2026.tadjojo.workers.dev/`.
- `cloudflare/api-worker` adds a Cloudflare Workers edge endpoint that forwards `/api/v1/*` requests to the existing Render API.
- Supabase remains the system of record for PostgreSQL and authentication.
- The GT06/NMEA TCP device gateway is not moved to Workers: GPS trackers require publicly reachable TCP listeners, which a normal Workers HTTP Worker does not provide.

## Deploy the API edge Worker from the Cloudflare dashboard

1. Open Workers & Pages: https://dash.cloudflare.com/?to=/:account/workers-and-pages
2. Choose **Create application** > **Workers** > **Import a repository**.
3. Select `tadjojo/Darb-gps`, branch `main`.
4. **Root directory: `cloudflare/api-worker`** (this is critical; do not use repository root or `api`).
5. In build settings, set **Build command** to `npm install` (or leave it blank if Cloudflare offers an install-only default).
6. Set **Deploy command** to `npx wrangler deploy`.
7. If there is a separate **Build output directory**, leave it blank; this is a Worker deployment, not a static Pages build.
8. Confirm the Worker name is `darb-gps-new` and deploy.

**Do not use `npm run build`, `nest build`, or `api` as the root directory for this Worker.** Those settings try to build the NestJS API and cause unrelated TypeScript errors. Worker source is in `cloudflare/api-worker/src/index.mjs`.

Test after deployment:
- `https://darb-gps-new.tadjojo.workers.dev/api/v1/health/live`
- `https://darb-gps-new.tadjojo.workers.dev/api/v1/health/ready`

Do not change the dashboard's API base URL until both health checks pass and authenticated smoke tests pass through the Worker.

## Next stages

1. Deploy and verify this edge Worker.
2. Update the dashboard API base to the Worker URL and test login, organizations, vehicles, tracking, alerts, and CORS.
3. Move eligible HTTP API routes to native Workers gradually. The current NestJS/Express application cannot be copied to Workers unchanged.
4. Deploy the TCP tracker gateway on a separate TCP-capable host; keep it independent from the HTTP API.
5. Create a Cloudflare Pages project for the dashboard and verify it before changing or removing GitHub Pages/Render.
6. Retire Oracle only after all required functions have a verified replacement.

## Security

- Never commit Cloudflare API tokens, Supabase service-role keys, database passwords, or tracker bearer tokens.
- Configure secrets in Cloudflare/GitHub's secret manager, not in source files.
- Keep the old API and gateway online until cutover tests pass.
