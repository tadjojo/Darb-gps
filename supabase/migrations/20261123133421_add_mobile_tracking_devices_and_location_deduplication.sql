CREATE TABLE IF NOT EXISTS private.darb_mobile_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  UNIQUE (vehicle_id, user_id)
);
ALTER TABLE private.darb_mobile_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.darb_mobile_devices FROM PUBLIC, anon, authenticated;
ALTER TABLE public.vehicle_locations ADD COLUMN IF NOT EXISTS event_id uuid;
ALTER TABLE public.vehicle_locations ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api';
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_locations_vehicle_event_uidx
  ON public.vehicle_locations(vehicle_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicle_locations_vehicle_recorded_idx
  ON public.vehicle_locations(vehicle_id, recorded_at DESC, id DESC);
