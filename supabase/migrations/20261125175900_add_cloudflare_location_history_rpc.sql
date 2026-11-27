-- Scoped vehicle-location query RPC for the Free Worker API.
-- Authorization is per vehicle membership, not organization membership only.

CREATE OR REPLACE FUNCTION public.darb_api_location_points(
  p_vehicle_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 500,
  p_order_desc boolean DEFAULT false,
  p_max_days integer DEFAULT 0
)
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
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from >= p_to)
     OR p_max_days < 0 OR p_max_days > 365 THEN
    RAISE EXCEPTION 'Invalid history range or limit' USING ERRCODE = '22023';
  END IF;
  IF p_max_days > 0 AND p_from IS NOT NULL AND p_to IS NOT NULL
     AND p_to - p_from > make_interval(days => p_max_days) THEN
    RAISE EXCEPTION 'Date range exceeds allowed maximum' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY
      CASE WHEN p_order_desc THEN q.recorded_at END DESC,
      CASE WHEN NOT p_order_desc THEN q.recorded_at END ASC,
      CASE WHEN p_order_desc THEN q.id END DESC,
      CASE WHEN NOT p_order_desc THEN q.id END ASC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT l.id, l.vehicle_id, l.latitude, l.longitude, l.speed_kmh, l.heading,
           l.recorded_at, l.received_at
    FROM public.vehicle_locations l
    WHERE l.vehicle_id = p_vehicle_id
      AND (p_from IS NULL OR l.recorded_at >= p_from)
      AND (p_to IS NULL OR l.recorded_at <= p_to)
    ORDER BY
      CASE WHEN p_order_desc THEN l.recorded_at END DESC,
      CASE WHEN NOT p_order_desc THEN l.recorded_at END ASC,
      CASE WHEN p_order_desc THEN l.id END DESC,
      CASE WHEN NOT p_order_desc THEN l.id END ASC
    LIMIT p_limit
  ) q;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_location_points(uuid, timestamptz, timestamptz, integer, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_location_points(uuid, timestamptz, timestamptz, integer, boolean, integer) TO authenticated;
