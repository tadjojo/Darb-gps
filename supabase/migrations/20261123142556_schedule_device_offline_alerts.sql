CREATE OR REPLACE FUNCTION private.generate_device_offline_alerts()
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  inserted_count integer := 0;
BEGIN
  INSERT INTO private.darb_alerts
    (organization_id, vehicle_id, alert_type, severity, title, message, details, event_key, occurred_at)
  SELECT v.organization_id, d.vehicle_id, 'device_offline', 'warning',
         'جهاز التتبع غير متصل',
         CASE WHEN d.device_type = 'gps_tracker'
              THEN 'انقطع الاتصال بجهاز GPS المستقل لأكثر من 10 دقائق.'
              ELSE 'انقطع الاتصال بتطبيق التتبع على الهاتف لأكثر من 10 دقائق.'
         END,
         jsonb_build_object('deviceId', d.device_id, 'deviceType', d.device_type, 'lastSeenAt', d.last_seen_at),
         'device_offline:' || d.device_type || ':' || d.device_id::text || ':' ||
           to_char(d.last_seen_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS'),
         now()
    FROM (
      SELECT id AS device_id, vehicle_id, 'gps_tracker'::text AS device_type,
             coalesce(last_seen_at, created_at) AS last_seen_at
        FROM private.darb_tracking_devices WHERE status = 'active'
      UNION ALL
      SELECT id AS device_id, vehicle_id, 'mobile'::text AS device_type,
             coalesce(last_seen_at, enrolled_at) AS last_seen_at
        FROM private.darb_mobile_devices WHERE status = 'active'
    ) d
    JOIN public.vehicles v ON v.id = d.vehicle_id
   WHERE v.status = 'active'
     AND d.last_seen_at < now() - interval '10 minutes'
  ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_device_offline_alerts() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'darb-gps-device-offline-alerts') THEN
    PERFORM cron.schedule(
      'darb-gps-device-offline-alerts',
      '*/5 * * * *',
      'SELECT private.generate_device_offline_alerts();'
    );
  END IF;
END;
$$;