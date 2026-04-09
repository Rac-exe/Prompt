-- ============================================
-- MIGRATION: Security Hardening
-- ============================================

-- ============================================
-- 1. BLOCK ROLE SELF-ELEVATION ON PROFILES
-- ============================================
-- The UPDATE policy must prevent users from changing their own role column.
-- WITH CHECK asserts the role value stays identical to what's already stored.

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        AND (role IS NOT DISTINCT FROM (SELECT p.role FROM profiles p WHERE p.id = auth.uid()))
    );

-- ============================================
-- 2. RESTRICT close_stale_sessions TO ADMINS
-- ============================================
-- Previously any authenticated user could invoke this SECURITY DEFINER
-- function and mutate every user's sessions. Now requires is_admin().

CREATE OR REPLACE FUNCTION public.close_stale_sessions(threshold_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  closed_count INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can close stale sessions';
  END IF;

  UPDATE public.app_sessions
  SET
    ended_at = now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
  WHERE ended_at IS NULL
    AND started_at < now() - (threshold_hours || ' hours')::interval;

  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

-- ============================================
-- 3. ADD MISSING DELETE/UPDATE POLICIES
-- ============================================

CREATE POLICY "Users can delete own optimizations"
    ON prompt_optimizations FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own versions"
    ON prompt_versions FOR DELETE
    USING (
        optimization_id IN (
            SELECT id FROM prompt_optimizations WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own versions"
    ON prompt_versions FOR UPDATE
    USING (
        optimization_id IN (
            SELECT id FROM prompt_optimizations WHERE user_id = auth.uid()
        )
    );

-- ============================================
-- 4. SHARED COLLECTION/PROMPT LOOKUP VIA RPC
-- ============================================
-- Provides a SECURITY DEFINER function for fetching shared collections
-- and prompts by exact token match, preventing enumeration of all
-- shared content via direct table queries.

CREATE OR REPLACE FUNCTION public.get_shared_collection(token TEXT)
RETURNS SETOF prompt_collections
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM public.prompt_collections
  WHERE share_token = token
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_collection(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shared_collection(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shared_collection_prompts(token TEXT)
RETURNS SETOF saved_prompts
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sp.* FROM public.saved_prompts sp
  INNER JOIN public.prompt_collections pc ON pc.id = sp.collection_id
  WHERE pc.share_token = token;
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_collection_prompts(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shared_collection_prompts(TEXT) TO authenticated;
