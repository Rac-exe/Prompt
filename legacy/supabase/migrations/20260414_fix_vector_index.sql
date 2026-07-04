-- Fix vector search returning 0 results for natural-language queries.
--
-- Root cause: IVFFlat index with lists=100 for ~200 chunks creates mostly
-- empty clusters. Short natural-language queries produce embeddings that
-- land in empty clusters, returning 0 results.
--
-- Fix: Replace IVFFlat with HNSW, which doesn't partition into clusters
-- and provides consistent recall regardless of dataset size.

SET maintenance_work_mem = '256MB';

-- ─── DROP IVFFLAT INDEX ────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_code_chunks_embedding;

-- ─── CREATE HNSW INDEX ─────────────────────────────────────────────────────
-- HNSW provides better recall than IVFFlat for small-to-medium datasets
-- and doesn't suffer from the empty-cluster problem.
-- m=16 (connections per node) and ef_construction=64 are good defaults.

CREATE INDEX idx_code_chunks_embedding ON code_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

RESET maintenance_work_mem;
