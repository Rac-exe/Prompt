-- Code Intelligence rebuild: hierarchy, multi-vector search, feedback, and pinpoint fields.

CREATE EXTENSION IF NOT EXISTS vector;

SET maintenance_work_mem = '64MB';

-- ─── code_chunks additive columns ───────────────────────────────────────────

ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES code_chunks(id) ON DELETE SET NULL;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS sibling_ids uuid[] DEFAULT '{}';
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS context_header text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS context_before text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS context_after text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS parent_summary text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS summary_code text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS summary_purpose text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS embedding_summary vector(1536);
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS embedding_structure vector(1536);
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS scope_type text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS chunk_index integer;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS parent_scope_name text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS probable_line_start integer;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS probable_line_end integer;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS probable_line_source text;
ALTER TABLE code_chunks ADD COLUMN IF NOT EXISTS relevance_reasoning text;

-- The legacy embedding column was reduced to vector(512) in an earlier
-- migration. The rebuilt indexer writes 1536-d vectors into both the new
-- multi-vector columns and this legacy column for fallback RPC compatibility,
-- so rebuild it at 1536 dimensions. Existing vectors are discarded because a
-- re-index regenerates them immediately.
DROP FUNCTION IF EXISTS match_code_chunks(vector, int, uuid, uuid, text);
DROP INDEX IF EXISTS idx_code_chunks_embedding;
ALTER TABLE code_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE code_chunks ADD COLUMN embedding vector(1536);

UPDATE code_chunks
SET summary_code = COALESCE(summary_code, semantic_summary),
    scope_type = COALESCE(scope_type, chunk_type)
WHERE summary_code IS NULL OR scope_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_code_chunks_parent ON code_chunks(parent_id);
CREATE INDEX IF NOT EXISTS idx_code_chunks_scope ON code_chunks(project_id, file_path, scope_type, chunk_index);
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding
    ON code_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 12, ef_construction = 48);
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding_summary
    ON code_chunks USING hnsw (embedding_summary vector_cosine_ops)
    WITH (m = 12, ef_construction = 48);
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding_structure
    ON code_chunks USING hnsw (embedding_structure vector_cosine_ops)
    WITH (m = 12, ef_construction = 48);

-- Keep generated search_vector useful after the new summary fields are populated.
DROP INDEX IF EXISTS idx_code_chunks_fts;
ALTER TABLE code_chunks DROP COLUMN IF EXISTS search_vector;
ALTER TABLE code_chunks ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(name, '') || ' ' ||
            coalesce(signature, '') || ' ' ||
            coalesce(semantic_summary, '') || ' ' ||
            coalesce(summary_code, '') || ' ' ||
            coalesce(summary_purpose, '') || ' ' ||
            coalesce(code_body, '') || ' ' ||
            coalesce(context_header, '')
        )
    ) STORED;
CREATE INDEX idx_code_chunks_fts ON code_chunks USING gin(search_vector);

-- ─── relationships ─────────────────────────────────────────────────────────

ALTER TABLE code_relationships DROP CONSTRAINT IF EXISTS code_relationships_relationship_type_check;
ALTER TABLE code_relationships ADD CONSTRAINT code_relationships_relationship_type_check
    CHECK (relationship_type IN (
        'calls', 'imports', 'inherits', 'implements',
        'parent_of', 'child_of', 'sibling_next'
    ));

-- ─── feedback ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retrieval_searches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    query_text text NOT NULL,
    mode text NOT NULL CHECK (mode IN ('find', 'ask', 'bug', 'optimize')),
    query_embedding vector(1536),
    retrieved_chunk_ids uuid[] DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_searches_project
    ON retrieval_searches(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retrieval_searches_embedding
    ON retrieval_searches USING hnsw (query_embedding vector_cosine_ops)
    WITH (m = 12, ef_construction = 48);

CREATE TABLE IF NOT EXISTS retrieval_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    search_id uuid REFERENCES retrieval_searches(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    query_text text,
    mode text NOT NULL CHECK (mode IN ('find', 'ask', 'bug', 'optimize')),
    retrieved_chunk_ids uuid[] DEFAULT '{}',
    selected_chunk_ids uuid[] DEFAULT '{}',
    was_useful boolean,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_project ON retrieval_feedback(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_search ON retrieval_feedback(search_id);

ALTER TABLE retrieval_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on retrieval_searches" ON retrieval_searches;
CREATE POLICY "Service role full access on retrieval_searches"
    ON retrieval_searches FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access on retrieval_feedback" ON retrieval_feedback;
CREATE POLICY "Service role full access on retrieval_feedback"
    ON retrieval_feedback FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON retrieval_searches TO service_role;
GRANT ALL ON retrieval_feedback TO service_role;

-- ─── multi-vector RPCs ──────────────────────────────────────────────────────

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

DROP FUNCTION IF EXISTS match_code_chunks_multi(vector, vector, int, uuid, uuid, text, float, float);
CREATE OR REPLACE FUNCTION match_code_chunks_multi(
    query_embedding_summary vector(1536),
    query_embedding_structure vector(1536),
    match_count int DEFAULT 10,
    filter_project_id uuid DEFAULT NULL,
    filter_user_id uuid DEFAULT NULL,
    filter_branch text DEFAULT NULL,
    summary_weight float DEFAULT 0.65,
    structure_weight float DEFAULT 0.35
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
        (
            summary_weight * (1 - (cc.embedding_summary <=> query_embedding_summary)) +
            structure_weight * (1 - (cc.embedding_structure <=> query_embedding_structure))
        )::float AS similarity,
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
        AND cc.embedding_summary IS NOT NULL
        AND cc.embedding_structure IS NOT NULL
    ORDER BY similarity DESC
    LIMIT match_count;
$$;

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
    summary_code text,
    summary_purpose text,
    code_body text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    observation_count integer,
    is_exported boolean,
    rank real,
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
        cc.observation_count,
        cc.is_exported,
        ts_rank(cc.search_vector, websearch_to_tsquery('english', split_identifiers(search_query))) AS rank,
        cc.parent_id,
        cc.context_header,
        cc.parent_summary
    FROM code_chunks cc
    WHERE
        cc.search_vector @@ websearch_to_tsquery('english', split_identifiers(search_query))
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY rank DESC
    LIMIT match_count;
$$;

DROP FUNCTION IF EXISTS search_by_concepts(text[], int, uuid, uuid);
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
    summary_code text,
    summary_purpose text,
    code_body text,
    concepts text[],
    branch text,
    branch_diverged boolean,
    observation_count integer,
    is_exported boolean,
    concept_overlap integer,
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
        cc.observation_count,
        cc.is_exported,
        cardinality(ARRAY(
            SELECT unnest(cc.concepts) INTERSECT SELECT unnest(filter_concepts)
        )) AS concept_overlap,
        cc.parent_id,
        cc.context_header,
        cc.parent_summary
    FROM code_chunks cc
    WHERE
        cc.concepts && filter_concepts
        AND (filter_project_id IS NULL OR cc.project_id = filter_project_id)
        AND (filter_user_id IS NULL OR cc.user_id = filter_user_id)
    ORDER BY concept_overlap DESC, cc.observation_count DESC
    LIMIT match_count;
$$;

DROP FUNCTION IF EXISTS search_chunks_by_file_paths(uuid, uuid, text[], int);
CREATE OR REPLACE FUNCTION search_chunks_by_file_paths(
    p_project_id uuid,
    p_user_id uuid,
    p_file_patterns text[],
    p_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid, project_id uuid, file_path text, start_line integer,
    end_line integer, chunk_type text, name text, signature text,
    language text, semantic_summary text, summary_code text, summary_purpose text,
    code_body text, concepts text[], branch text, branch_diverged boolean,
    observation_count integer, is_exported boolean, parent_id uuid,
    context_header text, parent_summary text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT cc.id, cc.project_id, cc.file_path, cc.start_line,
           cc.end_line, cc.chunk_type, cc.name, cc.signature,
           cc.language, COALESCE(cc.summary_code, cc.semantic_summary),
           cc.summary_code, cc.summary_purpose, cc.code_body,
           cc.concepts, cc.branch, cc.branch_diverged,
           cc.observation_count, cc.is_exported, cc.parent_id,
           cc.context_header, cc.parent_summary
    FROM code_chunks cc
    WHERE cc.project_id = p_project_id
      AND cc.user_id = p_user_id
      AND cc.file_path ILIKE ANY(p_file_patterns)
    ORDER BY cc.is_exported DESC, cc.observation_count DESC
    LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION match_code_chunks_multi TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks_multi TO service_role;
GRANT EXECUTE ON FUNCTION match_code_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks TO service_role;
GRANT EXECUTE ON FUNCTION search_code_chunks_text TO authenticated;
GRANT EXECUTE ON FUNCTION search_code_chunks_text TO service_role;
GRANT EXECUTE ON FUNCTION search_by_concepts TO authenticated;
GRANT EXECUTE ON FUNCTION search_by_concepts TO service_role;
GRANT EXECUTE ON FUNCTION search_chunks_by_file_paths TO authenticated;
GRANT EXECUTE ON FUNCTION search_chunks_by_file_paths TO service_role;

RESET maintenance_work_mem;
