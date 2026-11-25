# DARB GPS Cloudflare deployment checklist (staging only)

**Do not deploy this Worker as the production API yet.** PR #46 is a draft and the required Supabase migrations are staged, not applied.

## Worker project
- Worker name: `darb-gps-free-api`
- Wrangler file: `cloudflare/api-worker/wrangler.toml`
- Expected workers.dev host after deployment: `https://darb-gps-free-api.<account-subdomain>.workers.dev` (confirm Cloudflare-assigned host in dashboard)
- Repository root: `cloudflare/api-worker`
- Local/CI validation: `npm test` and `npm run check` (Wrangler dry-run)

## Required Cloudflare environment
Configure these only under the Worker Settings → Variables and Secrets (or the Git integration's environment settings):
- `SUPABASE_URL` — Supabase project URL (non-secret variable)
- `SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key (public key, but configure as Worker variable)
- `SUPABASE_SERVICE_ROLE_KEY` — **secret**, only needed for hardware tracker ingest/service-RPC operations. Never place it in Git, Flutter, or browser settings.
- `ALLOWED_ORIGINS` — comma-separated allow-list. Current config lists GitHub Pages and the Cloudflare web Worker host; review and add the actual production/staging web origins.

## Git-connected deployment (after approval)
1. Cloudflare Dashboard → Workers & Pages → Create Worker → Connect to Git.
2. Select `tadjojo/Darb-gps`; configure root directory `cloudflare/api-worker`.
3. Ensure `wrangler.toml` is used and `workers_dev` is enabled for staging.
4. Set build/test command to `npm install && npm test && npm run check` and deployment command to `npm run deploy` (confirm Cloudflare's current build UI accepts these fields).
5. Add required environment variables/secrets in Cloudflare dashboard. Do not add secret values to repository files or chat.
6. Deploy to a staging Worker name first; verify health/live and health/ready, then run authenticated tests. Readiness is configuration-only, not a database connectivity test.
7. Do not change Flutter's default API URL until the staging integration and migration plan are approved.

## Database and cutover safety
- SQL files under `supabase/migrations` on PR #46 have not been applied to the live project.
- Apply migrations to a dedicated staging database, verify permissions/RLS and rollback, then decide production migration separately.
- Raw TCP GPS devices cannot connect directly to Workers fetch; the GT06/NMEA adapters require HTTPS gateway input.
- Production Render endpoint remains the current baseline during this draft. The migration goal is Cloudflare; the CI smoke test still checks legacy API and is not Cloudflare deployment evidence.
