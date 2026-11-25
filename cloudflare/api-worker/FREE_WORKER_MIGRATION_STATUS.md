# Free-plan API migration prototype (not production)

This branch, `cloudflare-free-api-migration`, replaces the Container runtime with a Worker-native scaffold intended to fit Cloudflare Workers Free.

## Status
- Health endpoints: implemented (live/ready currently indicate Worker availability only; they do not check database health).
- Supabase Auth login and refresh proxy: implemented.
- Logout endpoint: scaffolded.
- CORS allow-list: configured.
- Unit tests: health, CORS denial, and explicit 501 response for unported routes.
- Organizations, vehicles, tracking, alerts, realtime, admin, and device protocols: NOT ported. Routes currently return 501.
- Supabase project values in wrangler.toml are placeholders and must be set before deployment.
- Do not deploy this branch as a replacement for the existing service; it is a migration test branch.

## Test
From `cloudflare/api-worker`:
`npm test`

## Deploy only after configuration and full API port
Configure Supabase URL and publishable key via Wrangler environment variables/secrets, review the Worker, and run the smoke tests. Existing Cloudflare production Worker remains unchanged.
