ALTER TABLE private.darb_tracking_devices
  ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'json',
  ADD COLUMN IF NOT EXISTS imei text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer,
  ADD COLUMN IF NOT EXISTS protocol_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE private.darb_tracking_devices
  DROP CONSTRAINT IF EXISTS darb_tracking_devices_protocol_check;
ALTER TABLE private.darb_tracking_devices
  ADD CONSTRAINT darb_tracking_devices_protocol_check
  CHECK (protocol IN ('json', 'gt06', 'nmea'));

ALTER TABLE private.darb_tracking_devices
  DROP CONSTRAINT IF EXISTS darb_tracking_devices_timezone_offset_check;
ALTER TABLE private.darb_tracking_devices
  ADD CONSTRAINT darb_tracking_devices_timezone_offset_check
  CHECK (timezone_offset_minutes IS NULL OR timezone_offset_minutes BETWEEN -840 AND 840);

ALTER TABLE private.darb_tracking_devices
  DROP CONSTRAINT IF EXISTS darb_tracking_devices_imei_format_check;
ALTER TABLE private.darb_tracking_devices
  ADD CONSTRAINT darb_tracking_devices_imei_format_check
  CHECK (imei IS NULL OR imei ~ '^[0-9]{8,20}$');

CREATE UNIQUE INDEX IF NOT EXISTS darb_tracking_devices_imei_unique
  ON private.darb_tracking_devices (imei) WHERE imei IS NOT NULL;
CREATE INDEX IF NOT EXISTS darb_tracking_devices_protocol_status_idx
  ON private.darb_tracking_devices (protocol, status);

COMMENT ON COLUMN private.darb_tracking_devices.protocol IS 'Configured wire protocol: json, gt06, or nmea';
COMMENT ON COLUMN private.darb_tracking_devices.timezone_offset_minutes IS 'Device local clock offset east of UTC; null means not configured';
COMMENT ON COLUMN private.darb_tracking_devices.protocol_config IS 'Non-secret, per-device protocol profile settings';
