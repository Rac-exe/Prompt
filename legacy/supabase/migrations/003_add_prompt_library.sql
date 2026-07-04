-- ============================================
-- PROMPT LIBRARY TABLES
-- ============================================
-- This migration adds persistent storage for:
-- 1. User-specific prompt collections
-- 2. Saved prompts within collections
-- ============================================

-- ============================================
-- TABLE: prompt_collections
-- ============================================
-- Stores user-created collections for organizing prompts
CREATE TABLE IF NOT EXISTS prompt_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'folder', -- Optional icon identifier
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Prevent duplicate collection names per user
  CONSTRAINT unique_collection_name_per_user UNIQUE (user_id, name)
);

-- ============================================
-- TABLE: saved_prompts
-- ============================================
-- Stores individual prompts saved by users
CREATE TABLE IF NOT EXISTS saved_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES prompt_collections(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', -- Optional: tags, source_chat, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_prompt_collections_user_id 
  ON prompt_collections(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_prompts_user_id 
  ON saved_prompts(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_prompts_collection_id 
  ON saved_prompts(collection_id);

CREATE INDEX IF NOT EXISTS idx_saved_prompts_created_at 
  ON saved_prompts(created_at DESC);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

-- Enable RLS
ALTER TABLE prompt_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_prompts ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES: prompt_collections
-- ============================================

-- Users can read their own collections
CREATE POLICY "Users can view own collections"
  ON prompt_collections
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own collections
CREATE POLICY "Users can create own collections"
  ON prompt_collections
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own collections
CREATE POLICY "Users can update own collections"
  ON prompt_collections
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own collections
CREATE POLICY "Users can delete own collections"
  ON prompt_collections
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- RLS POLICIES: saved_prompts
-- ============================================

-- Users can read their own prompts
CREATE POLICY "Users can view own prompts"
  ON saved_prompts
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own prompts
CREATE POLICY "Users can create own prompts"
  ON saved_prompts
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own prompts
CREATE POLICY "Users can update own prompts"
  ON saved_prompts
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own prompts
CREATE POLICY "Users can delete own prompts"
  ON saved_prompts
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- TRIGGER: Auto-update updated_at timestamp
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_prompt_collections_updated_at
  BEFORE UPDATE ON prompt_collections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_saved_prompts_updated_at
  BEFORE UPDATE ON saved_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- HELPER VIEW: Prompts with collection info
-- ============================================

CREATE OR REPLACE VIEW user_prompts_with_collections AS
SELECT 
  sp.id,
  sp.user_id,
  sp.collection_id,
  sp.title,
  sp.content,
  sp.metadata,
  sp.created_at,
  sp.updated_at,
  pc.name as collection_name,
  pc.icon as collection_icon
FROM saved_prompts sp
JOIN prompt_collections pc ON sp.collection_id = pc.id;

-- Grant access to the view
GRANT SELECT ON user_prompts_with_collections TO authenticated;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
-- Migration complete! 
-- Tables created: prompt_collections, saved_prompts
-- RLS enabled and policies configured
-- Indexes added for performance
-- ============================================
