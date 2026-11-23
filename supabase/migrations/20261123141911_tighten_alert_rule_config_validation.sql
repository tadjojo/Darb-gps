ALTER TABLE private.darb_alert_rules
  DROP CONSTRAINT darb_alert_rules_check,
  ADD CONSTRAINT darb_alert_rules_config_valid CHECK (
    CASE
      WHEN rule_type = 'speed_limit' THEN
        jsonb_typeof(config->'limitKmh') = 'number'
        AND (config->>'limitKmh')::numeric BETWEEN 1 AND 300
      WHEN rule_type = 'geofence' THEN
        jsonb_typeof(config->'latitude') = 'number'
        AND jsonb_typeof(config->'longitude') = 'number'
        AND jsonb_typeof(config->'radiusMeters') = 'number'
        AND (config->>'latitude')::numeric BETWEEN -90 AND 90
        AND (config->>'longitude')::numeric BETWEEN -180 AND 180
        AND (config->>'radiusMeters')::numeric BETWEEN 25 AND 100000
      ELSE false
    END
  );