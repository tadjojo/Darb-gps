# Phase 23 — Independent GPS device operations and gateway verification

## Scope added

- Added focused unit coverage for the independent tracker gateway service: bearer credential requirement, payload size guard, credential hashing, normalized location persistence, telemetry update, outbox publication, duplicate replay, and rejected/revoked credentials.
- Extended `backend/scripts/simulate-tracker.mjs` with `--repeat` and `--interval-ms` to exercise a sequence of location reports. Each JSON/NMEA event gets a fresh UTC timestamp; `--duplicate true` replays each exact payload to check idempotency.
- Preserved the three protocol adapters and single normalized transactional ingestion path: NMEA 0183 RMC, GT06 location packet 0x12, and normalized JSON.
- Documented the operational enrollment/revocation flow and the secure transport boundary for the optional TCP bridge.

## Device onboarding and operations

1. An authenticated vehicle owner or manager calls `POST /api/v1/tracking/devices/enroll-gps-tracker` with a `vehicleId` and optional label.
2. The API returns a random 256-bit bearer credential exactly once. The operator must provision it securely on the tracker; the database stores only its SHA-256 hash.
3. Send HTTPS reports to `POST /api/v1/device-gateway/ingest` with protocol `nmea0183`, `gt06`, or `json` and the vendor payload.
4. Monitor `GET /api/v1/tracking/devices/vehicle/:vehicleId` for last-seen time, derived online/offline state, last protocol, and supported telemetry.
5. Revoke a lost or replaced tracker using `POST /api/v1/tracking/devices/:deviceId/revoke`. Revocation is checked in the ingestion transaction; subsequent reports are rejected.
6. Never put the tracker bearer credential in source control, screenshots, logs, or query strings. Rotate by revoking the old device credential and enrolling a replacement; credential rotation in place is not implemented in this alpha.

## Local simulator

From `backend/` after installing dependencies and starting the API:

```bash
node scripts/simulate-tracker.mjs \
  --url http://localhost:3000/api/v1/device-gateway/ingest \
  --credential '<one-time-device-token>' --protocol json \
  --repeat 12 --interval-ms 5000 --duplicate true
```

For NMEA use `--protocol nmea0183`. For GT06, supply a captured, checksum-valid hexadecimal location frame with `--payload-file ./sample-gt06.hex`. The simulator emits synthetic coordinates near Amman and is for development only.

## Transport and security boundary

- The HTTP gateway must be exposed only over HTTPS in any non-local deployment.
- The optional NMEA TCP bridge is disabled unless `TRACKER_TCP_PORT` is configured. It uses an `AUTH <token>` line and should only be reachable through a TLS TCP proxy, private VPN, or private APN. The listener itself is not TLS.
- UDP and MQTT listeners, vendor-specific binary variants beyond the implemented GT06 0x12 location packet, SIM/APN management, firmware OTA, and automatic credential rotation are not included.
- The current online indicator uses a fixed 120-second last-seen threshold. This is a simple operational heuristic, not a device-health guarantee.

## Verification status

- `node --check backend/scripts/simulate-tracker.mjs` passed in the authoring environment.
- A local HTTP-stub smoke test exercised three fresh reports plus three exact duplicate replays; it verified fresh event payloads and byte-identical replays. This tested the simulator transport loop, not the real API/database pipeline.
- Source and ZIP structural checks are performed for this delivery.
- Jest, TypeScript compilation, PostgreSQL/PostGIS integration, Redis integration, Flutter analysis/tests, Android build, and real hardware tests require their respective dependencies and services. They are not claimed as passed unless run in an environment that has them.
