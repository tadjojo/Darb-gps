# Integration status — DARB GPS Mobile Alpha

## Implemented in source
- Flutter client paths match the NestJS alpha: `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`, `/api/v1/organizations`, `/api/v1/organizations/:id/vehicles`, `/api/v1/tracking/devices/enroll-mobile`, `/api/v1/tracking/mobile/location`, and `/api/v1/tracking/vehicles/:id/latest`.
- JWT and rotating refresh-token storage uses `flutter_secure_storage`.
- Mobile device enrollment stores the returned device UUID.
- Each location payload contains eventId, deviceId, vehicleId, latitude, longitude, accuracyMeters, recordedAt, source, and optional speedKmh/heading.
- A SQLite outbox stores the exact JSON payload before sending. Retry does not generate a new eventId.
- Queue synchronization is serialized, retries the oldest pending event first, and is attempted on a timer and after new GPS fixes.
- Socket.IO authenticates through `auth.token`, joins `vehicle.join`, consumes `vehicle.location.updated`, deduplicates events, and fetches latest REST location on reconnect.
- UI includes explicit user-controlled start/stop and Arabic/English labels.

## Validation performed in this environment
- Source and archive integrity checks are performed before packaging.
- NestJS source is carried forward from the separately verified v3 backend alpha.
- Flutter/Dart SDK is not installed in this environment; `flutter pub get`, Dart analyzer, Android build and iOS build could not be run.
- No connected PostgreSQL/Redis runtime was available for end-to-end API/socket testing.
- Therefore this is an integrated source alpha, not a compiled or field-tested mobile app.

## Phases 5462–5464 update

Added protocol adapter unit tests, opt-in PostGIS/Redis integration tests, a two-API-instance Compose profile with Nginx WebSocket proxying, and an independent GPS tracker HTTPS gateway. Tracker enrollment returns a one-time 256-bit bearer credential; server stores only a SHA-256 hash. Supported payloads: NMEA RMC, GT06 location packet 0x12, and normalized JSON. Flutter mobile sources and endpoints are preserved.

Runtime integration tests, Docker multi-instance startup, and real tracker packet compatibility are NOT verified in this environment. GT06 support must be confirmed against each device model and captured packets. TCP/UDP/MQTT listeners and vendor-specific protocol extensions remain future work.

## Phases 5465–5467 (source added; runtime pending)
- Added independent tracker simulator for JSON/NMEA and supplied GT06 hex frames, including duplicate replay, retry loop and simulated first-send loss.
- Added device registry migration and authenticated list/update metadata endpoints, including IMEI uniqueness and battery/signal fields.
- Existing Flutter app source was not modified.
- These additions are syntax-checked only; live database/API/network and hardware integration remain pending.
- Phase 5468: normalized JSON tracker telemetry (battery, RSSI, network type) is validated and persisted transactionally; NMEA/GT06 telemetry still requires protocol-specific packet support.

## Phase 5468 — Optional NMEA TCP ingress
An optional authenticated line-oriented NMEA TCP listener was added. It is disabled unless `TRACKER_TCP_PORT` is configured and routes each RMC sentence through the existing credential verification, protocol parser, deduplication, and transactional location pipeline. It uses a DARB-specific `AUTH <token>` preamble; generic commercial tracker compatibility is not implied. See `docs/phase-5468-tcp-nmea.md`.


## Phase 13 update (2026-11-06)

Mobile GPS stream recovery and fix validation have been added at source level. Retry backoff: 2/4/8/16/32/60 seconds. User stop invalidates the tracking generation and cancels retry. This is not process-death recovery. Flutter analyze/build and device tests remain outstanding because Flutter/Dart tooling is unavailable in the current environment.
