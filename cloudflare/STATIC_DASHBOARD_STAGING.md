# DARB GPS static dashboard — Cloudflare Pages staging

This workflow deploys only the static demo dashboard to a separate Cloudflare Pages project named `darb-gps-web-staging`. It does not deploy the NestJS container/API and does not change the production API endpoint.

## Workflow
`.github/workflows/cloudflare-static-dashboard-staging.yml`
1. Prepare only `index.html`, `app.js`, `styles.css`, and `dashboard-help.html` in a clean `dist-web` directory.
2. Check the required files.
3. Deploy to a separate Pages staging project via Wrangler Pages.

## Secrets
Use GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Token scope should be restricted to the target Cloudflare account with Pages edit permissions plus Account Settings read. If the same token is also used for Worker deployment, add Workers Scripts edit permissions; do not use a global API key.

## Staging-only gate
Run from GitHub Actions → Deploy DARB GPS static dashboard to Cloudflare Pages (staging). The confirmation input must be checked. If the Pages project does not exist, the workflow creates it with `main` as its production branch, then deploys the `staging` branch preview.

## Demo caveat
This is a static dashboard demo and defaults to the legacy API URL. Use Settings in the dashboard to set the staging API base URL after the API Worker has deployed and been tested. When the selected host is `darb-gps-free-api`, the web dashboard uses the organization batch latest-location RPC (one API request for the fleet) and polls every 60 seconds instead of Socket.IO (not implemented in the Worker). It unwraps Worker list responses and falls back to per-vehicle latest calls if the staged batch RPC is unavailable. Do not change the production default until staging validation is complete.
