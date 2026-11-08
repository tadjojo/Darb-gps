# Phase 5461 — per-replica realtime stream fan-out

## Problem corrected

A single Redis Stream consumer group distributes entries among its consumers. If multiple API replicas share that one group, only the replica that receives a given entry emits it to its local Socket.IO namespace. Clients connected to other replicas can therefore miss live updates.

## Delivered in source

- Each API replica now uses its own stable Redis consumer group: `darb-socket-gateway-v2-${INSTANCE_ID}` by default.
- `REALTIME_CONSUMER_GROUP` can explicitly override the derived group, but must remain unique per replica.
- Production configuration requires `INSTANCE_ID`; it must be unique per replica and stable across restarts of that replica.
- A newly created replica group starts at `$`, avoiding replay of the entire historical stream. Clients must fetch the latest vehicle location through REST after connecting/joining, then consume live updates.
- Existing groups retain their cursor and pending entries across restarts when the same instance ID is reused. The existing `XAUTOCLAIM` recovery continues to provide at-least-once processing within that replica's group.

## Deployment notes

- Set a distinct, stable `INSTANCE_ID` for each API replica (for example, a StatefulSet ordinal). Do not set the same `REALTIME_CONSUMER_GROUP` on multiple replicas.
- Ensure the mobile/web client calls the latest-location REST endpoint after a fresh socket connection or reconnect; stream events are not a replacement for the state snapshot.
- The previous shared group `darb-socket-gateway-v1` becomes unused after all old replicas are stopped. It can be removed by an operator only after confirming no old application version is consuming it: `XGROUP DESTROY darb:events darb-socket-gateway-v1`.
- This is per-replica event consumption, not a Socket.IO Redis adapter. Each API replica receives and emits the event to its own locally connected clients. It does not synchronize arbitrary Socket.IO room operations between instances.

## Acceptance tests

1. Start API replicas A and B with distinct stable `INSTANCE_ID` values and the same Redis stream.
2. Connect a client to each replica and join the same vehicle room.
3. Publish one vehicle location event to the stream. Both clients must receive it (subject to at-least-once duplicate handling).
4. Restart replica A with the same `INSTANCE_ID`; verify its consumer group resumes and pending entries are recovered.
5. Start a new replica C with a new ID; verify it does not replay old stream entries and receives newly appended events.
6. Verify all clients fetch REST latest-location after reconnect to cover the initial `$` cursor boundary.

## Not yet runtime-verified

Redis multi-replica behavior must be tested with a real Redis instance and at least two NestJS processes before production deployment.
