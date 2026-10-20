-- Repair legacy code_chunks.embedding after the code intelligence rebuild.
-- Some databases already have code_chunks.embedding as vector(512) from the
-- earlier dimension-reduction migration, while the rebuilt indexer now writes
-- 1536-d vectors for fallback compatibility.

CREATE EXTENSION IF NOT EXISTS vector;

SET maintenance_work_mem = '64MB';

DROP FUNCTION IF EXISTS match_code_chunks(vector, int, uuid, uuid, text);
DROP INDEX IF EXISTS idx_code_chunks_embedding;

-- Existing legacy embeddings are intentionally discarded. The active indexer
-- repopulates this column during the next re-index.
ALTER TABLE code_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE code_chunks ADD COLUMN embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding
    ON code_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 12, ef_construction = 48);

CREATE OR REPLACE FUNCTION match_code_chunks(
    query_embedding vector(1536),
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
    summary_code text,
    summary_purpose text,
    code_body text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    content_hash text,
    similarity float,
    observation_count integer,
    is_exported boolean,
    parent_id uuid,
    context_header text,
    parent_summary text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        COALESCE(cc.summary_code, cc.semantic_summary) AS semantic_summary,
        cc.summary_code,
        cc.summary_purpose,
        cc.code_body,
        cc.concepts,
        cc.branch,
        cc.branch_diverged,
        cc.content_hash,
        (1 - (cc.embedding <=> query_embedding))::float AS similarity,
        cc.observation_count,
        cc.is_exported,
        cc.parent_id,
        cc.context_header,
        cc.parent_summary
    FROM code_chunks cc
    WHERE
        (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
        AND (filter_branch IS NULL OR cc.branch = filter_branch OR cc.branch IS NULL)
        AND cc.embedding IS NOT NULL
    ORDER BY cc.embedding <=> query_embedding
    LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION match_code_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks TO service_role;

RESET maintenance_work_mem;
