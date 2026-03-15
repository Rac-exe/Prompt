-- ============================================
-- MIGRATION: Add share tokens to individual saved prompts
-- ============================================

-- Add share_token column to saved_prompts
ALTER TABLE saved_prompts
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;

-- Fast lookup index for /share/prompt/:token
CREATE INDEX IF NOT EXISTS idx_saved_prompts_share_token
  ON saved_prompts(share_token)
  WHERE share_token IS NOT NULL;

-- ============================================
-- RLS: allow anyone to read a prompt by share token
-- ============================================

-- Anyone can view a prompt that has a share_token set
CREATE POLICY "Public can view shared prompts by token"
  ON saved_prompts
  FOR SELECT
  USING (share_token IS NOT NULL);

-- ============================================
-- SUCCESS
-- ============================================
-- New column:  saved_prompts.share_token (TEXT UNIQUE, nullable)
-- New policy:  public SELECT when share_token IS NOT NULL
-- ============================================
