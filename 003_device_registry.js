exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS device_models (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      manufacturer text NOT NULL,
      model_name text NOT NULL,
      protocol_profile text NOT NULL CHECK (protocol_profile IN ('nmea0183','gt06','json')),
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (manufacturer, model_name, protocol_profile)
    );
    ALTER TABLE tracking_devices
      ADD COLUMN IF NOT EXISTS manufacturer text,
      ADD COLUMN IF NOT EXISTS model_name text,
      ADD COLUMN IF NOT EXISTS model_id uuid REFERENCES device_models(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS imei text,
      ADD COLUMN IF NOT EXISTS serial_number text,
      ADD COLUMN IF NOT EXISTS firmware_version text,
      ADD COLUMN IF NOT EXISTS hardware_version text,
      ADD COLUMN IF NOT EXISTS battery_percent smallint CHECK (battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100),
      ADD COLUMN IF NOT EXISTS signal_strength_dbm smallint CHECK (signal_strength_dbm IS NULL OR signal_strength_dbm BETWEEN -160 AND 0),
      ADD COLUMN IF NOT EXISTS network_type text,
      ADD COLUMN IF NOT EXISTS telemetry_updated_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS tracking_devices_imei_unique_idx
      ON tracking_devices(imei) WHERE imei IS NOT NULL AND imei <> '';
    CREATE INDEX IF NOT EXISTS tracking_devices_model_idx ON tracking_devices(model_id);
  `);
};
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS tracking_devices_model_idx;
    DROP INDEX IF EXISTS tracking_devices_imei_unique_idx;
    ALTER TABLE tracking_devices
      DROP COLUMN IF EXISTS telemetry_updated_at,
      DROP COLUMN IF EXISTS network_type,
      DROP COLUMN IF EXISTS signal_strength_dbm,
      DROP COLUMN IF EXISTS battery_percent,
      DROP COLUMN IF EXISTS hardware_version,
      DROP COLUMN IF EXISTS firmware_version,
      DROP COLUMN IF EXISTS serial_number,
      DROP COLUMN IF EXISTS imei,
      DROP COLUMN IF EXISTS model_id,
      DROP COLUMN IF EXISTS model_name,
      DROP COLUMN IF EXISTS manufacturer;
    DROP TABLE IF EXISTS device_models;
  `);
};
