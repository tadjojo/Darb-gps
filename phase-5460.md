# Phase 5460 — Distributed authorization revocation

## Delivered in source

- Logout writes the access-token JTI deny-list row and publishes `darb_access_revoked` in the same PostgreSQL transaction. PostgreSQL emits the notification only after commit.
- A dedicated PostgreSQL `LISTEN` connection on every API instance consumes access-token and vehicle-membership revocation notifications.
- Each API instance disconnects only sockets carrying the revoked JTI; a revoked vehicle membership removes that user's sockets from the vehicle room.
- `DELETE /api/v1/vehicles/:vehicleId/members/:memberUserId` revokes membership. Owners may revoke managers/drivers/viewers; managers may revoke drivers/viewers. Self-removal and owner removal are denied pending a controlled ownership-transfer workflow.
- A 30-second batched socket authorization audit repairs missed notifications after listener interruptions or restarts. It checks account status, JTI deny-list, vehicle status, and active vehicle membership.
- A 15-minute cleanup job deletes expired access-token deny-list rows and refresh sessions older than the 90-day retention window.

## Operational assumptions

- Every API replica must have a working PostgreSQL connection and its own `LISTEN` session. Notifications are broadcast to all active listeners, not persisted for offline listeners.
- The periodic audit is the recovery mechanism for missed notifications. Its maximum normal stale-room window is about 30 seconds plus query/processing time; it is not instantaneous revocation during a database outage.
- The existing Socket.IO deployment still requires a compatible multi-instance adapter/load-balancer configuration for room broadcasts. PostgreSQL notification fanout only handles authorization revocation; it is not a Socket.IO broadcast adapter.
- `pg_notify` payloads contain only UUID identifiers, not personal data or tokens.

## Acceptance tests to run against a real multi-instance environment

1. Connect two sockets for one user to API replica A and one socket to replica B. Log out one JWT. Only sockets with that exact JTI must disconnect on both replicas; a different active login remains connected.
2. Join a vehicle room from replicas A and B. Revoke that user's membership through the DELETE endpoint. Both replicas must remove the sockets from that vehicle room without disconnecting access to other vehicles.
3. Stop a listener connection, revoke membership, then restore the listener. The 30-second audit must remove stale room membership.
4. Disable an account and verify the audit disconnects its active sockets.
5. Verify a manager cannot revoke another manager or owner; an owner can revoke a manager; neither can revoke itself.
6. Verify expired deny-list entries and refresh sessions older than 90 days are removed by cleanup.
7. Simulate notification duplication. Repeated disconnect/leave operations must remain harmless.

## Not yet runtime-verified

This environment does not provide the complete dependency installation plus PostgreSQL/Redis multi-instance test stack. The source changes therefore require a full NestJS build, migration check, and integration tests before production use.
