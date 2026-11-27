# DARB GPS Cloudflare deployment checklist (staging only)

**Do not deploy this Worker as the production API yet.** PR #46 is a draft and the required Supabase migrations are staged, not applied.

## Worker project
- Worker name: `darb-gps-free-api-staging`
- Wrangler file: `cloudflare/api-worker/wrangler.toml`
- Expected workers.dev host: `https://darb-gps-free-api-staging.<account-subdomain>.workers.dev` (confirm after staging deployment)
- Worker root: `cloudflare/api-worker`
- Validation: `npm test` and `npm run check`

## Staging deploy via GitHub Actions (recommended)
A manually gated workflow was added: `.github/workflows/cloudflare-api-worker-staging.yml`.
1. Open repository Settings → Secrets and variables → Actions; add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Never paste these into chat or commit them.
2. Create a Cloudflare API token scoped only to the target account with Workers Scripts **Edit** and Account Settings **Read** permissions (avoid broad account/global tokens).
3. GitHub Actions → Deploy DARB GPS API to Cloudflare Staging → Run workflow. Leave confirmation unchecked to abort; check it only when intending a staging deploy.
4. Workflow runs tests and Wrangler dry-run first, then deploys `darb-gps-free-api-staging`. It does not deploy the production app/API or change the Flutter API base URL.
5. The workflow smoke-tests `/api/v1/health/live` and `/api/v1/health/ready`; readiness confirms configuration is present, but does not prove Supabase connectivity.

The workflow requires secrets and will fail closed if either is missing. Configure an environment protection rule for `cloudflare-staging` if approval-before-deploy is desired.

## Required Worker variables/secrets
Configure in Cloudflare staging Worker settings:
- `SUPABASE_URL` — Supabase project URL (non-secret variable)
- `SUPABASE_PUBLISHABLE_KEY` — publishable key
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, only for server-side hardware tracker RPC operations
- `ALLOWED_ORIGINS` — comma-separated explicit origin allow-list. Wrangler config includes `https://staging.darb-gps-web-staging.pages.dev`; verify that the actual preview origin matches.

## Database and cutover safety
- SQL files under `supabase/migrations` are staged only; do not apply to production.
- Apply migrations to a dedicated staging Supabase project, verify permissions/tenant isolation and rollback.
- Raw TCP GPS devices cannot connect directly to Workers Fetch; GT06/NMEA adapters currently accept HTTPS requests from a gateway.
- The production API endpoint remains unchanged; the CI smoke workflow tests the legacy API only and is not evidence of Cloudflare deployment.
