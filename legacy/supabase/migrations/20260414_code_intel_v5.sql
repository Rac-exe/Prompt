-- Code Intelligence V5: concept search RPC, export visibility, embedding strategy B
--
-- 1. search_by_concepts RPC — uses existing GIN index on concepts column
-- 2. is_exported column for export/public symbol weighting
-- 3. Null all embeddings to force re-index with strategy B (reduced code_body)
-- 4. Update match_code_chunks and search_code_chunks_text to return is_exported

SET maintenance_work_mem = '256MB';

-- ─── IS_EXPORTED COLUMN ─────────────────────────────────────────────────────

ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS is_exported boolean NOT NULL DEFAULT false;

-- ─── NULL EMBEDDINGS (force re-index with new embedding strategy) ───────────

UPDATE code_chunks SET embedding = NULL;

-- ─── CONCEPT SEARCH RPC ─────────────────────────────────────────────────────
-- Retrieves chunks matching any of the provided concept tags, ranked by
-- overlap count. Uses the existing GIN index on code_chunks(concepts).

CREATE OR REPLACE FUNCTION search_by_concepts(
    filter_concepts text[],
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
    is_exported boolean,
    concept_overlap integer
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
        cc.is_exported,
        cardinality(ARRAY(
            SELECT unnest(cc.concepts) INTERSECT SELECT unnest(filter_concepts)
        )) AS concept_overlap
    FROM code_chunks cc
    WHERE
        cc.concepts && filter_concepts
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY concept_overlap DESC, cc.observation_count DESC
    LIMIT match_count;
$$;

-- ─── UPDATE match_code_chunks TO RETURN is_exported ─────────────────────────

DROP FUNCTION IF EXISTS match_code_chunks(vector, int, uuid, uuid, text);

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
    observation_count integer,
    is_exported boolean
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
        cc.observation_count,
        cc.is_exported
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

-- ─── UPDATE search_code_chunks_text TO RETURN is_exported ───────────────────

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
    is_exported boolean,
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
        cc.is_exported,
        ts_rank(cc.search_vector, websearch_to_tsquery('english', split_identifiers(search_query))) AS rank
    FROM code_chunks cc
    WHERE
        cc.search_vector @@ websearch_to_tsquery('english', split_identifiers(search_query))
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY rank DESC
    LIMIT match_count;
$$;

-- ─── GRANTS ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION search_by_concepts TO authenticated;
GRANT EXECUTE ON FUNCTION search_by_concepts TO service_role;

GRANT EXECUTE ON FUNCTION match_code_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks TO service_role;

GRANT EXECUTE ON FUNCTION search_code_chunks_text TO authenticated;
GRANT EXECUTE ON FUNCTION search_code_chunks_text TO service_role;

RESET maintenance_work_mem;
