-- Authenticated organization picker for web/mobile clients.
CREATE OR REPLACE FUNCTION public.darb_api_list_organizations()
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

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'status', o.status,
    'role', m.role,
    'created_at', o.created_at
  ) ORDER BY o.created_at DESC, o.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.organizations o
  JOIN public.organization_members m ON m.organization_id = o.id
  WHERE m.user_id = v_user AND m.status = 'active'
    AND o.status = 'active';

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.darb_api_list_organizations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darb_api_list_organizations() TO authenticated;
