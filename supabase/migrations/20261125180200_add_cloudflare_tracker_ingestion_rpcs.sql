-- Tracker credential-authenticated JSON telemetry and GT06 heartbeat RPCs.

CREATE OR REPLACE FUNCTION public.darb_api_ingest_gps_tracker(
  p_credential_hash text,
  p_protocol text,
  p_latitude double precision,
  p_longitude double precision,
  p_speed_kmh double precision DEFAULT 0,
  p_heading double precision DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_tamper boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device private.darb_tracking_devices;
  v_location public.vehicle_locations;
BEGIN
  IF p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_protocol NOT IN ('json','gt06','nmea')
     OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
     OR p_speed_kmh IS NULL OR p_speed_kmh NOT BETWEEN 0 AND 500
     OR (p_heading IS NOT NULL AND p_heading NOT BETWEEN 0 AND 360)
     OR p_recorded_at IS NULL THEN
    RAISE EXCEPTION 'Invalid tracker payload' USING ERRCODE = '22023';
  END IF;
  IF p_recorded_at > now() + interval '5 minutes' OR p_recorded_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'Tracker timestamp outside accepted window' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_device FROM private.darb_tracking_devices
  WHERE credential_hash = p_credential_hash AND status = 'active'
  FOR SHARE;
  IF v_device.id IS NULL THEN RAISE EXCEPTION 'Tracker credential invalid or revoked' USING ERRCODE = '28000'; END IF;
  IF v_device.protocol <> p_protocol THEN RAISE EXCEPTION 'Protocol does not match tracker profile' USING ERRCODE = '22023'; END IF;

  UPDATE private.darb_tracking_devices SET last_seen_at = now(), last_protocol = p_protocol WHERE id = v_device.id;
  INSERT INTO public.vehicle_locations
    (vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, event_id, source)
  SELECT v_device.vehicle_id, p_latitude, p_longitude, p_speed_kmh, p_heading, p_recorded_at, p_event_id, 'gps_tracker'
  WHERE EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = v_device.vehicle_id AND v.status = 'active')
  ON CONFLICT (vehicle_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_location;

  IF v_location.id IS NULL THEN
    RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'eventId', p_event_id);
  END IF;
  RETURN jsonb_build_object('accepted', true, 'duplicate', false,
    'location', jsonb_build_object('id', v_location.id, 'vehicle_id', v_location.vehicle_id,
      'latitude', v_location.latitude, 'longitude', v_location.longitude,
      'speed_kmh', v_location.speed_kmh, 'heading', v_location.heading,
      'recorded_at', v_location.recorded_at, 'received_at', v_location.received_at),
    'tamper', coalesce(p_tamper,false));
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_tracker_heartbeat(p_credential_hash text, p_protocol text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_device_id uuid;
BEGIN
  IF p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_protocol NOT IN ('gt06','nmea') THEN
    RAISE EXCEPTION 'Invalid heartbeat payload' USING ERRCODE = '22023';
  END IF;
  UPDATE private.darb_tracking_devices d
    SET last_seen_at = now(), last_protocol = p_protocol
  WHERE d.credential_hash = p_credential_hash AND d.status = 'active' AND d.protocol = p_protocol
  RETURNING d.id INTO v_device_id;
  IF v_device_id IS NULL THEN RAISE EXCEPTION 'Tracker credential invalid or protocol mismatch' USING ERRCODE = '28000'; END IF;
  RETURN jsonb_build_object('accepted', true, 'protocol', p_protocol, 'receivedAt', now());
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_ingest_gps_tracker(text, text, double precision, double precision, double precision, double precision, timestamptz, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.darb_api_tracker_heartbeat(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_ingest_gps_tracker(text, text, double precision, double precision, double precision, double precision, timestamptz, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.darb_api_tracker_heartbeat(text, text) TO service_role;
