-- Returns true if the currently logged-in user has an encrypted_password set
-- in auth.users. This is needed because Supabase admin API sets the password
-- hash directly but does NOT add an email identity row to auth.identities for
-- OAuth accounts, so the JS client's getIdentities() cannot detect it.

CREATE OR REPLACE FUNCTION public.user_has_email_password()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT (encrypted_password IS NOT NULL AND encrypted_password <> '')
  FROM auth.users
  WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.user_has_email_password() TO authenticated;
