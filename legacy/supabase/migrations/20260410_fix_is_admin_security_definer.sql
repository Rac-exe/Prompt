-- Fix is_admin() infinite RLS recursion.
-- The function queries public.profiles, but it is called from an RLS policy
-- ON public.profiles. Without SECURITY DEFINER the policy evaluation
-- re-enters itself, causing PostgreSQL to abort with "permission denied".
-- Adding SECURITY DEFINER + pinned search_path makes the subquery bypass RLS
-- so the recursion never happens.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
