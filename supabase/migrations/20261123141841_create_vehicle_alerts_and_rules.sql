CREATE TABLE IF NOT EXISTS private.darb_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('speed_limit','geofence')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (rule_type = 'speed_limit' AND jsonb_typeof(config->'limitKmh') = 'number'
      AND (config->>'limitKmh')::numeric BETWEEN 1 AND 300)
    OR
    (rule_type = 'geofence' AND jsonb_typeof(config->'latitude') = 'number'
      AND jsonb_typeof(config->'longitude') = 'number'
      AND jsonb_typeof(config->'radiusMeters') = 'number'
      AND (config->>'latitude')::numeric BETWEEN -90 AND 90
      AND (config->>'longitude')::numeric BETWEEN -180 AND 180
      AND (config->>'radiusMeters')::numeric BETWEEN 25 AND 100000)
  )
);
CREATE TABLE IF NOT EXISTS private.darb_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES private.darb_alert_rules(id) ON DELETE SET NULL,
  alert_type text NOT NULL CHECK (alert_type IN ('speed_limit','geofence_enter','geofence_exit','device_offline','tamper')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS darb_alerts_org_created_idx ON private.darb_alerts(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS darb_alerts_vehicle_created_idx ON private.darb_alerts(vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS darb_alert_rules_vehicle_enabled_idx ON private.darb_alert_rules(vehicle_id, enabled, rule_type);
ALTER TABLE private.darb_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.darb_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.darb_alert_rules, private.darb_alerts FROM PUBLIC, anon, authenticated;