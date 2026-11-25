-- Alert fan-out and device recovery integration for Worker ingestion RPCs.
-- The trigger is idempotent with the existing NestJS alert evaluation because event_key is unique.

CREATE OR REPLACE FUNCTION private.darb_vehicle_location_alert_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM private.darb_evaluate_location_alerts(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.darb_vehicle_location_alert_trigger() FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='darb_location_alert_eval_after_insert' AND tgrelid='public.vehicle_locations'::regclass) THEN
    CREATE TRIGGER darb_location_alert_eval_after_insert
    AFTER INSERT ON public.vehicle_locations
    FOR EACH ROW EXECUTE FUNCTION private.darb_vehicle_location_alert_trigger();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_ingest_mobile_location(
  p_vehicle_id uuid,p_latitude double precision,p_longitude double precision,
  p_speed_kmh double precision DEFAULT 0,p_heading double precision DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL,p_event_id uuid DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,p_accuracy_meters double precision DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user uuid:=auth.uid(); v_role text; v_location public.vehicle_locations;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_vehicle_id IS NULL OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
    OR p_speed_kmh IS NULL OR p_speed_kmh NOT BETWEEN 0 AND 500 OR (p_heading IS NOT NULL AND p_heading NOT BETWEEN 0 AND 360)
    OR p_recorded_at IS NULL OR (p_accuracy_meters IS NOT NULL AND p_accuracy_meters NOT BETWEEN 0 AND 250) THEN
   RAISE EXCEPTION 'Invalid location payload or accuracy' USING ERRCODE='22023';
 END IF;
 IF p_recorded_at>now()+interval '5 minutes' OR p_recorded_at<now()-interval '7 days' THEN RAISE EXCEPTION 'GPS timestamp outside accepted window' USING ERRCODE='22023'; END IF;
 SELECT vm.role INTO v_role FROM public.vehicles v JOIN public.vehicle_members vm ON vm.vehicle_id=v.id
 WHERE v.id=p_vehicle_id AND v.status='active' AND vm.user_id=v_user AND vm.status='active' FOR SHARE OF v,vm;
 IF v_role IS NULL THEN RAISE EXCEPTION 'Vehicle not found' USING ERRCODE='P0002'; END IF;
 IF v_role NOT IN ('owner','manager','driver') THEN RAISE EXCEPTION 'Insufficient vehicle permissions' USING ERRCODE='42501'; END IF;
 IF p_device_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.darb_mobile_devices m WHERE m.id=p_device_id AND m.vehicle_id=p_vehicle_id AND m.user_id=v_user AND m.status='active' FOR SHARE) THEN
   RAISE EXCEPTION 'Mobile device not enrolled for this vehicle/user' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.vehicle_locations(vehicle_id,latitude,longitude,speed_kmh,heading,recorded_at,event_id,source)
 VALUES(p_vehicle_id,p_latitude,p_longitude,p_speed_kmh,p_heading,p_recorded_at,p_event_id,'mobile')
 ON CONFLICT(vehicle_id,event_id) WHERE event_id IS NOT NULL DO NOTHING
 RETURNING * INTO v_location;
 IF v_location.id IS NULL THEN RETURN jsonb_build_object('accepted',true,'duplicate',true,'eventId',p_event_id); END IF;
 IF p_device_id IS NOT NULL THEN
   UPDATE private.darb_mobile_devices SET last_seen_at=now() WHERE id=p_device_id;
   PERFORM private.darb_resolve_device_offline_alerts(p_device_id);
 END IF;
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'location',jsonb_build_object(
   'id',v_location.id,'vehicle_id',v_location.vehicle_id,'latitude',v_location.latitude,'longitude',v_location.longitude,
   'speed_kmh',v_location.speed_kmh,'heading',v_location.heading,'recorded_at',v_location.recorded_at,'received_at',v_location.received_at));
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_ingest_gps_tracker(
 p_credential_hash text,p_protocol text,p_latitude double precision,p_longitude double precision,
 p_speed_kmh double precision DEFAULT 0,p_heading double precision DEFAULT NULL,p_recorded_at timestamptz DEFAULT NULL,
 p_event_id uuid DEFAULT NULL,p_tamper boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_device private.darb_tracking_devices; v_location public.vehicle_locations;
BEGIN
 IF p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' OR p_protocol NOT IN ('json','gt06','nmea')
   OR p_latitude IS NULL OR p_latitude NOT BETWEEN -90 AND 90 OR p_longitude IS NULL OR p_longitude NOT BETWEEN -180 AND 180
   OR p_speed_kmh IS NULL OR p_speed_kmh NOT BETWEEN 0 AND 500 OR (p_heading IS NOT NULL AND p_heading NOT BETWEEN 0 AND 360) OR p_recorded_at IS NULL THEN
   RAISE EXCEPTION 'Invalid tracker payload' USING ERRCODE='22023';
 END IF;
 IF p_recorded_at>now()+interval '5 minutes' OR p_recorded_at<now()-interval '7 days' THEN RAISE EXCEPTION 'Tracker timestamp outside accepted window' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_device FROM private.darb_tracking_devices WHERE credential_hash=p_credential_hash AND status='active' FOR SHARE;
 IF v_device.id IS NULL THEN RAISE EXCEPTION 'Tracker credential invalid or revoked' USING ERRCODE='28000'; END IF;
 IF v_device.protocol<>p_protocol THEN RAISE EXCEPTION 'Protocol mismatch' USING ERRCODE='22023'; END IF;
 UPDATE private.darb_tracking_devices SET last_seen_at=now(),last_protocol=p_protocol WHERE id=v_device.id;
 PERFORM private.darb_resolve_device_offline_alerts(v_device.id);
 INSERT INTO public.vehicle_locations(vehicle_id,latitude,longitude,speed_kmh,heading,recorded_at,event_id,source)
 SELECT v_device.vehicle_id,p_latitude,p_longitude,p_speed_kmh,p_heading,p_recorded_at,p_event_id,'gps_tracker'
 WHERE EXISTS(SELECT 1 FROM public.vehicles v WHERE v.id=v_device.vehicle_id AND v.status='active')
 ON CONFLICT(vehicle_id,event_id) WHERE event_id IS NOT NULL DO NOTHING
 RETURNING * INTO v_location;
 IF v_location.id IS NULL THEN
   IF coalesce(p_tamper,false) THEN
     INSERT INTO private.darb_alerts(organization_id,vehicle_id,alert_type,severity,title,message,details,event_key,occurred_at)
     SELECT v.organization_id,v.id,'tamper','critical','اشتباه بوجود عبث بجهاز التتبع','أرسل جهاز GPS إشارة استشعار عبث. يلزم فحص المركبة والجهاز.',
       jsonb_build_object('deviceId',v_device.id,'deviceType','gps_tracker','eventId',p_event_id),
       'tamper:'||v_device.id::text||':'||coalesce(p_event_id::text,p_recorded_at::text),p_recorded_at
     FROM public.vehicles v WHERE v.id=v_device.vehicle_id AND v.status='active'
     ON CONFLICT(event_key) DO NOTHING;
   END IF;
   RETURN jsonb_build_object('accepted',true,'duplicate',true,'eventId',p_event_id);
 END IF;
 IF coalesce(p_tamper,false) THEN
   INSERT INTO private.darb_alerts(organization_id,vehicle_id,alert_type,severity,title,message,details,event_key,occurred_at)
   SELECT v.organization_id,v.id,'tamper','critical','اشتباه بوجود عبث بجهاز التتبع','أرسل جهاز GPS إشارة استشعار عبث. يلزم فحص المركبة والجهاز.',
     jsonb_build_object('deviceId',v_device.id,'deviceType','gps_tracker','eventId',p_event_id),
     'tamper:'||v_device.id::text||':'||coalesce(p_event_id::text,p_recorded_at::text),p_recorded_at
   FROM public.vehicles v WHERE v.id=v_device.vehicle_id AND v.status='active'
   ON CONFLICT(event_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('accepted',true,'duplicate',false,'location',jsonb_build_object(
   'id',v_location.id,'vehicle_id',v_location.vehicle_id,'latitude',v_location.latitude,'longitude',v_location.longitude,
   'speed_kmh',v_location.speed_kmh,'heading',v_location.heading,'recorded_at',v_location.recorded_at,'received_at',v_location.received_at),'tamper',coalesce(p_tamper,false));
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_tracker_heartbeat(p_credential_hash text,p_protocol text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_device_id uuid;
BEGIN
 IF p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' OR p_protocol NOT IN ('gt06','nmea') THEN RAISE EXCEPTION 'Invalid heartbeat payload' USING ERRCODE='22023'; END IF;
 UPDATE private.darb_tracking_devices d SET last_seen_at=now(),last_protocol=p_protocol
 WHERE d.credential_hash=p_credential_hash AND d.status='active' AND d.protocol=p_protocol RETURNING d.id INTO v_device_id;
 IF v_device_id IS NULL THEN RAISE EXCEPTION 'Tracker credential invalid or protocol mismatch' USING ERRCODE='28000'; END IF;
 PERFORM private.darb_resolve_device_offline_alerts(v_device_id);
 RETURN jsonb_build_object('accepted',true,'protocol',p_protocol,'receivedAt',now());
END;
$$;
