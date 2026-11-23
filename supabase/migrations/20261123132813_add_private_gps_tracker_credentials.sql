CREATE TABLE IF NOT EXISTS private.darb_tracking_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  label text,
  credential_hash text NOT NULL UNIQUE CHECK (length(credential_hash) = 64),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_seen_at timestamptz,
  last_protocol text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS darb_tracking_devices_vehicle_status_idx
  ON private.darb_tracking_devices(vehicle_id, status);
ALTER TABLE private.darb_tracking_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.darb_tracking_devices FROM PUBLIC, anon, authenticated;
