-- Transaction-safe mobile tracking RPCs for the Cloudflare Free API prototype.
-- All user authorization is derived from auth.uid(); private tables remain revoked.

CREATE OR REPLACE FUNCTION public.darb_api_enroll_mobile_device(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_device public.darb_mobile_devices;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
    WHERE v.id = p_vehicle_id AND v.status = 'active'
      AND vm.user_id = v_user AND vm.status = 'active'
      AND vm.role IN ('owner','manager','driver')
  ) THEN
    RAISE EXCEPTION 'Vehicle not found or permission denied' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO private.darb_mobile_devices (vehicle_id, user_id, status)
  VALUES (p_vehicle_id, v_user, 'active')
  ON CONFLICT (vehicle_id, user_id) DO UPDATE SET status = 'active'
  RETURNING * INTO v_device;

  RETURN jsonb_build_object(
    'device', jsonb_build_object(
      'id', v_device.id, 'vehicle_id', v_device.vehicle_id,
      'status', v_device.status, 'enrolled_at', v_device.enrolled_at
    ),
    'authentication', 'user_jwt'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_list_devices(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
    WHERE v.id = p_vehicle_id AND v.status = 'active'
      AND vm.user_id = v_user AND vm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Vehicle not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(jsonb_agg(d.item ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'vehicle_id', m.vehicle_id, 'device_type', 'mobile',
      'status', m.status, 'created_at', m.enrolled_at, 'last_seen_at', m.last_seen_at,
      'label', null, 'protocol', null, 'imei', null, 'model', null,
      'timezone_offset_minutes', null
    ) AS item, m.enrolled_at AS created_at
    FROM private.darb_mobile_devices m WHERE m.vehicle_id = p_vehicle_id
    UNION ALL
    SELECT jsonb_build_object(
      'id', t.id, 'vehicle_id', t.vehicle_id, 'device_type', 'gps_tracker',
      'status', t.status, 'created_at', t.created_at, 'last_seen_at', t.last_seen_at,
      'label', t.label, 'protocol', t.protocol, 'imei', t.imei, 'model', t.model,
      'timezone_offset_minutes', t.timezone_offset_minutes
    ) AS item, t.created_at AS created_at
    FROM private.darb_tracking_devices t WHERE t.vehicle_id = p_vehicle_id
  ) d;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_latest_location(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_location jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.vehicles v
    JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
    WHERE v.id = p_vehicle_id AND v.status = 'active'
      AND vm.user_id = v_user AND vm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Vehicle not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT to_jsonb(l) INTO v_location
  FROM public.vehicle_locations l
  WHERE l.vehicle_id = p_vehicle_id
  ORDER BY l.recorded_at DESC, l.id DESC
  LIMIT 1;
  RETURN v_location;
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_ingest_mobile_location(
  p_vehicle_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_speed_kmh double precision DEFAULT 0,
  p_heading double precision DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,
  p_accuracy_meters double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_role text;
  v_location public.vehicle_locations;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_vehicle_id IS NULL
     OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90
     OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
     OR p_speed_kmh IS NULL OR p_speed_kmh NOT BETWEEN 0 AND 500
     OR (p_heading IS NOT NULL AND p_heading NOT BETWEEN 0 AND 360)
     OR p_recorded_at IS NULL
     OR p_accuracy_meters IS NOT NULL AND p_accuracy_meters NOT BETWEEN 0 AND 250 THEN
    RAISE EXCEPTION 'Invalid location payload or accuracy' USING ERRCODE = '22023';
  END IF;
  IF p_recorded_at > now() + interval '5 minutes'
     OR p_recorded_at < now() - interval '7 days' THEN
    RAISE EXCEPTION 'GPS timestamp is outside the accepted seven-day window' USING ERRCODE = '22023';
  END IF;

  SELECT vm.role INTO v_role
  FROM public.vehicles v
  JOIN public.vehicle_members vm ON vm.vehicle_id = v.id
  WHERE v.id = p_vehicle_id AND v.status = 'active'
    AND vm.user_id = v_user AND vm.status = 'active'
  FOR SHARE OF v, vm;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Vehicle not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role NOT IN ('owner','manager','driver') THEN
    RAISE EXCEPTION 'Insufficient vehicle permissions' USING ERRCODE = '42501';
  END IF;

  IF p_device_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.darb_mobile_devices m
    WHERE m.id = p_device_id AND m.vehicle_id = p_vehicle_id
      AND m.user_id = v_user AND m.status = 'active'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Mobile device is not enrolled for this user and vehicle' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.vehicle_locations
    (vehicle_id, latitude, longitude, speed_kmh, heading, recorded_at, event_id, source)
  VALUES
    (p_vehicle_id, p_latitude, p_longitude, p_speed_kmh, p_heading, p_recorded_at, p_event_id, 'mobile')
  ON CONFLICT (vehicle_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_location;

  IF v_location.id IS NULL THEN
    RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'eventId', p_event_id);
  END IF;

  IF p_device_id IS NOT NULL THEN
    UPDATE private.darb_mobile_devices SET last_seen_at = now() WHERE id = p_device_id;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true, 'duplicate', false,
    'location', jsonb_build_object(
      'id', v_location.id, 'vehicle_id', v_location.vehicle_id,
      'latitude', v_location.latitude, 'longitude', v_location.longitude,
      'speed_kmh', v_location.speed_kmh, 'heading', v_location.heading,
      'recorded_at', v_location.recorded_at, 'received_at', v_location.received_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_enroll_mobile_device(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.darb_api_list_devices(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.darb_api_latest_location(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.darb_api_ingest_mobile_location(uuid, double precision, double precision, double precision, double precision, timestamptz, uuid, uuid, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_enroll_mobile_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_list_devices(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_latest_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_ingest_mobile_location(uuid, double precision, double precision, double precision, double precision, timestamptz, uuid, uuid, double precision) TO authenticated;
