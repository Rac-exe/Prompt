-- Code Intelligence V4: Reduce embedding dimensions from 1536 to 512
-- text-embedding-3-small supports dimension reduction via the API.
-- 512 dims provide near-identical recall for <100k chunks while
-- cutting vector storage by 67% and speeding up cosine distance ~3x.
--
-- IMPORTANT: This migration nulls existing embeddings. A full re-index
-- is required after running this migration.

SET maintenance_work_mem = '256MB';

-- ─── DROP EXISTING MATCH RPC ────────────────────────────────────────────────
-- Must drop before altering the column type since the function signature
-- references vector(1536).

DROP FUNCTION IF EXISTS match_code_chunks(vector, int, uuid, uuid, text);

-- ─── DROP EXISTING VECTOR INDEX ─────────────────────────────────────────────

DROP INDEX IF EXISTS idx_code_chunks_embedding;

-- ─── ALTER EMBEDDING COLUMN ─────────────────────────────────────────────────
-- Changing vector dimension requires dropping and re-adding the column
-- because PostgreSQL cannot ALTER TYPE on a vector column directly.

ALTER TABLE code_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE code_chunks ADD COLUMN embedding vector(512);

-- ─── RECREATE IVFFLAT INDEX ─────────────────────────────────────────────────

CREATE INDEX idx_code_chunks_embedding ON code_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- ─── RECREATE match_code_chunks RPC WITH vector(512) ────────────────────────

CREATE OR REPLACE FUNCTION match_code_chunks(
    query_embedding vector(512),
    match_count int DEFAULT 10,
    filter_project_id uuid DEFAULT NULL,
    filter_user_id uuid DEFAULT NULL,
    filter_branch text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    project_id uuid,
    user_id uuid,
    file_path text,
    start_line integer,
    end_line integer,
    chunk_type text,
    name text,
    signature text,
    language text,
    semantic_summary text,
    code_body text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    content_hash text,
    similarity float,
    observation_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        cc.id,
        cc.project_id,
        cc.user_id,
        cc.file_path,
        cc.start_line,
        cc.end_line,
        cc.chunk_type,
        cc.name,
        cc.signature,
        cc.language,
        cc.semantic_summary,
        cc.code_body,
        cc.concepts,
        cc.branch,
        cc.branch_diverged,
        cc.content_hash,
        (1 - (cc.embedding <=> query_embedding))::float AS similarity,
        cc.observation_count
    FROM code_chunks cc
    WHERE
        (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
        AND (filter_branch IS NULL OR cc.branch = filter_branch OR cc.branch IS NULL)
        AND cc.embedding IS NOT NULL
    ORDER BY cc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- ─── GRANTS ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION match_code_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks TO service_role;

RESET maintenance_work_mem;
