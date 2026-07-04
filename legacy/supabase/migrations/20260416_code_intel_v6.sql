-- Code Intelligence v6: project summary, improved index_status,
-- server-side stale cleanup, and file-path search.

-- 1. Project summary columns
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_summary text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tech_stack jsonb DEFAULT '{}';

-- 2. Update index_status CHECK to allow "partial" and "error"
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_index_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_index_status_check
    CHECK (index_status IN ('indexing', 'ready', 'stale', 'partial', 'error'));

-- 3. SQL function for stale chunk cleanup (replaces Python-side set diff)
CREATE OR REPLACE FUNCTION cleanup_stale_chunks(
    p_project_id uuid,
    p_valid_keys jsonb  -- array of {"f": file_path, "n": name, "t": chunk_type}
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count integer;
BEGIN
    -- Delete relationships for stale chunks first
    WITH valid AS (
        SELECT
            v->>'f' AS file_path,
            v->>'n' AS name,
            v->>'t' AS chunk_type
        FROM jsonb_array_elements(p_valid_keys) AS v
    ),
    stale AS (
        SELECT cc.id FROM code_chunks cc
        WHERE cc.project_id = p_project_id
        AND NOT EXISTS (
            SELECT 1 FROM valid v
            WHERE v.file_path = cc.file_path
            AND v.name = cc.name
            AND v.chunk_type = cc.chunk_type
        )
    )
    DELETE FROM code_relationships
    WHERE from_chunk_id IN (SELECT id FROM stale)
       OR to_chunk_id IN (SELECT id FROM stale);

    -- Delete the stale chunks themselves
    WITH valid AS (
        SELECT v->>'f' AS file_path, v->>'n' AS name, v->>'t' AS chunk_type
        FROM jsonb_array_elements(p_valid_keys) AS v
    )
    DELETE FROM code_chunks cc
    WHERE cc.project_id = p_project_id
    AND NOT EXISTS (
        SELECT 1 FROM valid v
        WHERE v.file_path = cc.file_path
        AND v.name = cc.name
        AND v.chunk_type = cc.chunk_type
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_stale_chunks TO service_role;

-- 4. File-path search helper (for query preprocessor file path matches)
CREATE OR REPLACE FUNCTION search_chunks_by_file_paths(
    p_project_id uuid,
    p_user_id uuid,
    p_file_patterns text[],
    p_limit int DEFAULT 20
)
RETURNS TABLE (
    id uuid, project_id uuid, file_path text, start_line integer,
    end_line integer, chunk_type text, name text, signature text,
    language text, semantic_summary text, code_body text,
    concepts text[], branch text, branch_diverged boolean,
    observation_count integer, is_exported boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT cc.id, cc.project_id, cc.file_path, cc.start_line,
           cc.end_line, cc.chunk_type, cc.name, cc.signature,
           cc.language, cc.semantic_summary, cc.code_body,
           cc.concepts, cc.branch, cc.branch_diverged,
           cc.observation_count, cc.is_exported
    FROM code_chunks cc
    WHERE cc.project_id = p_project_id
      AND cc.user_id = p_user_id
      AND cc.file_path ILIKE ANY(p_file_patterns)
    ORDER BY cc.is_exported DESC, cc.observation_count DESC
    LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION search_chunks_by_file_paths TO authenticated;
GRANT EXECUTE ON FUNCTION search_chunks_by_file_paths TO service_role;
