-- ============================================================
-- Graph Architecture Migration — run once in Supabase SQL editor
-- ============================================================

-- 1a. communities table
CREATE TABLE IF NOT EXISTS communities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
  level             INT NOT NULL DEFAULT 0,
  label             TEXT,
  summary           TEXT,
  summary_embedding VECTOR(1536),
  member_count      INT DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename='communities' AND indexname='communities_summary_embedding_idx'
  ) THEN
    CREATE INDEX communities_summary_embedding_idx
      ON communities USING ivfflat (summary_embedding vector_cosine_ops) WITH (lists = 50);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS communities_project_level_idx ON communities (project_id, level);

-- 1b. code_chunks additions
ALTER TABLE code_chunks
  ADD COLUMN IF NOT EXISTS community_id       UUID REFERENCES communities(id),
  ADD COLUMN IF NOT EXISTS pagerank_score     FLOAT DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS centrality_score   FLOAT DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS concept_embedding_1 VECTOR(1536),
  ADD COLUMN IF NOT EXISTS concept_embedding_2 VECTOR(1536),
  ADD COLUMN IF NOT EXISTS concept_embedding_3 VECTOR(1536);

CREATE INDEX IF NOT EXISTS code_chunks_pagerank_idx
  ON code_chunks (project_id, pagerank_score DESC);
CREATE INDEX IF NOT EXISTS code_chunks_community_idx
  ON code_chunks (community_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename='code_chunks' AND indexname='code_chunks_concept1_idx'
  ) THEN
    CREATE INDEX code_chunks_concept1_idx
      ON code_chunks USING ivfflat (concept_embedding_1 vector_cosine_ops) WITH (lists = 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename='code_chunks' AND indexname='code_chunks_concept2_idx'
  ) THEN
    CREATE INDEX code_chunks_concept2_idx
      ON code_chunks USING ivfflat (concept_embedding_2 vector_cosine_ops) WITH (lists = 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename='code_chunks' AND indexname='code_chunks_concept3_idx'
  ) THEN
    CREATE INDEX code_chunks_concept3_idx
      ON code_chunks USING ivfflat (concept_embedding_3 vector_cosine_ops) WITH (lists = 100);
  END IF;
END $$;

-- 1c. code_relationships additions
ALTER TABLE code_relationships
  ADD COLUMN IF NOT EXISTS relationship_summary   TEXT,
  ADD COLUMN IF NOT EXISTS relationship_embedding VECTOR(1536);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename='code_relationships' AND indexname='code_relationships_embedding_idx'
  ) THEN
    CREATE INDEX code_relationships_embedding_idx
      ON code_relationships USING ivfflat (relationship_embedding vector_cosine_ops) WITH (lists = 50);
  END IF;
END $$;

-- 1d. RPC: search community reports by embedding similarity
CREATE OR REPLACE FUNCTION match_community_reports(
  query_embedding   VECTOR(1536),
  filter_project_id UUID,
  match_count       INT DEFAULT 5
) RETURNS TABLE (
  id           UUID,
  label        TEXT,
  summary      TEXT,
  member_count INT,
  similarity   FLOAT
) AS $$
  SELECT id, label, summary, member_count,
         1 - (summary_embedding <=> query_embedding) AS similarity
  FROM communities
  WHERE project_id = filter_project_id
    AND summary_embedding IS NOT NULL
  ORDER BY summary_embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- 1e. RPC: search chunks by concept embeddings (best of 3 concept vectors)
CREATE OR REPLACE FUNCTION match_concept_embeddings(
  query_embedding   VECTOR(1536),
  filter_project_id UUID,
  match_count       INT DEFAULT 20
) RETURNS TABLE (
  id                UUID,
  name              TEXT,
  file_path         TEXT,
  community_id      UUID,
  pagerank_score    FLOAT,
  concept_similarity FLOAT
) AS $$
  SELECT DISTINCT ON (cc.id)
    cc.id,
    cc.name,
    cc.file_path,
    cc.community_id,
    cc.pagerank_score,
    GREATEST(
      CASE WHEN cc.concept_embedding_1 IS NOT NULL
           THEN 1 - (cc.concept_embedding_1 <=> query_embedding) ELSE 0 END,
      CASE WHEN cc.concept_embedding_2 IS NOT NULL
           THEN 1 - (cc.concept_embedding_2 <=> query_embedding) ELSE 0 END,
      CASE WHEN cc.concept_embedding_3 IS NOT NULL
           THEN 1 - (cc.concept_embedding_3 <=> query_embedding) ELSE 0 END
    ) AS concept_similarity
  FROM code_chunks cc
  WHERE cc.project_id = filter_project_id
  ORDER BY cc.id, concept_similarity DESC
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- 1f. RPC: get community members ordered by PageRank
CREATE OR REPLACE FUNCTION get_community_members(
  p_community_id UUID,
  p_limit        INT DEFAULT 20
) RETURNS TABLE (
  id             UUID,
  name           TEXT,
  file_path      TEXT,
  start_line     INT,
  end_line       INT,
  chunk_type     TEXT,
  language       TEXT,
  summary_code   TEXT,
  summary_purpose TEXT,
  concepts       TEXT[],
  pagerank_score FLOAT,
  is_exported    BOOLEAN
) AS $$
  SELECT
    id, name, file_path, start_line, end_line,
    chunk_type, language, summary_code, summary_purpose,
    concepts, pagerank_score, is_exported
  FROM code_chunks
  WHERE community_id = p_community_id
  ORDER BY pagerank_score DESC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;

-- 1g. RPC: get all chunks with graph columns for a project (used by graph builder)
CREATE OR REPLACE FUNCTION get_project_chunks_for_graph(
  p_project_id UUID
) RETURNS TABLE (
  id         UUID,
  name       TEXT,
  file_path  TEXT,
  chunk_type TEXT
) AS $$
  SELECT id, name, file_path, chunk_type
  FROM code_chunks
  WHERE project_id = p_project_id;
$$ LANGUAGE SQL STABLE;

-- 1h. RPC: get all relationships for a project (used by graph builder)
CREATE OR REPLACE FUNCTION get_project_relationships(
  p_project_id UUID
) RETURNS TABLE (
  id                UUID,
  from_chunk_id     UUID,
  to_chunk_id       UUID,
  relationship_type TEXT
) AS $$
  SELECT id, from_chunk_id, to_chunk_id, relationship_type
  FROM code_relationships
  WHERE project_id = p_project_id;
$$ LANGUAGE SQL STABLE;
