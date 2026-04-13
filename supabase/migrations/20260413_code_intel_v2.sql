-- Code Intelligence V2: code bodies, concept tagging, hybrid search, observation tracking
-- Adds code_body, concepts, observation_count columns; full-text search index;
-- updates match_code_chunks RPC; adds text search RPC; adds observation increment RPC.

-- Supabase defaults maintenance_work_mem to 32 MB which is too small for
-- building GIN/IVFFlat indexes. Raise it for this migration only.
SET maintenance_work_mem = '256MB';

-- ─── NEW COLUMNS ON code_chunks ─────────────────────────────────────────────

ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS code_body text;

ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS concepts text[] DEFAULT '{}';

ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS observation_count integer NOT NULL DEFAULT 0;

-- ─── FIX index_status CHECK ─────────────────────────────────────────────────
-- Workers write 'error' and 'partial' but the constraint only allowed 3 values.

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_index_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_index_status_check
    CHECK (index_status IN ('indexing', 'ready', 'stale', 'error', 'partial'));

-- ─── FULL-TEXT SEARCH (tsvector) ────────────────────────────────────────────

ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(name, '') || ' ' ||
            coalesce(signature, '') || ' ' ||
            coalesce(semantic_summary, '') || ' ' ||
            coalesce(code_body, '')
        )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_code_chunks_fts
    ON code_chunks USING gin(search_vector);

-- ─── CONCEPTS GIN INDEX ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_code_chunks_concepts
    ON code_chunks USING gin(concepts);

-- ─── OBSERVATION COUNT INDEX (for reranking hot paths) ──────────────────────

CREATE INDEX IF NOT EXISTS idx_code_chunks_observation
    ON code_chunks(project_id, observation_count DESC);

-- ─── UPDATED match_code_chunks RPC ──────────────────────────────────────────
-- Now returns code_body, concepts, and real observation_count.
-- Must drop first because the return type changed (new OUT columns).

DROP FUNCTION IF EXISTS match_code_chunks(vector, int, uuid, uuid, text);

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

-- ─── TEXT SEARCH RPC ────────────────────────────────────────────────────────
-- Keyword/full-text search for hybrid retrieval (complements vector search).

DROP FUNCTION IF EXISTS search_code_chunks_text(text, int, uuid, uuid);

CREATE OR REPLACE FUNCTION search_code_chunks_text(
    search_query text,
    match_count int DEFAULT 10,
    filter_project_id uuid DEFAULT NULL,
    filter_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    project_id uuid,
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
    observation_count integer,
    rank real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        cc.id,
        cc.project_id,
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
        cc.observation_count,
        ts_rank(cc.search_vector, websearch_to_tsquery('english', search_query)) AS rank
    FROM code_chunks cc
    WHERE
        cc.search_vector @@ websearch_to_tsquery('english', search_query)
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY rank DESC
    LIMIT match_count;
$$;

-- ─── INCREMENT OBSERVATION COUNT RPC ────────────────────────────────────────
-- Atomically bumps observation_count for a set of chunk IDs.

DROP FUNCTION IF EXISTS increment_observation_counts(uuid[]);

CREATE OR REPLACE FUNCTION increment_observation_counts(chunk_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE code_chunks
    SET observation_count = observation_count + 1
    WHERE id = ANY(chunk_ids);
$$;

-- ─── GRANTS ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION search_code_chunks_text TO authenticated;
GRANT EXECUTE ON FUNCTION search_code_chunks_text TO service_role;

GRANT EXECUTE ON FUNCTION increment_observation_counts TO service_role;

-- Reset to default so we don't affect other migrations or sessions.
RESET maintenance_work_mem;
