-- Project Context: Phase 1 + Phase 2 schema additions
-- Adds projects, code_chunks (pgvector), code_relationships, project_branches

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── PROJECTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL,
    repo_url text,
    local_path text,
    current_branch text,
    default_branch text NOT NULL DEFAULT 'main',
    index_status text NOT NULL DEFAULT 'stale'
        CHECK (index_status IN ('indexing', 'ready', 'stale')),
    last_indexed_at timestamptz,
    github_repo_owner text,
    github_repo_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_github ON projects(github_repo_owner, github_repo_name);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own projects"
    ON projects FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
    ON projects FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
    ON projects FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on projects"
    ON projects FOR ALL
    USING (auth.role() = 'service_role');

-- ─── CODE CHUNKS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_path text NOT NULL,
    start_line integer NOT NULL,
    end_line integer NOT NULL,
    chunk_type text NOT NULL
        CHECK (chunk_type IN ('file', 'class', 'function', 'method')),
    name text NOT NULL,
    signature text,
    language text NOT NULL,
    semantic_summary text,
    embedding vector(1536),
    content_hash text NOT NULL,
    branch text,
    last_modified_commit text,
    branch_diverged boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id, file_path, name, chunk_type)
);

CREATE INDEX idx_code_chunks_project_branch ON code_chunks(project_id, branch, chunk_type);
CREATE INDEX idx_code_chunks_project_file ON code_chunks(project_id, file_path);
CREATE INDEX idx_code_chunks_user ON code_chunks(user_id);

-- IVFFlat index for approximate nearest neighbor search
-- lists=100 is appropriate for up to ~100k chunks
CREATE INDEX idx_code_chunks_embedding ON code_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

ALTER TABLE code_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own code chunks"
    ON code_chunks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own code chunks"
    ON code_chunks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own code chunks"
    ON code_chunks FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own code chunks"
    ON code_chunks FOR DELETE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on code_chunks"
    ON code_chunks FOR ALL
    USING (auth.role() = 'service_role');

-- ─── CODE RELATIONSHIPS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_chunk_id uuid NOT NULL REFERENCES code_chunks(id) ON DELETE CASCADE,
    to_chunk_id uuid NOT NULL REFERENCES code_chunks(id) ON DELETE CASCADE,
    relationship_type text NOT NULL
        CHECK (relationship_type IN ('calls', 'imports', 'inherits', 'implements')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(from_chunk_id, to_chunk_id, relationship_type)
);

CREATE INDEX idx_code_relationships_from ON code_relationships(from_chunk_id, relationship_type);
CREATE INDEX idx_code_relationships_to ON code_relationships(to_chunk_id, relationship_type);
CREATE INDEX idx_code_relationships_project ON code_relationships(project_id);

ALTER TABLE code_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on code_relationships"
    ON code_relationships FOR ALL
    USING (auth.role() = 'service_role');

-- Users can read relationships for their own projects
CREATE POLICY "Users can view relationships for own projects"
    ON code_relationships FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = code_relationships.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ─── PROJECT BRANCHES (Phase 2) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_branches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    branch_name text NOT NULL,
    last_commit_sha text,
    last_commit_message text,
    ahead_of_main_by integer NOT NULL DEFAULT 0,
    behind_main_by integer NOT NULL DEFAULT 0,
    diverged_files text[] DEFAULT '{}',
    webhook_received_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id, branch_name)
);

CREATE INDEX idx_project_branches_project ON project_branches(project_id);

ALTER TABLE project_branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on project_branches"
    ON project_branches FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Users can view branches for own projects"
    ON project_branches FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_branches.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- ─── VECTOR SEARCH RPC FUNCTION ─────────────────────────────────────────────
-- Called by the Code Intelligence Service for semantic retrieval
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
    branch text,
    branch_diverged boolean,
    content_hash text,
    similarity float,
    observation_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
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
        cc.branch,
        cc.branch_diverged,
        cc.content_hash,
        1 - (cc.embedding <=> query_embedding) AS similarity,
        1::bigint AS observation_count
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

-- ─── TABLE GRANTS ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;
GRANT ALL ON projects TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON code_chunks TO authenticated;
GRANT ALL ON code_chunks TO service_role;

GRANT SELECT ON code_relationships TO authenticated;
GRANT ALL ON code_relationships TO service_role;

GRANT SELECT ON project_branches TO authenticated;
GRANT ALL ON project_branches TO service_role;

GRANT EXECUTE ON FUNCTION match_code_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION match_code_chunks TO service_role;

-- ─── AUTO-UPDATE TIMESTAMPS ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_code_chunks_updated_at
    BEFORE UPDATE ON code_chunks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_branches_updated_at
    BEFORE UPDATE ON project_branches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
