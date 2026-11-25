-- Vehicle member add/revoke RPCs with explicit role constraints.
CREATE OR REPLACE FUNCTION public.darb_api_add_vehicle_member(p_vehicle_id uuid, p_user_id uuid, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_vehicle public.vehicles;
  v_caller_role text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_vehicle_id IS NULL OR p_user_id IS NULL OR p_role NOT IN ('owner','manager','driver','viewer') THEN
    RAISE EXCEPTION 'Invalid membership request' USING ERRCODE = '22023';
  END IF;
  SELECT v.* INTO v_vehicle
  FROM public.vehicles v JOIN public.vehicle_members vm ON vm.vehicle_id=v.id
  WHERE v.id=p_vehicle_id AND v.status='active' AND vm.user_id=v_user
    AND vm.status='active' AND vm.role IN ('owner','manager')
  FOR UPDATE OF v;
  IF v_vehicle.id IS NULL THEN RAISE EXCEPTION 'Vehicle not found or permission denied' USING ERRCODE = 'P0002'; END IF;
  SELECT vm.role INTO v_caller_role FROM public.vehicle_members vm
  WHERE vm.vehicle_id=p_vehicle_id AND vm.user_id=v_user AND vm.status='active';
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id=v_vehicle.organization_id AND om.user_id=p_user_id AND om.status='active'
  ) THEN RAISE EXCEPTION 'User must be an active organization member' USING ERRCODE = '42501'; END IF;
  IF v_caller_role='manager' AND p_role IN ('owner','manager') THEN
    RAISE EXCEPTION 'Only owner may appoint an owner or manager' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.vehicle_members(vehicle_id,user_id,role,status)
  VALUES(p_vehicle_id,p_user_id,p_role,'active')
  ON CONFLICT(vehicle_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active';
  RETURN jsonb_build_object('vehicleId',p_vehicle_id,'userId',p_user_id,'role',p_role,'status','active');
END;
$$;

CREATE OR REPLACE FUNCTION public.darb_api_revoke_vehicle_member(p_vehicle_id uuid,p_member_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_vehicle_id IS NULL OR p_member_user_id IS NULL THEN RAISE EXCEPTION 'Invalid membership request' USING ERRCODE = '22023'; END IF;
  IF v_user=p_member_user_id THEN RAISE EXCEPTION 'Self-removal is not allowed' USING ERRCODE = '42501'; END IF;
  SELECT vm.role INTO v_caller_role
  FROM public.vehicle_members vm JOIN public.vehicles v ON v.id=vm.vehicle_id
  WHERE vm.vehicle_id=p_vehicle_id AND vm.user_id=v_user AND vm.status='active'
    AND v.status='active' AND vm.role IN ('owner','manager')
  FOR UPDATE OF v;
  IF v_caller_role IS NULL THEN RAISE EXCEPTION 'Vehicle not found or permission denied' USING ERRCODE = 'P0002'; END IF;
  SELECT role INTO v_target_role FROM public.vehicle_members
  WHERE vehicle_id=p_vehicle_id AND user_id=p_member_user_id AND status='active'
  FOR UPDATE;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'Active vehicle membership not found' USING ERRCODE = 'P0002'; END IF;
  IF v_target_role='owner' OR (v_caller_role='manager' AND v_target_role NOT IN ('driver','viewer')) THEN
    RAISE EXCEPTION 'Insufficient permission to revoke membership' USING ERRCODE = '42501';
  END IF;
  UPDATE public.vehicle_members SET status='revoked'
  WHERE vehicle_id=p_vehicle_id AND user_id=p_member_user_id;
  PERFORM pg_notify('darb_vehicle_member_revoked',jsonb_build_object('vehicleId',p_vehicle_id,'userId',p_member_user_id)::text);
  RETURN jsonb_build_object('vehicleId',p_vehicle_id,'userId',p_member_user_id,'status','revoked');
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_add_vehicle_member(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.darb_api_revoke_vehicle_member(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_add_vehicle_member(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_revoke_vehicle_member(uuid,uuid) TO authenticated;
