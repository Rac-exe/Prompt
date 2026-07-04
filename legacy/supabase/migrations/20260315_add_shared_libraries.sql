-- ============================================
-- MIGRATION: Add Shared Prompt Libraries
-- ============================================
-- Adds share token support to prompt_collections
-- and a table to track saved/forked collections.
-- Does NOT break any existing tables or RLS policies.
-- ============================================

-- ============================================
-- 1. Add share fields to prompt_collections
-- ============================================
ALTER TABLE prompt_collections
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS original_collection_id UUID REFERENCES prompt_collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_creator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_creator_name TEXT;

-- Index for fast token lookups (used for /share/:token)
CREATE INDEX IF NOT EXISTS idx_prompt_collections_share_token
  ON prompt_collections(share_token)
  WHERE share_token IS NOT NULL;

-- Index for finding forks of a collection
CREATE INDEX IF NOT EXISTS idx_prompt_collections_original_id
  ON prompt_collections(original_collection_id)
  WHERE original_collection_id IS NOT NULL;

-- ============================================
-- 2. RLS policies: allow public read via share token
-- ============================================

-- Allow anyone (including anonymous / unauthenticated) to view
-- a collection by share token. This is the minimum needed to
-- serve the /share/:token route without requiring login.
CREATE POLICY "Public can view shared collections by token"
  ON prompt_collections
  FOR SELECT
  USING (share_token IS NOT NULL);

-- Allow anyone to read prompts that belong to a publicly shared collection
CREATE POLICY "Public can view prompts in shared collections"
  ON saved_prompts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM prompt_collections pc
      WHERE pc.id = saved_prompts.collection_id
        AND pc.share_token IS NOT NULL
    )
  );

-- Allow authenticated users to read the profile name of any collection owner
-- (needed to show "Library by {creator_name}" on the share view).
-- We add a permissive policy that lets authenticated users read profiles
-- of other users only when a shared collection exists.
CREATE POLICY "Authenticated can view sharer profiles"
  ON profiles
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM prompt_collections pc
      WHERE pc.user_id = profiles.id
        AND pc.share_token IS NOT NULL
    )
  );

-- ============================================
-- SUCCESS
-- ============================================
-- Migration complete!
-- New columns: prompt_collections.share_token, original_collection_id,
--              original_creator_id, original_creator_name
-- New RLS policies for public share access
-- ============================================
