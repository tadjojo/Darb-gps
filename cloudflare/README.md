# DARB GPS on Cloudflare

## Target deployment

- Dashboard: Cloudflare Worker `darb-gps-web-2026` at https://darb-gps-web-2026.tadjojo.workers.dev/
- HTTP API: Cloudflare Worker + Cloudflare Container `darb-gps-new` at https://darb-gps-new.tadjojo.workers.dev/
- PostgreSQL and authentication: Supabase.
- API runtime: the existing NestJS application and `api/Dockerfile`, built and run as a Cloudflare Container. No Render API proxy is used.
- Device gateway: raw GT06/NMEA TCP is a separate deployment concern. Cloudflare Spectrum Worker-origin TCP requires a custom zone and an eligible paid plan; workers.dev alone is not a public raw-TCP listener.

## Cost requirement

Cloudflare Containers are not included in the Free plan. Running the NestJS API container requires the Workers Paid plan (minimum USD $5/month) plus any usage above the included allowances. The dashboard-only static Worker can remain on the Free plan. Do not enable the API Container if a paid plan is not acceptable.

## Cloudflare Workers Builds settings for darb-gps-new

Open Workers & Pages:
https://dash.cloudflare.com/2e1e8539dff6ddbc2308ef63cbefd3ad/workers-and-pages

Connect `tadjojo/Darb-gps`, branch `main`, and set:

1. Root directory: repository root (leave blank or use `/`). The Docker build context is `api/`, so do not set the root directory to `api` or `cloudflare/api-worker`.
2. Build command: `npm install --prefix cloudflare/api-worker`
3. Deploy command: `npx wrangler deploy --config cloudflare/api-worker/wrangler.toml`
4. Build output directory: leave blank.
5. Confirm Worker name `darb-gps-new`.

The Wrangler configuration builds `api/Dockerfile` with `api/` as its Docker build context, then routes API requests to the container on port 3000. This is a Cloudflare Containers deployment, not a static Pages build.

## Required Cloudflare secrets

Before the API can pass readiness checks, add these Worker secrets in the `darb-gps-new` settings:

- `DATABASE_URL`: Supabase PostgreSQL connection string (use the direct or pooler endpoint supported by your Supabase project).
- `DATABASE_CA_CERT`: full PEM text of the Supabase CA certificate used by the database endpoint.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY`: Supabase publishable/anon key.

Do not place secrets in Git or send them in chat. Optional non-secret variables are already defaulted by the Worker: `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, and `DB_CONNECTION_TIMEOUT_MS`.

## Verification

After the first successful Cloudflare build and container rollout, open:

- https://darb-gps-new.tadjojo.workers.dev/api/v1/health/live
- https://darb-gps-new.tadjojo.workers.dev/api/v1/health/ready

The first request can return HTTP 503 while the container starts. Retry after a short wait. The ready endpoint must report the database as connected before testing login, organizations, vehicles, tracking, alerts, and realtime Socket.IO.

The web dashboard already defaults to:
`https://darb-gps-new.tadjojo.workers.dev/api/v1`

## GPS tracker TCP gateway

The GT06/NMEA gateway is not an HTTP Worker. Cloudflare's inbound TCP-to-Worker feature is currently a public beta and requires a Cloudflare Spectrum application on an eligible custom domain/zone and plan. The standard `*.workers.dev` hostname is not enough to expose arbitrary tracker TCP ports. Do not point trackers at the HTTP API URL.

## Security

- Never commit Cloudflare API tokens, Supabase service-role keys, database passwords, CA private keys, or tracker bearer tokens.
- Configure credentials as Cloudflare Worker secrets.
- Keep the old service available only until Cloudflare health, authentication, database, realtime, and device ingestion tests pass; then retire it deliberately.
