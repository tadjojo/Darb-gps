# DARB GPS — Cloudflare Free staging architecture

## Current migration target (free plan prototype)
- **Dashboard:** static HTML/CSS/JS; a manually gated GitHub Actions workflow can deploy a separate staging preview to Cloudflare Pages project `darb-gps-web-staging`.
- **API:** `cloudflare/api-worker` Cloudflare Worker, intended as `darb-gps-free-api` on workers.dev. Manual GitHub Actions deployment workflow validates tests and Wrangler dry-run first.
- **Database/Auth:** Supabase. SQL migrations/RPCs are staged in the migration PR and must be applied to a separate staging Supabase project before end-to-end validation.
- **Production safety:** The existing API endpoint remains the app default. No Cloudflare staging deploy or production migration has been performed; keep the PR draft and don't switch API defaults until acceptance.

## Staging deployment workflows
- API Worker: `.github/workflows/cloudflare-api-worker-staging.yml`
- Static dashboard Pages: `.github/workflows/cloudflare-static-dashboard-staging.yml`
- Staging checklist: `cloudflare/api-worker/DEPLOY_STAGING_CHECKLIST.md`
- Static dashboard instructions: `cloudflare/STATIC_DASHBOARD_STAGING.md`

Both workflows are manual, require the explicit confirmation input, and use a separate staging target. Configure GitHub Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; use least-privilege Cloudflare tokens. Never commit or paste secrets. The token should include Workers Scripts Edit + Account Settings Read for API Worker deploy, and Pages Edit + Account Settings Read for Pages deployment if using one shared token.

## Worker Free limits and monitoring
Cloudflare Workers Free includes a daily request limit (currently 100,000/day), CPU time limit (10 ms/request), and 128 MB memory. Rate limiting bindings are approximate per Cloudflare location; auth and tracker throttles need real staging traffic validation and tuning. See:
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

## API prototype capabilities
The Worker implements Supabase Auth proxy, organizations/vehicles/members, mobile GPS, hardware GPS credential lifecycle and HTTPS adapters, history/trips/stops, alerts/rules, security headers, body-size limits and rate-limit bindings. The migration matrix lists supported and remaining endpoints.

## Not available in this free Worker API yet
- Raw tracker TCP ingress (GT06/NMEA): HTTPS adapters only; raw TCP needs a separate gateway/eligible service.
- Socket.IO realtime fanout, admin console, push notifications, and complete release integration.
- Staging database migration and end-to-end deployment verification.

## Legacy Cloudflare Container setup (not the free migration target)
The existing `darb-gps-new` service is the legacy NestJS API/container path. Cloudflare Containers are not included in the Workers Free plan and require Workers Paid. Existing Git-connected build failures are not evidence of a successful deployment; inspect account-protected build logs before deciding whether to repair or retire that service. Do not use the paid Container workflow as the free staging target.

## Security
- Keep service-role and database credentials in Cloudflare secret settings only.
- Keep tracker credentials hashed server-side and never expose them to browser/mobile client logs.
- Maintain the existing production API until staging integration, security review, mobile testing and rollback checks are complete.
