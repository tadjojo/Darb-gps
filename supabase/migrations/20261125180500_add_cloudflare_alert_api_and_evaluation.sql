-- Alert evaluation and authenticated alert/rule API RPCs.

CREATE OR REPLACE FUNCTION private.darb_haversine_distance(p_lat1 double precision,p_lon1 double precision,p_lat2 double precision,p_lon2 double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path=''
AS $
 SELECT 6371000.0 * 2 * asin(sqrt(least(1.0,
   sin(radians(p_lat2-p_lat1)/2)^2 + cos(radians(p_lat1))*cos(radians(p_lat2))*sin(radians(p_lon2-p_lon1)/2)^2
  )))
$;
REVOKE ALL ON FUNCTION private.darb_haversine_distance(double precision,double precision,double precision,double precision) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.darb_evaluate_location_alerts(p_location_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_location public.vehicle_locations;
  v_previous public.vehicle_locations;
  v_count integer := 0;
  v_rule record;
  v_alert_type text;
  v_title text;
  v_message text;
  v_severity text;
  v_inside_now boolean;
  v_inside_before boolean;
BEGIN
  SELECT * INTO v_location FROM public.vehicle_locations WHERE id=p_location_id;
  IF v_location.id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO v_previous FROM public.vehicle_locations
  WHERE vehicle_id=v_location.vehicle_id
    AND (recorded_at,id)<(v_location.recorded_at,v_location.id)
  ORDER BY recorded_at DESC,id DESC LIMIT 1;

  FOR v_rule IN SELECT * FROM private.darb_alert_rules WHERE vehicle_id=v_location.vehicle_id AND enabled=true LOOP
    v_alert_type := null; v_title := ''; v_message := ''; v_severity := 'warning';
    IF v_rule.rule_type='speed_limit' AND v_previous.id IS NOT NULL THEN
      IF v_previous.speed_kmh <= (v_rule.config->>'limitKmh')::numeric
         AND v_location.speed_kmh > (v_rule.config->>'limitKmh')::numeric THEN
        v_alert_type := 'speed_limit';
        v_title := 'تجاوز السرعة المحددة';
        v_message := format('تجاوزت المركبة الحد المحدد %s كم/س ووصلت إلى %s كم/س.',v_rule.config->>'limitKmh',round(v_location.speed_kmh));
      END IF;
    ELSIF v_rule.rule_type='geofence' AND v_previous.id IS NOT NULL THEN
      v_inside_now := private.darb_haversine_distance(v_location.latitude,v_location.longitude,(v_rule.config->>'latitude')::double precision,(v_rule.config->>'longitude')::double precision) <= (v_rule.config->>'radiusMeters')::double precision;
      v_inside_before := private.darb_haversine_distance(v_previous.latitude,v_previous.longitude,(v_rule.config->>'latitude')::double precision,(v_rule.config->>'longitude')::double precision) <= (v_rule.config->>'radiusMeters')::double precision;
      IF v_inside_now<>v_inside_before THEN
        v_alert_type := CASE WHEN v_inside_now THEN 'geofence_enter' ELSE 'geofence_exit' END;
        v_title := CASE WHEN v_inside_now THEN 'دخول نطاق جغرافي' ELSE 'خروج من نطاق جغرافي' END;
        v_message := format('المركبة %s النطاق «%s».',CASE WHEN v_inside_now THEN 'دخلت' ELSE 'غادرت' END,v_rule.name);
        v_severity := CASE WHEN v_inside_now THEN 'info' ELSE 'warning' END;
      END IF;
    END IF;
    IF v_alert_type IS NOT NULL THEN
      INSERT INTO private.darb_alerts
        (organization_id,vehicle_id,rule_id,alert_type,severity,title,message,details,event_key,occurred_at)
      VALUES
        (v_rule.organization_id,v_rule.vehicle_id,v_rule.id,v_alert_type,v_severity,v_title,v_message,
         jsonb_build_object('ruleName',v_rule.name,'speedKmh',v_location.speed_kmh,'latitude',v_location.latitude,'longitude',v_location.longitude),
         v_rule.id::text||':'||v_alert_type||':'||v_location.id::text,v_location.recorded_at)
      ON CONFLICT(event_key) DO NOTHING;
      IF FOUND THEN v_count:=v_count+1; END IF;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.darb_evaluate_location_alerts(bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.darb_api_list_alerts(p_status text DEFAULT NULL,p_vehicle_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user uuid:=auth.uid(); v_rows jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_status IS NOT NULL AND p_status NOT IN ('open','acknowledged','resolved') OR p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN RAISE EXCEPTION 'Invalid alert filter or limit' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.occurred_at DESC),'[]'::jsonb) INTO v_rows FROM (
  SELECT a.id,a.vehicle_id,v.display_name AS vehicle_name,v.registration_number,a.rule_id,a.alert_type,a.severity,a.title,a.message,a.details,a.status,a.occurred_at,a.acknowledged_at
  FROM private.darb_alerts a JOIN public.vehicles v ON v.id=a.vehicle_id JOIN public.vehicle_members vm ON vm.vehicle_id=v.id
  WHERE vm.user_id=v_user AND vm.status='active' AND (p_status IS NULL OR a.status=p_status) AND (p_vehicle_id IS NULL OR a.vehicle_id=p_vehicle_id)
  ORDER BY a.occurred_at DESC LIMIT p_limit
 ) q;
 RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_acknowledge_alert(p_alert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user uuid:=auth.uid(); v_row private.darb_alerts;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 UPDATE private.darb_alerts a SET status='acknowledged',acknowledged_at=now(),acknowledged_by=v_user
 WHERE a.id=p_alert_id AND a.status='open' AND EXISTS(SELECT 1 FROM public.vehicle_members vm WHERE vm.vehicle_id=a.vehicle_id AND vm.user_id=v_user AND vm.status='active')
 RETURNING * INTO v_row;
 IF v_row.id IS NULL THEN RAISE EXCEPTION 'Open alert not found or access denied' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('id',v_row.id,'status',v_row.status,'acknowledged_at',v_row.acknowledged_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_resolve_alert(p_alert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user uuid:=auth.uid(); v_row private.darb_alerts;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 UPDATE private.darb_alerts a SET status='resolved'
 WHERE a.id=p_alert_id AND a.status IN ('open','acknowledged') AND EXISTS(SELECT 1 FROM public.vehicle_members vm WHERE vm.vehicle_id=a.vehicle_id AND vm.user_id=v_user AND vm.status='active')
 RETURNING * INTO v_row;
 IF v_row.id IS NULL THEN RAISE EXCEPTION 'Alert not found or access denied' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('id',v_row.id,'status',v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_list_alert_rules(p_vehicle_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user uuid:=auth.uid(); v_rows jsonb;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC),'[]'::jsonb) INTO v_rows FROM (
  SELECT r.id,r.vehicle_id,v.display_name AS vehicle_name,r.rule_type,r.name,r.config,r.enabled,r.created_at,r.updated_at
  FROM private.darb_alert_rules r JOIN public.vehicles v ON v.id=r.vehicle_id JOIN public.vehicle_members vm ON vm.vehicle_id=v.id
  WHERE vm.user_id=v_user AND vm.status='active' AND (p_vehicle_id IS NULL OR r.vehicle_id=p_vehicle_id)
  ORDER BY r.created_at DESC
 ) q;
 RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_create_alert_rule(p_vehicle_id uuid,p_type text,p_name text,p_config jsonb,p_enabled boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_user uuid:=auth.uid(); v_org uuid; v_role text; v_row private.darb_alert_rules;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_vehicle_id IS NULL OR p_type IS NULL OR p_type NOT IN ('speed_limit','geofence') OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 120 OR p_config IS NULL OR jsonb_typeof(p_config)<>'object' THEN RAISE EXCEPTION 'Invalid rule payload' USING ERRCODE='22023'; END IF;
 SELECT v.organization_id,vm.role INTO v_org,v_role FROM public.vehicles v JOIN public.vehicle_members vm ON vm.vehicle_id=v.id
 WHERE v.id=p_vehicle_id AND v.status='active' AND vm.user_id=v_user AND vm.status='active';
 IF v_role IS NULL THEN RAISE EXCEPTION 'Vehicle not found' USING ERRCODE='P0002'; END IF;
 IF v_role NOT IN ('owner','manager') THEN RAISE EXCEPTION 'Only owners/managers can manage alert rules' USING ERRCODE='42501'; END IF;
 IF p_type='speed_limit' AND (jsonb_typeof(p_config->'limitKmh') IS DISTINCT FROM 'number' OR (p_config->>'limitKmh')::numeric NOT BETWEEN 1 AND 300) THEN RAISE EXCEPTION 'Speed limit must be 1..300' USING ERRCODE='22023'; END IF;
 IF p_type='geofence' AND (jsonb_typeof(p_config->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(p_config->'longitude') IS DISTINCT FROM 'number' OR jsonb_typeof(p_config->'radiusMeters') IS DISTINCT FROM 'number' OR (p_config->>'latitude')::numeric NOT BETWEEN -90 AND 90 OR (p_config->>'longitude')::numeric NOT BETWEEN -180 AND 180 OR (p_config->>'radiusMeters')::numeric NOT BETWEEN 25 AND 100000) THEN RAISE EXCEPTION 'Invalid geofence coordinates/radius' USING ERRCODE='22023'; END IF;
 INSERT INTO private.darb_alert_rules(organization_id,vehicle_id,rule_type,name,config,enabled,created_by)
 VALUES(v_org,p_vehicle_id,p_type,trim(p_name),p_config,coalesce(p_enabled,true),v_user)
 RETURNING * INTO v_row;
 RETURN jsonb_build_object('id',v_row.id,'vehicle_id',v_row.vehicle_id,'rule_type',v_row.rule_type,'name',v_row.name,'config',v_row.config,'enabled',v_row.enabled,'created_at',v_row.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_list_alerts(text,uuid,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.darb_api_acknowledge_alert(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.darb_api_resolve_alert(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.darb_api_list_alert_rules(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.darb_api_create_alert_rule(uuid,text,text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.darb_api_list_alerts(text,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_acknowledge_alert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_resolve_alert(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_list_alert_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_create_alert_rule(uuid,text,text,jsonb,boolean) TO authenticated;

-- Resolve offline alerts when devices report successful telemetry.
CREATE OR REPLACE FUNCTION private.darb_resolve_device_offline_alerts(p_device_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
 UPDATE private.darb_alerts SET status='resolved'
 WHERE alert_type='device_offline' AND details->>'deviceId'=p_device_id::text AND status IN ('open','acknowledged');
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.darb_resolve_device_offline_alerts(uuid) FROM PUBLIC,anon,authenticated;
