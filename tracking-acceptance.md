# Tracking API acceptance checklist (manual until CI integration is configured)

Use a disposable database with PostGIS and a provisioned owner/vehicle from `docs/bootstrap-first-vehicle.sql`.

1. Login with the provisioned account and retain the access token.
2. Enroll a mobile device using `POST /api/v1/tracking/devices/enroll-mobile` with `{ "vehicleId": "<vehicle-uuid>" }`.
3. Submit one location with a newly generated `eventId`, matching `deviceId` and `vehicleId`, numeric latitude/longitude/accuracy, and an ISO-8601 `recordedAt`.
4. Confirm the response is `accepted: true`, `duplicate: false`, and `becameLatest: true`.
5. Repeat the exact payload with the same `eventId`; confirm `duplicate: true` and no second history row/outbox event.
6. Submit an older but otherwise valid event with a new `eventId`; confirm it is stored but `becameLatest: false` and does not create a live-location outbox event.
7. Query `GET /api/v1/tracking/vehicles/<vehicle-uuid>/latest`; confirm it still returns the newest timestamp and correct coordinates.
8. Submit a device ID belonging to another user/vehicle; confirm 403/404 and no insert.
9. Submit accuracy over 250m, timestamp over five minutes in the future, and timestamp older than seven days; confirm 400 and no insert.
10. Revoke the device as owner/manager; confirm later ingestion is rejected.
11. Revoke vehicle membership; confirm latest-location reads and ingestion are rejected.
12. Force a database error between location insert and commit; confirm transaction rollback leaves no partial location/latest/outbox writes.

## Required automated coverage before pilot

- Unit tests for timestamp/accuracy policies and authorization role matrix.
- PostgreSQL integration tests for duplicate keys, out-of-order events, transaction rollback and concurrent submissions.
- Load test at 200 messages/second as the first 1,000-device target (5-second reporting interval), then scale-test beyond it.
- Verify that clients ignore out-of-order WebSocket messages and re-fetch latest state after reconnect; the worker/socket layer is not implemented in this alpha.

## Redis outbox checks

13. Start Redis with AOF enabled and confirm a committed location creates a `darb:events` stream entry containing the stable `outboxId`, event type, aggregate ID and JSON payload.
14. Stop Redis temporarily; confirm new outbox rows remain pending/retry and are not marked published.
15. Restart Redis; confirm pending rows are published and marked published only by the worker holding the current lease.
16. Simulate a crash after `XADD` but before the database status update; confirm a retry can produce a duplicate stream entry with the same `outboxId`. Any future consumer must deduplicate on `outboxId`.
17. Confirm events exceeding ten publish attempts become `failed` for operator review rather than being silently discarded.

The Redis Stream is not automatically trimmed. Configure persistence, backups, memory alerts and a reviewed retention/archival policy before production.

## Organization and realtime acceptance checks

- [ ] Create an organization; verify creator receives `org_admin` membership atomically.
- [ ] Create a vehicle as `org_admin` and `fleet_supervisor`; deny a normal member.
- [ ] Add a vehicle member only when that user is an active member of the same organization.
- [ ] Connect to `/tracking` with a valid access token; reject expired tokens and disabled accounts.
- [ ] Reject `vehicle.join` for a vehicle without active membership; permit it for an authorized member.
- [ ] Publish a location outbox event and verify a joined room receives `vehicle.location.updated`.
- [ ] Simulate consumer restart and verify pending stream messages are reclaimed.
- [ ] Simulate a crash after emit and before XACK; verify clients deduplicate by `outboxId`/`eventId`.
- [ ] Disconnect and reconnect a client; fetch REST latest location and reconcile the map marker.
- [ ] Verify browser origins outside `CORS_ORIGINS` cannot establish a Socket.IO connection.

## Authentication revocation acceptance checks

1. Log in and retain both access and refresh tokens.
2. Call `POST /api/v1/auth/logout` with the refresh token in the body and access token in the Bearer header; expect HTTP 204.
3. Reuse the access token on a guarded HTTP endpoint; expect HTTP 401.
4. Reuse the refresh token at `/api/v1/auth/refresh`; expect HTTP 401.
5. Attempt a new Socket.IO `/tracking` connection with the revoked access token; expect the server to disconnect it.
6. Call logout with refresh token only; refresh must be revoked, while the access token remains valid until expiry (documented compatibility behavior).
7. Confirm a socket connected before logout is not guaranteed to be force-disconnected in this alpha; this remains a production blocker.
