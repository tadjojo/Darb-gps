-- Transaction-safe organization and vehicle RPCs for the Cloudflare Free API.
-- Functions run as their owner but bind all authorization to auth.uid().
-- Execute privileges are restricted to authenticated clients.

CREATE OR REPLACE FUNCTION public.darb_api_create_organization(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org public.organizations;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 1 OR length(trim(p_name)) > 150 THEN
    RAISE EXCEPTION 'Organization name must be 1..150 characters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organizations (name, created_by)
  VALUES (trim(p_name), v_user)
  RETURNING * INTO v_org;

  INSERT INTO public.organization_members (organization_id, user_id, role, status)
  VALUES (v_org.id, v_user, 'org_admin', 'active');

  RETURN jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'status', v_org.status,
    'created_at', v_org.created_at,
    'created_by', v_org.created_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_create_vehicle(
  p_organization_id uuid,
  p_display_name text,
  p_registration_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_org_role text;
  v_vehicle public.vehicles;
  v_vehicle_role text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL
     OR p_display_name IS NULL
     OR length(trim(p_display_name)) < 1
     OR length(trim(p_display_name)) > 100
     OR (p_registration_number IS NOT NULL AND length(trim(p_registration_number)) > 30) THEN
    RAISE EXCEPTION 'Invalid vehicle fields' USING ERRCODE = '22023';
  END IF;

  SELECT m.role INTO v_org_role
  FROM public.organization_members m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = v_user
    AND m.status = 'active'
  FOR SHARE;

  IF v_org_role IS NULL THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_org_role NOT IN ('org_admin', 'fleet_supervisor') THEN
    RAISE EXCEPTION 'Insufficient organization permissions' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.vehicles (organization_id, display_name, registration_number)
  VALUES (p_organization_id, trim(p_display_name), nullif(trim(coalesce(p_registration_number, '')), ''))
  RETURNING * INTO v_vehicle;

  v_vehicle_role := CASE WHEN v_org_role = 'org_admin' THEN 'owner' ELSE 'manager' END;

  INSERT INTO public.vehicle_members (vehicle_id, user_id, role, status)
  VALUES (v_vehicle.id, v_user, v_vehicle_role, 'active');

  RETURN jsonb_build_object(
    'id', v_vehicle.id,
    'organization_id', v_vehicle.organization_id,
    'display_name', v_vehicle.display_name,
    'registration_number', v_vehicle.registration_number,
    'status', v_vehicle.status,
    'created_at', v_vehicle.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_list_vehicles(p_organization_id uuid)
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
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = v_user AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', v.id,
    'display_name', v.display_name,
    'registration_number', v.registration_number,
    'driver_name', v.driver_name,
    'status', v.status,
    'created_at', v.created_at
  ) ORDER BY v.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.vehicles v
  WHERE v.organization_id = p_organization_id;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_create_organization(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.darb_api_create_vehicle(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.darb_api_list_vehicles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_create_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_create_vehicle(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_list_vehicles(uuid) TO authenticated;
