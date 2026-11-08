exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tracking_devices ADD COLUMN IF NOT EXISTS device_label text;
    ALTER TABLE tracking_devices ADD COLUMN IF NOT EXISTS last_protocol text
      CHECK (last_protocol IS NULL OR last_protocol IN ('nmea0183','gt06','json','mobile'));
    CREATE INDEX IF NOT EXISTS tracking_devices_active_tracker_credential_idx
      ON tracking_devices (credential_hash) WHERE device_type = 'gps_tracker' AND status = 'active';
    CREATE INDEX IF NOT EXISTS tracking_devices_last_seen_idx ON tracking_devices(last_seen_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS tracking_devices_last_seen_idx;
    DROP INDEX IF EXISTS tracking_devices_active_tracker_credential_idx;
    ALTER TABLE tracking_devices DROP COLUMN IF EXISTS last_protocol;
    ALTER TABLE tracking_devices DROP COLUMN IF EXISTS device_label;
  `);
};
