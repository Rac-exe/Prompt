-- Code intelligence DB I/O optimizations:
-- - trigram/composite indexes for hot lookup paths
-- - lightweight broad-recall RPCs that avoid TOAST-heavy columns

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path_trgm
    ON code_chunks USING gin(file_path gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_code_chunks_project_name
    ON code_chunks(project_id, name);

CREATE INDEX IF NOT EXISTS idx_code_relationships_project_from
    ON code_relationships(project_id, from_chunk_id);

CREATE INDEX IF NOT EXISTS idx_code_relationships_project_to
    ON code_relationships(project_id, to_chunk_id);

CREATE INDEX IF NOT EXISTS idx_code_chunks_project_created
    ON code_chunks(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_code_chunks_project_exported_obs
    ON code_chunks(project_id, is_exported DESC, observation_count DESC);

CREATE OR REPLACE FUNCTION match_code_chunks_lite(
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
    scope_type text,
    name text,
    signature text,
    language text,
    semantic_summary text,
    summary_code text,
    summary_purpose text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    similarity float,
    observation_count integer,
    is_exported boolean,
    parent_id uuid
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
        cc.scope_type,
        cc.name,
        cc.signature,
        cc.language,
        COALESCE(cc.summary_code, cc.semantic_summary) AS semantic_summary,
        cc.summary_code,
        cc.summary_purpose,
        cc.concepts,
        cc.branch,
        cc.branch_diverged,
        (1 - (cc.embedding <=> query_embedding))::float AS similarity,
        cc.observation_count,
        cc.is_exported,
        cc.parent_id
    FROM code_chunks cc
    WHERE
        (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
        AND (filter_branch IS NULL OR cc.branch = filter_branch OR cc.branch IS NULL)
        AND cc.embedding IS NOT NULL
    ORDER BY cc.embedding <=> query_embedding
    LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION search_code_chunks_text_lite(
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
    scope_type text,
    name text,
    signature text,
    language text,
    semantic_summary text,
    summary_code text,
    summary_purpose text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    observation_count integer,
    is_exported boolean,
    rank real,
    parent_id uuid
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
        cc.scope_type,
        cc.name,
        cc.signature,
        cc.language,
        COALESCE(cc.summary_code, cc.semantic_summary) AS semantic_summary,
        cc.summary_code,
        cc.summary_purpose,
        cc.concepts,
        cc.branch,
        cc.branch_diverged,
        cc.observation_count,
        cc.is_exported,
        ts_rank(cc.search_vector, websearch_to_tsquery('english', split_identifiers(search_query))) AS rank,
        cc.parent_id
    FROM code_chunks cc
    WHERE
        cc.search_vector @@ websearch_to_tsquery('english', split_identifiers(search_query))
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY rank DESC
    LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION search_by_concepts_lite(
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
    scope_type text,
    name text,
    signature text,
    language text,
    semantic_summary text,
    summary_code text,
    summary_purpose text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    observation_count integer,
    is_exported boolean,
    concept_overlap integer,
    parent_id uuid
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
        cc.scope_type,
        cc.name,
        cc.signature,
        cc.language,
        COALESCE(cc.summary_code, cc.semantic_summary) AS semantic_summary,
        cc.summary_code,
        cc.summary_purpose,
        cc.concepts,
        cc.branch,
        cc.branch_diverged,
        cc.observation_count,
        cc.is_exported,
        cardinality(ARRAY(
            SELECT unnest(cc.concepts) INTERSECT SELECT unnest(filter_concepts)
        )) AS concept_overlap,
        cc.parent_id
    FROM code_chunks cc
    WHERE
        cc.concepts && filter_concepts
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY concept_overlap DESC, cc.observation_count DESC
    LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION search_chunks_by_file_paths_lite(
    p_project_id uuid,
    p_user_id uuid,
    p_file_patterns text[],
    p_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid,
    project_id uuid,
    file_path text,
    start_line integer,
    end_line integer,
    chunk_type text,
    scope_type text,
    name text,
    signature text,
    language text,
    semantic_summary text,
    summary_code text,
    summary_purpose text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    observation_count integer,
    is_exported boolean,
    parent_id uuid
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
        cc.scope_type,
        cc.name,
        cc.signature,
        cc.language,
        COALESCE(cc.summary_code, cc.semantic_summary) AS semantic_summary,
        cc.summary_code,
        cc.summary_purpose,
        cc.concepts,
        cc.branch,
        cc.branch_diverged,
        cc.observation_count,
        cc.is_exported,
        cc.parent_id
    FROM code_chunks cc
    WHERE cc.project_id = p_project_id
      AND cc.user_id = p_user_id
      AND cc.file_path ILIKE ANY(p_file_patterns)
    ORDER BY cc.is_exported DESC, cc.observation_count DESC
    LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION match_code_chunks_lite(vector, int, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks_lite(vector, int, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION search_code_chunks_text_lite(text, int, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION search_code_chunks_text_lite(text, int, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION search_by_concepts_lite(text[], int, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION search_by_concepts_lite(text[], int, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION search_chunks_by_file_paths_lite(uuid, uuid, text[], int) TO authenticated;
GRANT EXECUTE ON FUNCTION search_chunks_by_file_paths_lite(uuid, uuid, text[], int) TO service_role;
