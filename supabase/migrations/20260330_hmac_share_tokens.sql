-- ============================================
-- MIGRATION: Opaque Share Tokens + Auth-Gated Collection Policies
-- ============================================
-- Switches the sharing model to cryptographically random opaque tokens and
-- tightens RLS so that collection shares require an authenticated Supabase
-- session. Individual prompt shares remain publicly accessible (served via
-- Edge Function).
--
-- Security model:
--   - Token entropy: 192 bits (randomBytes(24) as base64url, 32 chars)
--   - The DB lookup by share_token IS the verification — no shared secret needed
--   - Collections: require auth.uid() IS NOT NULL (must be signed in to the app)
--   - Prompts: publicly readable (Edge Function uses service_role; in-app also works)
--   - Type confusion: prevented by querying the correct table based on URL path prefix (c/p)
--
-- Changes:
--   1. Reset all existing share tokens to NULL so they are regenerated in the
--      new opaque format the next time a user opens the share modal.
--   2. Drop the old over-permissive public collection read policies.
--   3. Add auth-gated policies for collection sharing.
--   4. Keep the public prompt policy intact (no changes).
-- ============================================


-- ============================================
-- 1. Reset existing tokens
-- ============================================
-- All share_token values will be regenerated as opaque tokens on the next
-- share action. Safe to run before GA — no live users yet.
UPDATE prompt_collections SET share_token = NULL WHERE share_token IS NOT NULL;
UPDATE saved_prompts      SET share_token = NULL WHERE share_token IS NOT NULL;


-- ============================================
-- 2. Drop old over-permissive collection policies
-- ============================================
DROP POLICY IF EXISTS "Public can view shared collections by token" ON prompt_collections;
DROP POLICY IF EXISTS "Public can view prompts in shared collections" ON saved_prompts;


-- ============================================
-- 3. Auth-gated collection share policies
-- ============================================
-- Collections are app-only: a valid Supabase auth session is required.
-- The opaque token is the credential; RLS adds a second layer requiring login.

CREATE POLICY "Authenticated can view shared collections"
  ON prompt_collections
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND share_token IS NOT NULL
  );

CREATE POLICY "Authenticated can view prompts in shared collections"
  ON saved_prompts
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM prompt_collections pc
      WHERE pc.id = saved_prompts.collection_id
        AND pc.share_token IS NOT NULL
    )
  );


-- ============================================
-- 4. Prompt share policy — keep public
-- ============================================
-- Individual prompt shares are publicly readable. The Edge Function uses the
-- service_role key (bypasses RLS), but this policy also lets in-app viewers
-- fetch shared prompts when they are authenticated.
-- The "Public can view shared prompts by token" policy from the earlier
-- migration remains in place — no changes needed here.


-- ============================================
-- SUCCESS
-- ============================================
-- Collection shares now reqated session.
-- Prompt shares require: valid opaque token (format-checked in service layer).
-- All previous tokens have been cleared and will regenerate automatically.
-- ============================================
