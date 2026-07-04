-- Fast email existence check against auth.users
-- SECURITY DEFINER runs with the function owner's privileges (can read auth.users)
-- Protected: only callable with service_role key (RLS bypass), not with anon key
CREATE OR REPLACE FUNCTION public.check_email_exists(email_input TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users WHERE lower(email) = lower(email_input)
    );
END;
$$;

-- Revoke from public/anon so only service_role (admin client) can call it
REVOKE EXECUTE ON FUNCTION public.check_email_exists(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_email_exists(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_email_exists(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_email_exists(TEXT) TO service_role;
