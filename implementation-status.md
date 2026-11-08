# DARB GPS — implementation status (2026-11-05)

## Implemented in this alpha source tree

- NestJS API foundation, environment validation, PostgreSQL pool and PostGIS schema.
- JWT login/refresh flow and guarded HTTP endpoints.
- Organization creation and organization membership bootstrap for the creator.
- Vehicle creation/listing and vehicle member assignment with organization/vehicle role checks.
- Mobile device enrollment/revocation and idempotent location ingestion.
- Latest-location pointer and transactional outbox write.
- Outbox lease publisher to Redis Streams.
- Redis consumer group with unique consumer names, pending-message reclaim and dedicated Redis connection.
- Socket.IO `/tracking` namespace; JWT verification, active-account check and vehicle-room membership check.
- REST latest-location endpoint for reconnect reconciliation.

## Delivery semantics

The Redis stream consumer is at-least-once. It emits to the Socket.IO server and then acknowledges the stream entry. If the process stops after emit but before acknowledgement, a duplicate emission is possible. Socket.IO does not prove delivery to any particular client. Client applications must deduplicate using `outboxId`/`eventId` and fetch the REST latest location after reconnect.

## Important limitations before production

- No public user signup, MFA, email/phone verification or password reset.
- Access-token deny-list and connected-socket revocation fanout are implemented; distributed runtime behavior remains unverified.
- Independent GPS tracker HTTPS authentication and NMEA RMC / GT06 0x12 / normalized JSON adapters are implemented; other vendor variants and raw TCP/UDP/MQTT listeners remain unsupported.
- Flutter source is included and integrated with the NestJS API, but no Flutter/Dart analyzer or Android/iOS release build has been run in this environment.
- No rate limiting, audit event pipeline, retention/partition jobs, metrics, tracing or backup automation.
- Integration test suites are now present for PostGIS schema and Redis per-replica consumer groups, but have not been run without live services. A full dependency-backed TypeScript build has not been run in this environment.

## Validation performed for this package revision

- Parsed every TypeScript source file with the installed TypeScript transpiler (syntax diagnostics only).
- Parsed `package.json` as JSON.
- ZIP integrity checked after packaging.

These checks do not replace `npm install`, `npm run build`, database migrations, automated tests, load tests or device testing.

## Phase 5460 — distributed revocation

- Added PostgreSQL `LISTEN/NOTIFY` fanout for access-token logout and vehicle-membership revocation.
- Added vehicle-member revocation endpoint with owner/manager authorization boundaries.
- Added per-instance periodic socket authorization audit (30 seconds) to recover missed notifications and account/membership changes.
- Added periodic cleanup for expired access-token deny-list rows and old refresh sessions (90-day retention).
- See `docs/phase-5460.md` for assumptions and acceptance tests. Runtime multi-instance behavior remains unverified.

## Phase 5461 — realtime fan-out across API replicas

- Replaced the single shared Socket.IO stream consumer group with one stable consumer group per API replica.
- New groups start at the current stream tail (`$`); reconnecting clients must fetch REST latest-location as the initial state snapshot.
- Production requires a unique, stable `INSTANCE_ID` per replica; see `docs/phase-5461.md` for migration and acceptance guidance.
- Redis multi-replica runtime tests remain outstanding.


## Phases 5462–5464 — tests, replica deployment and independent trackers

- Added Jest unit tests for NMEA RMC, GT06 location frames and normalized JSON payloads.
- Added opt-in PostGIS schema and Redis two-consumer-group integration tests.
- Added a two-replica Docker Compose profile with distinct `INSTANCE_ID` values and an Nginx WebSocket reverse proxy. PostgreSQL and Redis in this sample profile are still single instances.
- Added one-time GPS tracker credential provisioning, SHA-256 credential storage and HTTPS ingestion into the common transactional location/outbox pipeline.
- Mobile Flutter source and its existing mobile endpoints were preserved.
- No runtime tests, Docker deployment, or physical tracker compatibility has been verified in this environment.
