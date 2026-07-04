-- Code Intelligence V3: camelCase/snake_case splitting for full-text search
-- Adds split_identifiers() helper, rebuilds search_vector generated column,
-- and updates the search_code_chunks_text RPC to split the query too.

SET maintenance_work_mem = '256MB';

-- ─── IDENTIFIER SPLITTING FUNCTION ─────────────────────────────────────────
-- Inserts spaces at camelCase boundaries, replaces underscores and dots
-- with spaces so that "getUserChannelSubscribers" becomes
-- "get User Channel Subscribers" and "toggle_video_like" becomes
-- "toggle video like".

CREATE OR REPLACE FUNCTION split_identifiers(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT regexp_replace(
        regexp_replace(
            regexp_replace(input, '([a-z])([A-Z])', '\1 \2', 'g'),
            '_', ' ', 'g'),
        '\.', ' ', 'g')
$$;

-- ─── REBUILD search_vector GENERATED COLUMN ────────────────────────────────
-- The old column used to_tsvector on raw identifiers which could not match
-- sub-words in camelCase names. Now name and signature go through
-- split_identifiers() so individual words become searchable tokens.
-- semantic_summary and code_body stay unsplit (already natural language).

ALTER TABLE code_chunks DROP COLUMN IF EXISTS search_vector;

ALTER TABLE code_chunks ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            split_identifiers(coalesce(name, '')) || ' ' ||
            coalesce(name, '') || ' ' ||
            split_identifiers(coalesce(signature, '')) || ' ' ||
            coalesce(semantic_summary, '') || ' ' ||
            coalesce(code_body, '')
        )
    ) STORED;

-- Recreate the GIN index on the new column
DROP INDEX IF EXISTS idx_code_chunks_fts;
CREATE INDEX idx_code_chunks_fts ON code_chunks USING gin(search_vector);

-- ─── UPDATED TEXT SEARCH RPC ───────────────────────────────────────────────
-- Now also runs split_identifiers on the search query so that
-- "getUserSubscribers" in the query matches the split tokens.

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

GRANT EXECUTE ON FUNCTION split_identifiers TO authenticated;
GRANT EXECUTE ON FUNCTION split_identifiers TO service_role;

GRANT EXECUTE ON FUNCTION search_code_chunks_text TO authenticated;
GRANT EXECUTE ON FUNCTION search_code_chunks_text TO service_role;

RESET maintenance_work_mem;
