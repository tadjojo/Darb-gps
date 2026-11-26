-- Efficient latest-location batch read for the static fleet dashboard.
-- Organization membership gates the list; each location is returned only when
-- the caller also has active membership on that vehicle, matching the single-vehicle RPC.
CREATE OR REPLACE FUNCTION public.darb_api_latest_locations_for_organization(p_organization_id uuid)
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
      AND m.user_id = v_user
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object('vehicle_id', v.id, 'location', latest.location)
    ORDER BY v.created_at DESC
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.vehicles v
  LEFT JOIN LATERAL (
    SELECT to_jsonb(l) AS location
    FROM public.vehicle_locations l
    WHERE l.vehicle_id = v.id
      AND EXISTS (
        SELECT 1 FROM public.vehicle_members vm
        WHERE vm.vehicle_id = v.id
          AND vm.user_id = v_user
          AND vm.status = 'active'
      )
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) latest ON true
  WHERE v.organization_id = p_organization_id
    AND v.status = 'active';

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_latest_locations_for_organization(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_latest_locations_for_organization(uuid) TO authenticated;
