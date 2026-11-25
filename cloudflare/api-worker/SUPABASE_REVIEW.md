# Supabase project review (read-only inspection)

Reviewed project **Darb-gps** on 2026-11-25 through the connected Supabase project tools. No database changes were applied during this review.

## Project health and schema

- Project status: active/healthy.
- PostgreSQL major version: 17.
- Database region: ap-southeast-1.
- Existing migration history includes the organization/vehicle core, RLS hardening, mobile-device enrollment, location deduplication/retention, GPS tracker credential registry/protocol profiles, and alert/rule tables.
- Core public tables confirmed: `organizations`, `organization_members`, `vehicles`, `vehicle_members`, `vehicle_locations`.
- Private tables confirmed: `darb_tracking_devices`, `darb_mobile_devices`, `darb_alert_rules`, `darb_alerts`.
- RLS is enabled on the reviewed public and private tables. Private tables intentionally have no RLS policies and have public/anon/authenticated privileges revoked; they are accessed only by trusted backend routines. This produces informational advisor lints, but do not add broad policies to silence them.

## Supabase security advisor findings

- Leaked Password Protection is disabled. Enable it in Supabase Auth password security settings when project owner is ready.
- Informational lint: private tables with RLS enabled and no policies. Current direct grants are revoked; keep that restriction.
- No security schema change was applied.

## Performance advisor findings staged in this branch

Supabase reports missing indexes on four private alert-table foreign keys. A non-destructive migration has been added to this branch:

`supabase/migrations/20261125175130_add_private_alert_fk_indexes.sql`

It adds indexes for:
- `private.darb_alert_rules.created_by`
- `private.darb_alert_rules.organization_id`
- `private.darb_alerts.acknowledged_by`
- `private.darb_alerts.rule_id`

The migration is staged in the Git branch only and **has not been applied to the live Supabase database**.

## Why migration route work is now schema-grounded

The actual project schema and roles are now confirmed. Organization/vehicle operations still require atomic operations and exact role rules; the next implementation should use safe transactional RPC functions or carefully scoped Supabase REST operations under the caller JWT, with integration tests for creator/admin/fleet-supervisor/member permissions. Private device and alert tables must not be exposed through direct REST grants.


## Rollback-only functional verification of staged RPCs

The staged organization/vehicle and mobile RPC definitions were temporarily installed within a transaction and exercised under the `authenticated` role with an auth UID set for the test context. The tests covered creating an organization and admin membership, creating a vehicle and owner membership, mobile enrollment, first location ingestion, duplicate event handling, latest-location query, and device listing. The transaction was rolled back, then queried to confirm zero test organization, vehicle, mobile device, and location rows remained. The same transaction verified the first location write and duplicate-event rejection. After rollback, a read-only query confirmed zero test organization, vehicle, mobile-device, or location rows remained. This verifies function behavior but is not a substitute for live API/Flutter integration testing.


## Rollback-only location-history functional test

The staged scoped location-history RPC was tested in a rollback-only transaction by creating a test organization, vehicle, and three timestamped locations under an authenticated-role context, then verifying the RPC returned three ordered points. The transaction was rolled back and a follow-up query confirmed no test organization remained. No production data was added.


## Hardware RPC verification

Tracker provisioning, rotation, revocation, profile lookup, JSON telemetry, duplicate-event handling, and GT06 heartbeat were exercised in rollback-only transactions under the authenticated/service roles. Profile lookup and tracker protocol credential checks were also validated; no test organization/device/location rows remain. The Worker adapter tests validate NMEA RMC checksum/time/coordinate normalization and GT06 frame CRC/location/timezone normalization. All migrations remain staged, not applied.


## Vehicle-membership RPC verification

The staged membership RPC migration was syntax-tested and the add-member RPC was exercised under the authenticated role in a rollback-only transaction. A read-only verification confirmed the test organization was removed by rollback. Membership revocation and role-denial behavior remains covered by Worker mock tests; it has not been applied to live schema.


## Alert RPC rollback functional test

The staged alert API/evaluation SQL was exercised under authenticated-role context inside a rollback-only transaction. The test created speed/geofence rules, enrolled a mobile device, inserted two locations that crossed the speed threshold and entered a geofence, verified both alerts were generated, acknowledged/resolved an alert, and confirmed the test organization was removed after rollback. This is functional validation only; migrations remain staged and no live data was changed.
