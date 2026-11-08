# Phase 24 — Repeatable backend deployment runner

## Change

- Added a dedicated `migrate` Compose service that builds the Dockerfile's dependency-rich `build` stage. This avoids trying to execute `node-pg-migrate` from the production runtime image, where development dependencies are intentionally omitted.
- Added `backend/scripts/deploy-multi-instance.sh` to validate required non-placeholder secrets, start PostGIS and Redis, apply migrations once, and start two API replicas plus the Nginx load balancer.
- Updated backend deployment instructions to use the script and documented that the sample profile still has single-instance PostgreSQL and Redis.

## Run on a Docker host

```bash
cd backend
cp .env.example .env
# Edit .env: POSTGRES_PASSWORD >= 24 chars; JWT_ACCESS_SECRET >= 32 chars.
./scripts/deploy-multi-instance.sh
```

Readiness check: `http://127.0.0.1:8080/api/v1/health/ready`.

## Safety and limitations

- The script never prints the configured secret values.
- The sample binds application ports to loopback; configure a TLS reverse proxy and production CORS allowlist before public exposure.
- The example is a deployment starter, not production high availability: PostGIS and Redis are single instances; backups, restore drills, TLS, monitoring, rate limiting, audit pipeline, retention, and load testing remain required.
- Docker was unavailable in the authoring environment, so the Compose deployment was source-reviewed but not executed here.
