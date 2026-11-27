-- Efficient paginated latest-location snapshots for the static fleet dashboard.
-- Organization membership gates vehicle enumeration; each row includes location
-- data only when the caller also has active vehicle membership.
DROP FUNCTION IF EXISTS public.darb_api_latest_locations_for_organization(uuid);
CREATE OR REPLACE FUNCTION public.darb_api_latest_locations_for_organization(
  p_organization_id uuid,
  p_limit integer DEFAULT 250,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_rows jsonb;
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 500 OR p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000 THEN
    RAISE EXCEPTION 'Invalid pagination parameters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = v_user
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Organization not found' USING ERRCODE = 'P0002';
  END IF;

  WITH page AS (
    SELECT v.id, v.created_at
    FROM public.vehicles v
    WHERE v.organization_id = p_organization_id
      AND v.status = 'active'
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT count(*)::integer, coalesce(jsonb_agg(
    jsonb_build_object(
      'vehicle_id', page.id,
      'location', latest.location
    ) ORDER BY page.created_at DESC, page.id DESC
  ), '[]'::jsonb)
  INTO v_count, v_rows
  FROM page
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'latitude', l.latitude,
      'longitude', l.longitude,
      'speed_kmh', l.speed_kmh,
      'heading', l.heading,
      'recorded_at', l.recorded_at
    ) AS location
    FROM public.vehicle_locations l
    WHERE l.vehicle_id = page.id
      AND EXISTS (
        SELECT 1 FROM public.vehicle_members vm
        WHERE vm.vehicle_id = page.id
          AND vm.user_id = v_user
          AND vm.status = 'active'
      )
    ORDER BY l.recorded_at DESC, l.id DESC
    LIMIT 1
  ) latest ON true;

  RETURN jsonb_build_object(
    'data', v_rows,
    'nextOffset', CASE WHEN v_count = p_limit THEN p_offset + p_limit ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_latest_locations_for_organization(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_latest_locations_for_organization(uuid, integer, integer) TO authenticated;
