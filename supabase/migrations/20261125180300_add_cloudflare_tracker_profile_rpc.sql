-- Read the enrolled tracker protocol profile for HTTPS protocol adapters.
CREATE OR REPLACE FUNCTION public.darb_api_get_gps_tracker_profile(p_credential_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile jsonb;
BEGIN
  IF p_credential_hash IS NULL OR p_credential_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid tracker credential' USING ERRCODE = '28000';
  END IF;
  SELECT jsonb_build_object('protocol', d.protocol, 'timezone_offset_minutes', d.timezone_offset_minutes, 'model', d.model)
  INTO v_profile
  FROM private.darb_tracking_devices d
  WHERE d.credential_hash = p_credential_hash AND d.status = 'active';
  IF v_profile IS NULL THEN RAISE EXCEPTION 'Tracker credential invalid or revoked' USING ERRCODE = '28000'; END IF;
  RETURN v_profile;
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_get_gps_tracker_profile(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.darb_api_get_gps_tracker_profile(text) TO service_role;
