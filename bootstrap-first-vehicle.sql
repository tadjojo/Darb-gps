-- Controlled first-account provisioning template.
-- Run only from a trusted administrative workstation with psql.
-- Supply a precomputed bcrypt hash; never put a plaintext password in this file.
-- Example invocation:
-- psql "$DATABASE_URL" -v email='owner@example.test' \
--   -v password_hash='$2b$12$REPLACE_WITH_REAL_BCRYPT_HASH' \
--   -v organization_name='Demo Fleet' -v vehicle_name='Vehicle 1' -f docs/bootstrap-first-vehicle.sql

BEGIN;

INSERT INTO app_users (email, password_hash, status)
VALUES (:'email', :'password_hash', 'active')
RETURNING id AS user_id \gset

INSERT INTO organizations (name, status)
VALUES (:'organization_name', 'active')
RETURNING id AS organization_id \gset

INSERT INTO organization_members (organization_id, user_id, role, status)
VALUES (:'organization_id', :'user_id', 'org_admin', 'active');

INSERT INTO vehicles (organization_id, display_name, status)
VALUES (:'organization_id', :'vehicle_name', 'active')
RETURNING id AS vehicle_id \gset

INSERT INTO vehicle_members (vehicle_id, user_id, role, status)
VALUES (:'vehicle_id', :'user_id', 'owner', 'active');

COMMIT;

\echo 'Provisioned user:' :user_id
\echo 'Provisioned organization:' :organization_id
\echo 'Provisioned vehicle:' :vehicle_id
