# Semantic Memory System: Complete Implementation Plans

## Table of Contents
1. [Plan 1: Monolithic Implementation (Electron-Integrated)](#plan-1-monolithic-implementation)
2. [Plan 2: Separate Service Migration](#plan-2-separate-service-migration)

---

# Plan 1: Monolithic Implementation (Electron-Integrated)

## Overview

This plan implements the semantic memory system entirely within the Electron application, with all processing happening in the main process. This approach prioritizes simplicity, fast iteration, and zero infrastructure overhead.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Electron Main Process                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Chat Handlers                           │  │
│  │  - Triggers extraction after each optimization            │  │
│  │  - Requests context before optimization                   │  │
│  └────────────┬─────────────────────────────┬────────────────┘  │
│               │                             │                   │
│  ┌────────────▼────────────┐   ┌────────────▼────────────┐     │
│  │  MemoryExtractorService │   │  ContextBuilderService  │     │
│  │  - LLM fact extraction  │   │  - Semantic retrieval   │     │
│  │  - Async processing     │   │  - Context formatting   │     │
│  └────────────┬────────────┘   └────────────┬────────────┘     │
│               │                             │                   │
│  ┌────────────▼─────────────────────────────▼────────────┐     │
│  │              SemanticMemoryService                     │     │
│  │  - Embedding generation (OpenAI)                       │     │
│  │  - Similarity search (Supabase pgvector)               │     │
│  │  - Contradiction detection                             │     │
│  │  - Supersession logic                                  │     │
│  └────────────────────────────┬────────────────────────────┘     │
└────────────────────────────────┼────────────────────────────────┘
                                 │
                                 │ SQL + pgvector
                                 │
┌────────────────────────────────▼────────────────────────────────┐
│                    Supabase PostgreSQL                           │
│  - memory_facts (with vector embeddings)                        │
│  - RLS policies for user isolation                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Database Schema & Infrastructure (Day 1, 2 hours)

### 1.1 Supabase Migration

**File**: `supabase/migrations/003_semantic_memory.sql`

```sql
-- ============================================================================
-- SEMANTIC MEMORY SYSTEM SCHEMA
-- ============================================================================

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- TABLE: memory_facts
-- Stores atomic, semantically-indexed user memory facts
-- ============================================================================

CREATE TABLE memory_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Fact categorization
  category TEXT NOT NULL CHECK (category IN (
    'IDENTITY',        -- Role, seniority, context
    'DOMAIN',          -- Tech stack, subject area
    'OUTPUT_STYLE',    -- Format, length, tone preferences
    'TECHNICAL_LEVEL', -- Depth per domain
    'WORKFLOW',        -- How they work, urgency, iteration style
    'GOAL'             -- What they're trying to accomplish
  )),
  
  -- Fact content
  fact TEXT NOT NULL,
  evidence TEXT NOT NULL,  -- Prompt snippet that grounded this fact
  
  -- Vector embedding for semantic search
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  
  -- Confidence and observation tracking
  confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  observation_count INT NOT NULL DEFAULT 1,
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Supersession chain for contradiction handling
  superseded_by UUID REFERENCES memory_facts(id) ON DELETE SET NULL,
  
  -- Prevent exact duplicates
  UNIQUE(user_id, fact)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Vector similarity index (IVFFlat for fast approximate search)
-- Lists parameter: sqrt(total_rows) is a good heuristic
-- For 10K facts, lists=100 is optimal
CREATE INDEX memory_facts_embedding_idx ON memory_facts 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Standard B-tree indexes
CREATE INDEX memory_facts_user_id_idx ON memory_facts(user_id);
CREATE INDEX memory_facts_category_idx ON memory_facts(category);
CREATE INDEX memory_facts_confidence_idx ON memory_facts(confidence);
CREATE INDEX memory_facts_last_observed_idx ON memory_facts(last_observed_at);
CREATE INDEX memory_facts_superseded_idx ON memory_facts(superseded_by) 
WHERE superseded_by IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;

-- Users can only view their own facts
CREATE POLICY "Users can view own memory facts"
  ON memory_facts FOR SELECT
  USING (auth.uid() = user_id);

-- Users can only insert their own facts
CREATE POLICY "Users can insert own memory facts"
  ON memory_facts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own facts
CREATE POLICY "Users can update own memory facts"
  ON memory_facts FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can only delete their own facts
CREATE POLICY "Users can delete own memory facts"
  ON memory_facts FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Function: find_similar_memory_facts
-- Purpose: Semantic similarity search using cosine distance
-- Returns: Facts similar to query_embedding, ordered by similarity
CREATE OR REPLACE FUNCTION find_similar_memory_facts(
  query_embedding vector(1536),
  match_user_id UUID,
  similarity_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  category TEXT,
  fact TEXT,
  evidence TEXT,
  embedding vector(1536),
  confidence FLOAT,
  observation_count INT,
  last_observed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  superseded_by UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mf.id,
    mf.user_id,
    mf.category,
    mf.fact,
    mf.evidence,
    mf.embedding,
    mf.confidence,
    mf.observation_count,
    mf.last_observed_at,
    mf.created_at,
    mf.superseded_by,
    1 - (mf.embedding <=> query_embedding) AS similarity
  FROM memory_facts mf
  WHERE mf.user_id = match_user_id
    AND mf.superseded_by IS NULL  -- Exclude superseded facts
    AND 1 - (mf.embedding <=> query_embedding) > similarity_threshold
  ORDER BY mf.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function: get_high_confidence_facts
-- Purpose: Get global profile facts (IDENTITY + DOMAIN) with high confidence
CREATE OR REPLACE FUNCTION get_high_confidence_facts(
  match_user_id UUID,
  min_confidence FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  category TEXT,
  fact TEXT,
  evidence TEXT,
  confidence FLOAT,
  observation_count INT,
  last_observed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    mf.id,
    mf.user_id,
    mf.category,
    mf.fact,
    mf.evidence,
    mf.confidence,
    mf.observation_count,
    mf.last_observed_at
  FROM memory_facts mf
  WHERE mf.user_id = match_user_id
    AND mf.category IN ('IDENTITY', 'DOMAIN')
    AND mf.confidence >= min_confidence
    AND mf.superseded_by IS NULL
  ORDER BY mf.confidence DESC, mf.observation_count DESC
  LIMIT match_count;
END;
$$;

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================

-- To apply this migration:
-- 1. Run in Supabase SQL Editor
-- 2. Verify pgvector extension is enabled
-- 3. Test RPC functions with sample data
-- 4. Monitor index build progress (can take time for large datasets)

-- To rollback:
-- DROP FUNCTION IF EXISTS find_similar_memory_facts;
-- DROP FUNCTION IF EXISTS get_high_confidence_facts;
-- DROP TABLE IF EXISTS memory_facts CASCADE;
-- DROP EXTENSION IF EXISTS vector;
```

### 1.2 Environment Configuration

**Update**: `.env.example`

```env
# Existing configuration...

# ============================================================================
# MEMORY SYSTEM CONFIGURATION
# ============================================================================

# OpenAI API Key (for embeddings)
# Get from: https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-...

# Memory extraction model (cheap, fast model for fact extraction)
MEMORY_EXTRACTION_MODEL=claude-haiku-4-5-20251001

# Embedding model (OpenAI text-embedding-3-small)
EMBEDDING_MODEL=text-embedding-3-small

# Memory system feature flags
ENABLE_MEMORY_SYSTEM=true
MEMORY_EXTRACTION_ENABLED=true
MEMORY_CONTEXT_INJECTION_ENABLED=true

# Memory tuning parameters
MEMORY_SIMILARITY_THRESHOLD=0.85  # For deduplication
MEMORY_RELEVANCE_THRESHOLD=0.70   # For context retrieval
MEMORY_DECAY_RATE=0.02            # Time-weighted decay factor
MEMORY_MIN_CONFIDENCE=0.20        # Minimum effective confidence
```

### 1.3 Verification Steps

```bash
# 1. Apply migration
# In Supabase Dashboard > SQL Editor, paste and run migration

# 2. Verify extension
SELECT * FROM pg_extension WHERE extname = 'vector';

# 3. Verify table
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'memory_facts';

# 4. Test RPC function
SELECT * FROM find_similar_memory_facts(
  ARRAY[0.1, 0.2, ...]::vector(1536),  -- Dummy embedding
  'user-uuid-here'::uuid,
  0.7,
  5
);
```

---

## Phase 2: Python Service Integration (Day 1-2, 4 hours)

### 2.1 Memory Extraction Module

**File**: `python-service/pipeline_v2/memory_extractor.py`

```python
"""
Memory Extraction Module
Extracts atomic, grounded facts from user prompts using LLM.
"""

from typing import List, Dict, Literal
from litellm import completion
import json
import logging

logger = logging.getLogger(__name__)

MemoryCategory = Literal[
    'IDENTITY',        # Role, seniority, context
    'DOMAIN',          # Tech stack, subject area
    'OUTPUT_STYLE',    # Format, length, tone preferences
    'TECHNICAL_LEVEL', # Depth per domain
    'WORKFLOW',        # How they work, urgency, iteration style
    'GOAL'             # What they're trying to accomplish
]

class MemoryExtractor:
    """
    Extracts atomic facts from user prompts using LLM.
    
    Design principles:
    - Each fact must be falsifiable and grounded in evidence
    - Confidence scores based on signal strength in prompt
    - Categorized for structured retrieval
    """
    
    def __init__(self, model: str = "claude-haiku-4-5-20251001"):
        self.model = model
        logger.info(f"[MemoryExtractor] Initialized with model: {model}")
    
    async def extract_facts(
        self,
        raw_prompt: str,
        skill: str | None = None,
        optimization_id: str | None = None
    ) -> List[Dict]:
        """
        Extract atomic facts from a single optimization.
        
        Args:
            raw_prompt: The user's original prompt text
            skill: Optional skill selected by user
            optimization_id: Optional ID for tracking
            
        Returns:
            List of extracted facts with structure:
            [
                {
                    "category": "DOMAIN",
                    "fact": "user writes TypeScript React components",
                    "confidence": 0.85,
                    "evidence": "...snippet from prompt..."
                }
            ]
        """
        
        extraction_prompt = self._build_extraction_prompt(raw_prompt, skill)
        
        try:
            response = await completion(
                model=self.model,
                messages=[{"role": "user", "content": extraction_prompt}],
                temperature=0.3,  # Low temperature for consistent extraction
                max_tokens=400,   # Enough for 5 facts
                timeout=10.0
            )
            
            content = response.choices[0].message.content
            facts = self._parse_facts(content)
            
            logger.info(
                f"[MemoryExtractor] Extracted {len(facts)} facts from prompt "
                f"(optimization_id={optimization_id})"
            )
            
            return facts
            
        except json.JSONDecodeError as e:
            logger.error(f"[MemoryExtractor] JSON parse error: {e}")
            logger.debug(f"[MemoryExtractor] Raw response: {content}")
            return []
            
        except Exception as e:
            logger.error(f"[MemoryExtractor] Extraction failed: {e}")
            return []
    
    def _build_extraction_prompt(self, raw_prompt: str, skill: str | None) -> str:
        """Build the extraction prompt for the LLM."""
        
        return f"""You are analyzing a single user prompt to build a precise user profile.

Raw prompt: {raw_prompt}
Skill selected: {skill or "none"}

Extract 1-5 atomic, concrete facts about this user. Rules:
- Be SPECIFIC. Not "user likes technical content" → "user writes TypeScript React components for a desktop Electron app"
- Each fact must be falsifiable and grounded in the prompt above
- Categorize each fact as one of: IDENTITY, DOMAIN, OUTPUT_STYLE, TECHNICAL_LEVEL, WORKFLOW, GOAL
- Assign confidence 0.0-1.0 based on how clearly the prompt signals this
- Include a brief evidence snippet (max 50 chars) from the prompt

Return ONLY a JSON array (no markdown, no explanation):
[{{"category": "DOMAIN", "fact": "...", "confidence": 0.85, "evidence": "...snippet..."}}]

Examples of good facts:
- IDENTITY: "Senior engineer building a production desktop app"
- DOMAIN: "Works with TypeScript, Python FastAPI, and Electron"
- OUTPUT_STYLE: "Prefers code examples over prose explanations"
- TECHNICAL_LEVEL: "Knows React deeply, newer to Python async patterns"
- WORKFLOW: "Writing prompts for quick implementation tasks, not research"
- GOAL: "Building a memory system for a prompt optimizer"

Examples of bad facts (too vague):
- "User is technical" (not specific enough)
- "User likes code" (not falsifiable)
- "User wants help" (obvious, not useful)

Now extract facts from the prompt above:"""
    
    def _parse_facts(self, content: str) -> List[Dict]:
        """Parse and validate extracted facts."""
        
        # Remove markdown code blocks if present
        content = content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        
        facts = json.loads(content)
        
        # Validate structure
        valid_categories = {'IDENTITY', 'DOMAIN', 'OUTPUT_STYLE', 'TECHNICAL_LEVEL', 'WORKFLOW', 'GOAL'}
        validated_facts = []
        
        for fact in facts:
            if not isinstance(fact, dict):
                continue
            
            if 'category' not in fact or fact['category'] not in valid_categories:
                logger.warning(f"[MemoryExtractor] Invalid category: {fact.get('category')}")
                continue
            
            if 'fact' not in fact or not fact['fact'].strip():
                logger.warning("[MemoryExtractor] Missing or empty fact")
                continue
            
            if 'confidence' not in fact or not (0 <= fact['confidence'] <= 1):
                logger.warning(f"[MemoryExtractor] Invalid confidence: {fact.get('confidence')}")
                fact['confidence'] = 0.5  # Default
            
            if 'evidence' not in fact:
                fact['evidence'] = ""
            
            validated_facts.append(fact)
        
        return validated_facts
```

### 2.2 WebSocket Endpoint

**Update**: `python-service/app/main.py`

```python
# Add to existing imports
from pipeline_v2.memory_extractor import MemoryExtractor

# Initialize memory extractor
memory_extractor = MemoryExtractor(
    model=os.getenv("MEMORY_EXTRACTION_MODEL", "claude-haiku-4-5-20251001")
)

@app.post("/api/v1/extract-memory-facts")
async def extract_memory_facts(request: Request):
    """
    Extract memory facts from a prompt.
    
    Request body:
    {
        "raw_prompt": "...",
        "skill": "coding" | null,
        "optimization_id": "uuid" | null
    }
    
    Response:
    {
        "facts": [
            {
                "category": "DOMAIN",
                "fact": "...",
                "confidence": 0.85,
                "evidence": "..."
            }
        ]
    }
    """
    try:
        data = await request.json()
        raw_prompt = data.get("raw_prompt", "")
        skill = data.get("skill")
        optimization_id = data.get("optimization_id")
        
        if not raw_prompt:
            return JSONResponse(
                status_code=400,
                content={"error": "raw_prompt is required"}
            )
        
        facts = await memory_extractor.extract_facts(
            raw_prompt=raw_prompt,
            skill=skill,
            optimization_id=optimization_id
        )
        
        return {"facts": facts}
        
    except Exception as e:
        logger.error(f"[MemoryExtraction] Error: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )
```

### 2.3 Python Dependencies

**Update**: `python-service/requirements.txt`

```txt
# Existing dependencies...

# Memory system dependencies
openai>=1.0.0  # For embeddings (if using OpenAI)
```

### 2.4 Testing

**File**: `python-service/tests/test_memory_extractor.py`

```python
import pytest
from pipeline_v2.memory_extractor import MemoryExtractor

@pytest.mark.asyncio
async def test_extract_facts_basic():
    """Test basic fact extraction"""
    extractor = MemoryExtractor()
    
    prompt = """
    I'm building a React component for my Electron app that needs to handle
    file uploads. I want the code to be TypeScript with proper error handling.
    """
    
    facts = await extractor.extract_facts(prompt, skill="coding")
    
    assert len(facts) > 0
    assert all('category' in f for f in facts)
    assert all('fact' in f for f in facts)
    assert all('confidence' in f for f in facts)
    assert all(0 <= f['confidence'] <= 1 for f in facts)

@pytest.mark.asyncio
async def test_extract_facts_with_skill():
    """Test extraction with skill context"""
    extractor = MemoryExtractor()
    
    prompt = "Write me a Python function to parse JSON"
    facts = await extractor.extract_facts(prompt, skill="coding")
    
    # Should infer DOMAIN: Python
    domain_facts = [f for f in facts if f['category'] == 'DOMAIN']
    assert any('python' in f['fact'].lower() for f in domain_facts)
```

---

## Phase 3: Electron Services (Day 2, 6 hours)

### 3.1 Embedding Service

**File**: `electron/main/database/services/embedding-service.ts`

```typescript
import OpenAI from 'openai';

/**
 * EmbeddingService
 * Generates vector embeddings using OpenAI's text-embedding-3-small model.
 * 
 * Cost: ~$0.00001 per embedding (1536 dimensions)
 * Latency: ~100-200ms per request
 */
export class EmbeddingService {
  private client: OpenAI;
  private model: string;
  private cache: Map<string, number[]>;

  constructor(apiKey: string, model: string = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.cache = new Map();
    console.log(`[EmbeddingService] Initialized with model: ${model}`);
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = this.getCacheKey(text);
    if (this.cache.has(cacheKey)) {
      console.log('[EmbeddingService] Cache hit');
      return this.cache.get(cacheKey)!;
    }

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float'
      });

      const embedding = response.data[0].embedding;
      
      // Cache the result
      this.cache.set(cacheKey, embedding);
      
      // Limit cache size to 1000 entries
      if (this.cache.size > 1000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      console.log(`[EmbeddingService] Generated embedding (${embedding.length} dimensions)`);
      return embedding;

    } catch (error) {
      console.error('[EmbeddingService] Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        encoding_format: 'float'
      });

      const embeddings = response.data.map(d => d.embedding);
      
      // Cache all results
      texts.forEach((text, i) => {
        const cacheKey = this.getCacheKey(text);
        this.cache.set(cacheKey, embeddings[i]);
      });

      console.log(`[EmbeddingService] Generated ${embeddings.length} embeddings`);
      return embeddings;

    } catch (error) {
      console.error('[EmbeddingService] Batch embedding failed:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private getCacheKey(text: string): string {
    // Simple hash for cache key
    return text.substring(0, 100);
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[EmbeddingService] Cache cleared');
  }
}
```

### 3.2 Memory Extractor Service

**File**: `electron/main/database/services/memory-extractor-service.ts`

```typescript
import { PythonClient } from '../../api/python-client';

export interface ExtractedFact {
  category: 'IDENTITY' | 'DOMAIN' | 'OUTPUT_STYLE' | 'TECHNICAL_LEVEL' | 'WORKFLOW' | 'GOAL';
  fact: string;
  confidence: number;
  evidence: string;
}

/**
 * MemoryExtractorService
 * Communicates with Python service to extract atomic facts from prompts.
 */
export class MemoryExtractorService {
  constructor(private pythonClient: PythonClient) {}

  /**
   * Extract facts from a prompt (async, non-blocking)
   */
  async extractFacts(
    rawPrompt: string,
    skill: string | null,
    optimizationId?: string
  ): Promise<ExtractedFact[]> {
    try {
      console.log('[MemoryExtractor] Extracting facts from prompt...');
      
      const response = await this.pythonClient.extractMemoryFacts(
        rawPrompt,
        skill,
        optimizationId
      );

      console.log(`[MemoryExtractor] Extracted ${response.facts.length} facts`);
      return response.facts;

    } catch (error) {
      console.error('[MemoryExtractor] Extraction failed:', error);
      // Non-critical: return empty array
      return [];
    }
  }
}
```

### 3.3 Semantic Memory Service

**File**: `electron/main/database/services/semantic-memory-service.ts`

```typescript
import { SupabaseClientManager } from '../supabase-client';
import { EmbeddingService } from './embedding-service';
import { ExtractedFact } from './memory-extractor-service';

export interface MemoryFact {
  id: string;
  user_id: string;
  category: string;
  fact: string;
  evidence: string;
  embedding: number[];
  confidence: number;
  observation_count: number;
  last_observed_at: string;
  created_at: string;
  superseded_by: string | null;
}

/**
 * SemanticMemoryService
 * Manages semantic memory storage with vector embeddings.
 * 
 * Key responsibilities:
 * - Generate embeddings for facts
 * - Semantic similarity search
 * - Deduplication and reinforcement
 * - Contradiction detection and supersession
 */
export class SemanticMemoryService {
  private client = SupabaseClientManager.getClient();
  
  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Upsert a fact with semantic deduplication
   */
  async upsertFact(userId: string, extractedFact: ExtractedFact): Promise<void> {
    try {
      // 1. Generate embedding for new fact
      const newEmbedding = await this.embeddingService.embed(extractedFact.fact);
      
      // 2. Find semantically similar existing facts
      const similar = await this.findSimilarFacts(userId, newEmbedding, 0.85);
      
      if (similar.length === 0) {
        // Genuinely new belief — insert
        await this.insertFact(userId, extractedFact, newEmbedding);
        console.log(`[SemanticMemory] New fact: ${extractedFact.fact}`);
        
      } else {
        const mostSimilar = similar[0];
        const relationship = await this.detectRelationship(
          extractedFact.fact,
          mostSimilar.fact,
          mostSimilar.similarity
        );
        
        if (relationship === 'REINFORCES') {
          // Same direction — boost confidence and observation_count
          await this.reinforceFact(mostSimilar.id, extractedFact.confidence);
          console.log(`[SemanticMemory] Reinforced: ${mostSimilar.fact}`);
          
        } else if (relationship === 'CONTRADICTS') {
          // Contradiction — new fact wins, mark old as superseded
          await this.supersedeFact(mostSimilar.id, userId, extractedFact, newEmbedding);
          console.log(`[SemanticMemory] Superseded: ${mostSimilar.fact} → ${extractedFact.fact}`);
          
        } else {
          // Unrelated despite similarity — insert as separate fact
          await this.insertFact(userId, extractedFact, newEmbedding);
          console.log(`[SemanticMemory] New fact (unrelated): ${extractedFact.fact}`);
        }
      }
      
    } catch (error) {
      console.error('[SemanticMemory] Upsert failed:', error);
      throw error;
    }
  }

  /**
   * Find semantically similar facts using pgvector
   */
  async findSimilarFacts(
    userId: string,
    embedding: number[],
    threshold: number = 0.7
  ): Promise<(MemoryFact & { similarity: number })[]> {
    try {
      const { data, error } = await this.client.rpc('find_similar_memory_facts', {
        query_embedding: embedding,
        match_user_id: userId,
        similarity_threshold: threshold,
        match_count: 10
      });
      
      if (error) throw error;
      return data || [];
      
    } catch (error) {
      console.error('[SemanticMemory] Similarity search failed:', error);
      return [];
    }
  }

  /**
   * Detect relationship between two facts
   */
  private async detectRelationship(
    newFact: string,
    existingFact: string,
    similarity: number
  ): Promise<'REINFORCES' | 'CONTRADICTS' | 'UNRELATED'> {
    // Simple heuristic for now:
    // - similarity > 0.9: REINFORCES
    // - similarity 0.85-0.9: Check for negation keywords
    // - similarity < 0.85: UNRELATED
    
    if (similarity > 0.9) {
      return 'REINFORCES';
    }
    
    if (similarity >= 0.85) {
      // Check for contradiction keywords
      const contradictionKeywords = ['not', 'no', 'never', 'instead', 'rather', 'but'];
      const hasContradiction = contradictionKeywords.some(kw => 
        newFact.toLowerCase().includes(kw) || existingFact.toLowerCase().includes(kw)
      );
      
      return hasContradiction ? 'CONTRADICTS' : 'REINFORCES';
    }
    
    return 'UNRELATED';
  }

  /**
   * Insert a new fact
   */
  private async insertFact(
    userId: string,
    fact: ExtractedFact,
    embedding: number[]
  ): Promise<void> {
    const { error } = await this.client
      .from('memory_facts')
      .insert({
        user_id: userId,
        category: fact.category,
        fact: fact.fact,
        evidence: fact.evidence,
        embedding,
        confidence: fact.confidence,
        observation_count: 1,
        last_observed_at: new Date().toISOString()
      });
    
    if (error) throw error;
  }

  /**
   * Reinforce an existing fact
   */
  private async reinforceFact(factId: string, newConfidence: number): Promise<void> {
    // Fetch current fact
    const { data: current, error: fetchError } = await this.client
      .from('memory_facts')
      .select('confidence, observation_count')
      .eq('id', factId)
      .single();
    
    if (fetchError || !current) {
      console.error('[SemanticMemory] Failed to fetch fact for reinforcement:', fetchError);
      return;
    }
    
    // Weighted average of confidences
    const updatedConfidence = (
      current.confidence * current.observation_count + newConfidence
    ) / (current.observation_count + 1);
    
    // Update fact
    const { error: updateError } = await this.client
      .from('memory_facts')
      .update({
        confidence: Math.min(updatedConfidence, 1.0),
        observation_count: current.observation_count + 1,
        last_observed_at: new Date().toISOString()
      })
      .eq('id', factId);
    
    if (updateError) throw updateError;
  }

  /**
   * Supersede an old fact with a new one
   */
  private async supersedeFact(
    oldFactId: string,
    userId: string,
    newFact: ExtractedFact,
    newEmbedding: number[]
  ): Promise<void> {
    // Insert new fact
    const { data: inserted, error: insertError } = await this.client
      .from('memory_facts')
      .insert({
        user_id: userId,
        category: newFact.category,
        fact: newFact.fact,
        evidence: newFact.evidence,
        embedding: newEmbedding,
        confidence: newFact.confidence,
        observation_count: 1,
        last_observed_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (insertError || !inserted) {
      console.error('[SemanticMemory] Failed to insert superseding fact:', insertError);
      return;
    }
    
    // Mark old fact as superseded
    const { error: updateError } = await this.client
      .from('memory_facts')
      .update({ superseded_by: inserted.id })
      .eq('id', oldFactId);
    
    if (updateError) {
      console.error('[SemanticMemory] Failed to mark fact as superseded:', updateError);
    }
  }

  /**
   * Get all facts for a user (for UI display)
   */
  async getUserFacts(
    userId: string,
    category?: string
  ): Promise<MemoryFact[]> {
    let query = this.client
      .from('memory_facts')
      .select('*')
      .eq('user_id', userId)
      .is('superseded_by', null)
      .order('confidence', { ascending: false });
    
    if (category) {
      query = query.eq('category', category);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data || [];
  }

  /**
   * Delete a fact
   */
  async deleteFact(factId: string): Promise<void> {
    const { error } = await this.client
      .from('memory_facts')
      .delete()
      .eq('id', factId);
    
    if (error) throw error;
  }
}
```

### 3.4 Context Builder Service

**File**: `electron/main/database/services/context-builder-service.ts`

```typescript
import { SemanticMemoryService, MemoryFact } from './semantic-memory-service';
import { EmbeddingService } from './embedding-service';

/**
 * ContextBuilderService
 * Builds memory context for optimization by combining:
 * 1. High-confidence global profile (IDENTITY + DOMAIN)
 * 2. Facts semantically relevant to the current prompt
 * 
 * Uses time-weighted decay to prioritize recent observations.
 */
export class ContextBuilderService {
  constructor(
    private semanticMemory: SemanticMemoryService,
    private embeddingService: EmbeddingService
  ) {}

  /**
   * Build memory context for a specific prompt
   */
  async buildMemoryContext(userId: string, rawPrompt: string): Promise<string> {
    try {
      // 1. Embed the incoming prompt
      const promptEmbedding = await this.embeddingService.embed(rawPrompt);
      
      // 2. Get high-confidence global profile (IDENTITY + DOMAIN)
      const globalProfile = await this.getGlobalProfile(userId);
      
      // 3. Get facts semantically similar to THIS prompt
      const relevantFacts = await this.semanticMemory.findSimilarFacts(
        userId,
        promptEmbedding,
        0.7  // Lower threshold for relevance
      );
      
      // 4. Apply time-weighted decay
      const activeRelevant = relevantFacts
        .map(f => ({
          ...f,
          effectiveConfidence: this.calculateEffectiveConfidence(f)
        }))
        .filter(f => f.effectiveConfidence >= 0.2)
        .slice(0, 5);
      
      // 5. Deduplicate and format
      const allFacts = this.deduplicate([...globalProfile, ...activeRelevant]);
      
      return this.formatMemoryBlock(allFacts, activeRelevant);
      
    } catch (error) {
      console.error('[ContextBuilder] Failed to build context:', error);
      return '';
    }
  }

  /**
   * Get high-confidence global profile facts
   */
  private async getGlobalProfile(userId: string): Promise<MemoryFact[]> {
    try {
      const { data, error } = await this.semanticMemory['client']
        .rpc('get_high_confidence_facts', {
          match_user_id: userId,
          min_confidence: 0.7,
          match_count: 5
        });
      
      if (error) throw error;
      return data || [];
      
    } catch (error) {
      console.error('[ContextBuilder] Failed to get global profile:', error);
      return [];
    }
  }

  /**
   * Calculate effective confidence with time-weighted decay
   */
  private calculateEffectiveConfidence(fact: MemoryFact & { similarity?: number }): number {
    const daysSince = this.daysBetween(fact.last_observed_at, new Date());
    const decayRate = parseFloat(process.env.MEMORY_DECAY_RATE || '0.02');
    const decayFactor = Math.exp(-decayRate * daysSince); // ~50% at 35 days
    
    return fact.confidence * decayFactor * Math.log(1 + fact.observation_count);
  }

  /**
   * Deduplicate facts by ID
   */
  private deduplicate(facts: any[]): any[] {
    const seen = new Set<string>();
    return facts.filter(f => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  }

  /**
   * Format memory block for injection into optimizer
   */
  private formatMemoryBlock(globalFacts: any[], relevantFacts: any[]): string {
    const lines: string[] = ['[USER PROFILE]'];
    
    // Group global facts by category
    const byCategory = this.groupBy(globalFacts, 'category');
    
    if (byCategory.IDENTITY?.length) {
      const identityFacts = byCategory.IDENTITY.map(f => f.fact).join('; ');
      lines.push(`Identity: ${identityFacts}`);
    }
    
    if (byCategory.DOMAIN?.length) {
      const domainFacts = byCategory.DOMAIN.map(f => f.fact).join('; ');
      lines.push(`Domain: ${domainFacts}`);
    }
    
    if (byCategory.OUTPUT_STYLE?.length) {
      const styleFacts = byCategory.OUTPUT_STYLE.map(f => f.fact).join('; ');
      lines.push(`Output preference: ${styleFacts}`);
    }
    
    if (byCategory.TECHNICAL_LEVEL?.length) {
      const levelFacts = byCategory.TECHNICAL_LEVEL.map(f => f.fact).join('; ');
      lines.push(`Technical level: ${levelFacts}`);
    }
    
    // Add relevant facts section
    if (relevantFacts.length > 0) {
      lines.push('', '[RELEVANT TO THIS PROMPT]');
      relevantFacts.forEach(f => {
        const confidence = Math.round(f.effectiveConfidence * 100);
        lines.push(`- ${f.fact} (${confidence}% confidence)`);
      });
    }
    
    return lines.join('\n');
  }

  /**
   * Group array by key
   */
  private groupBy(arr: any[], key: string): Record<string, any[]> {
    return arr.reduce((acc, item) => {
      const groupKey = item[key];
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(item);
      return acc;
    }, {});
  }

  /**
   * Calculate days between two dates
   */
  private daysBetween(date1: string | Date, date2: Date): number {
    const d1 = new Date(date1);
    return Math.floor((date2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  }
}
```

---

## Phase 4: Integration & Wiring (Day 2-3, 3 hours)

### 4.1 Python Client Extension

**Update**: `electron/main/api/python-client.ts`

```typescript
// Add to existing PythonClient class

/**
 * Extract memory facts from a prompt
 */
async extractMemoryFacts(
  rawPrompt: string,
  skill: string | null,
  optimizationId?: string
): Promise<{ facts: ExtractedFact[] }> {
  try {
    const response = await axios.post(
      `${this.baseUrl}/api/v1/extract-memory-facts`,
      {
        raw_prompt: rawPrompt,
        skill,
        optimization_id: optimizationId
      },
      { timeout: 10000 }
    );
    
    return response.data;
    
  } catch (error) {
    console.error('[PythonClient] Memory extraction failed:', error);
    throw error;
  }
}
```

### 4.2 Service Initialization

**Update**: `electron/main/index-new.ts`

```typescript
import { EmbeddingService } from './database/services/embedding-service';
import { MemoryExtractorService } from './database/services/memory-extractor-service';
import { SemanticMemoryService } from './database/services/semantic-memory-service';
import { ContextBuilderService } from './database/services/context-builder-service';

// Initialize memory services (after app.whenReady())
let embeddingService: EmbeddingService | null = null;
let memoryExtractorService: MemoryExtractorService | null = null;
let semanticMemoryService: SemanticMemoryService | null = null;
let contextBuilderService: ContextBuilderService | null = null;

function initializeMemoryServices() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    console.warn('[Memory] OPENAI_API_KEY not set, memory system disabled');
    return;
  }
  
  if (process.env.ENABLE_MEMORY_SYSTEM !== 'true') {
    console.log('[Memory] Memory system disabled via config');
    return;
  }
  
  try {
    // Initialize services
    embeddingService = new EmbeddingService(openaiApiKey);
    memoryExtractorService = new MemoryExtractorService(pythonClient);
    semanticMemoryService = new SemanticMemoryService(embeddingService);
    contextBuilderService = new ContextBuilderService(semanticMemoryService, embeddingService);
    
    console.log('[Memory] ✅ Memory system initialized');
    
  } catch (error) {
    console.error('[Memory] Failed to initialize memory system:', error);
  }
}

app.whenReady().then(() => {
  // ... existing initialization ...
  
  // Initialize memory services
  initializeMemoryServices();
  
  // ... rest of initialization ...
});

// Export services for use in handlers
export function getMemoryServices() {
  return {
    embeddingService,
    memoryExtractorService,
    semanticMemoryService,
    contextBuilderService
  };
}
```

### 4.3 Chat Handlers Integration

**Update**: `electron/main/ipc-handlers/chat-handlers.ts`

```typescript
import { getMemoryServices } from '../index-new';

// In registerChatHandlers function

// ============================================
// MEMORY EXTRACTION (after optimization save)
// ============================================

// After line 680 (after saving optimization)
if (authState.isAuthenticated && authState.currentUserId) {
  const { memoryExtractorService, semanticMemoryService } = getMemoryServices();
  
  if (memoryExtractorService && semanticMemoryService && 
      process.env.MEMORY_EXTRACTION_ENABLED === 'true') {
    
    // Extract facts (async, non-blocking)
    memoryExtractorService.extractFacts(
      data.content,
      data.forcedSkill || null,
      optimizationId
    )
    .then(async (facts) => {
      // Upsert each fact
      for (const fact of facts) {
        try {
          await semanticMemoryService.upsertFact(authState.currentUserId!, fact);
        } catch (err) {
          console.warn('[Memory] Failed to upsert fact:', err);
        }
      }
      console.log(`[Memory] ✅ Processed ${facts.length} facts`);
    })
    .catch(err => {
      console.warn('[Memory] Extraction failed (non-critical):', err);
    });
  }
}

// ============================================
// CONTEXT INJECTION (before optimization)
// ============================================

// Replace lines 204-209 (memory context building)
if (authState.isAuthenticated && authState.currentUserId) {
  const { contextBuilderService } = getMemoryServices();
  
  if (contextBuilderService && process.env.MEMORY_CONTEXT_INJECTION_ENABLED === 'true') {
    try {
      const memCtx = await contextBuilderService.buildMemoryContext(
        authState.currentUserId,
        promptText
      );
      
      if (memCtx) {
        customInstructions = customInstructions 
          ? `${customInstructions}\n\n${memCtx}` 
          : memCtx;
      }
    } catch (err) {
      // Graceful degradation: continue without memory context
      console.warn('[Memory] Context build failed, continuing without memory:', err);
    }
  }
}
```

---

## Phase 5: UI Integration (Day 3, 2 hours)

### 5.1 Memory View Component

**Update**: `app-ui/src/components/settings/MemoryView.tsx`

```typescript
// Add new state for semantic facts
const [semanticFacts, setSemanticFacts] = useState<any[]>([]);

// Load semantic facts
const loadSemanticFacts = useCallback(async () => {
  if (!isElectron) return;
  
  try {
    const facts = await window.electronAPI.memory.getSemanticFacts();
    setSemanticFacts(facts);
  } catch (error) {
    console.error('[MemoryView] Failed to load semantic facts:', error);
  }
}, [isElectron]);

useEffect(() => {
  loadSemanticFacts();
}, [loadSemanticFacts]);

// Add section to display semantic facts
<div className="mt-6">
  <h3 className="text-sm font-semibold mb-3">Semantic Memory Facts</h3>
  <div className="space-y-2">
    {semanticFacts.map(fact => (
      <div key={fact.id} className="p-3 bg-secondary rounded-lg">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <span className="text-xs text-muted-foreground">{fact.category}</span>
            <p className="text-sm mt-1">{fact.fact}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Confidence: {Math.round(fact.confidence * 100)}% | 
              Observed: {fact.observation_count}x
            </p>
          </div>
          <button
            onClick={() => handleDeleteSemanticFact(fact.id)}
            className="text-destructive hover:text-destructive/80"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    ))}
  </div>
</div>
```

### 5.2 IPC Handlers for UI

**File**: `electron/main/ipc-handlers/memory-handlers.ts` (NEW)

```typescript
import { ipcMain } from 'electron';
import { getMemoryServices } from '../index-new';
import { authState } from '../utils/auth-state';

export function registerMemoryHandlers() {
  // Get semantic facts for UI display
  ipcMain.handle('memory:get-semantic-facts', async () => {
    const { semanticMemoryService } = getMemoryServices();
    
    if (!semanticMemoryService || !authState.currentUserId) {
      return [];
    }
    
    try {
      const facts = await semanticMemoryService.getUserFacts(authState.currentUserId);
      return facts;
    } catch (error) {
      console.error('[MemoryHandlers] Failed to get facts:', error);
      return [];
    }
  });
  
  // Delete a semantic fact
  ipcMain.handle('memory:delete-semantic-fact', async (event, factId: string) => {
    const { semanticMemoryService } = getMemoryServices();
    
    if (!semanticMemoryService) {
      throw new Error('Memory service not initialized');
    }
    
    try {
      await semanticMemoryService.deleteFact(factId);
      return { success: true };
    } catch (error) {
      console.error('[MemoryHandlers] Failed to delete fact:', error);
      return { success: false, error: String(error) };
    }
  });
}
```

### 5.3 Preload Bridge

**Update**: `electron/preload.ts`

```typescript
// Add to electronAPI object
memory: {
  // ... existing methods ...
  
  getSemanticFacts: () => ipcRenderer.invoke('memory:get-semantic-facts'),
  deleteSemanticFact: (factId: string) => 
    ipcRenderer.invoke('memory:delete-semantic-fact', factId),
}
```

---

## Phase 6: Testing & Validation (Day 3-4, 4 hours)

### 6.1 Unit Tests

**File**: `electron/main/database/services/__tests__/semantic-memory-service.test.ts`

```typescript
import { SemanticMemoryService } from '../semantic-memory-service';
import { EmbeddingService } from '../embedding-service';

describe('SemanticMemoryService', () => {
  let service: SemanticMemoryService;
  let embeddingService: EmbeddingService;
  
  beforeEach(() => {
    embeddingService = new EmbeddingService(process.env.OPENAI_API_KEY!);
    service = new SemanticMemoryService(embeddingService);
  });
  
  test('should insert new fact', async () => {
    const fact = {
      category: 'DOMAIN' as const,
      fact: 'User works with TypeScript and React',
      confidence: 0.85,
      evidence: 'building a React component'
    };
    
    await service.upsertFact('test-user-id', fact);
    
    const facts = await service.getUserFacts('test-user-id');
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0].fact).toBe(fact.fact);
  });
  
  test('should reinforce similar fact', async () => {
    const fact1 = {
      category: 'DOMAIN' as const,
      fact: 'User works with TypeScript',
      confidence: 0.8,
      evidence: 'TypeScript code'
    };
    
    const fact2 = {
      category: 'DOMAIN' as const,
      fact: 'User uses TypeScript',
      confidence: 0.9,
      evidence: 'TS project'
    };
    
    await service.upsertFact('test-user-id', fact1);
    await service.upsertFact('test-user-id', fact2);
    
    const facts = await service.getUserFacts('test-user-id');
    // Should have only 1 fact (reinforced)
    expect(facts.length).toBe(1);
    expect(facts[0].observation_count).toBe(2);
  });
});
```

### 6.2 Integration Tests

**File**: `electron/main/database/services/__tests__/memory-integration.test.ts`

```typescript
import { MemoryExtractorService } from '../memory-extractor-service';
import { SemanticMemoryService } from '../semantic-memory-service';
import { ContextBuilderService } from '../context-builder-service';
import { EmbeddingService } from '../embedding-service';
import { PythonClient } from '../../../api/python-client';

describe('Memory System Integration', () => {
  let extractor: MemoryExtractorService;
  let semantic: SemanticMemoryService;
  let contextBuilder: ContextBuilderService;
  
  beforeAll(() => {
    const pythonClient = new PythonClient('http://localhost:8001');
    const embeddingService = new EmbeddingService(process.env.OPENAI_API_KEY!);
    
    extractor = new MemoryExtractorService(pythonClient);
    semantic = new SemanticMemoryService(embeddingService);
    contextBuilder = new ContextBuilderService(semantic, embeddingService);
  });
  
  test('end-to-end: extract → store → retrieve', async () => {
    const userId = 'test-user-' + Date.now();
    const prompt = `
      I'm building a React component for file uploads in my Electron app.
      I need TypeScript with proper error handling.
    `;
    
    // 1. Extract facts
    const facts = await extractor.extractFacts(prompt, 'coding');
    expect(facts.length).toBeGreaterThan(0);
    
    // 2. Store facts
    for (const fact of facts) {
      await semantic.upsertFact(userId, fact);
    }
    
    // 3. Build context
    const context = await contextBuilder.buildMemoryContext(userId, prompt);
    expect(context).toContain('USER PROFILE');
    expect(context.toLowerCase()).toContain('typescript');
  });
});
```

### 6.3 Manual Testing Checklist

```markdown
## Memory System Testing Checklist

### Setup
- [ ] Supabase migration applied successfully
- [ ] pgvector extension enabled
- [ ] OPENAI_API_KEY set in .env
- [ ] Python service running
- [ ] Electron app running

### Extraction
- [ ] Send a prompt about TypeScript → Check logs for extracted facts
- [ ] Send a prompt about Python → Check logs for extracted facts
- [ ] Verify facts appear in Supabase `memory_facts` table
- [ ] Verify embeddings are 1536-dimensional vectors

### Deduplication
- [ ] Send similar prompts 3 times → Verify observation_count increases
- [ ] Send contradicting prompts → Verify supersession chain
- [ ] Check that superseded facts have `superseded_by` set

### Context Injection
- [ ] Send 5 prompts to build profile
- [ ] Send a new prompt → Check optimizer receives memory context
- [ ] Verify context includes relevant facts
- [ ] Verify context excludes low-confidence facts

### UI
- [ ] Open Settings → Memory tab
- [ ] Verify semantic facts are displayed
- [ ] Delete a fact → Verify it's removed
- [ ] Verify confidence and observation count shown

### Performance
- [ ] Measure extraction latency (should be < 1s)
- [ ] Measure context build latency (should be < 200ms)
- [ ] Verify optimization not blocked by extraction
- [ ] Check memory usage (should be < 100MB)
```

---

## Phase 7: Monitoring & Optimization (Day 4, 2 hours)

### 7.1 Logging

**File**: `electron/main/utils/memory-logger.ts`

```typescript
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

class MemoryLogger {
  private logPath: string;
  
  constructor() {
    const userDataPath = app.getPath('userData');
    this.logPath = path.join(userDataPath, 'memory-system.log');
  }
  
  log(event: string, data: any) {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      data
    };
    
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
  }
  
  logExtraction(userId: string, promptLength: number, factsCount: number, latencyMs: number) {
    this.log('extraction', { userId, promptLength, factsCount, latencyMs });
  }
  
  logContextBuild(userId: string, promptLength: number, contextLength: number, latencyMs: number) {
    this.log('context_build', { userId, promptLength, contextLength, latencyMs });
  }
  
  logSupersession(userId: string, oldFact: string, newFact: string) {
    this.log('supersession', { userId, oldFact, newFact });
  }
}

export const memoryLogger = new MemoryLogger();
```

### 7.2 Performance Monitoring

**Update services to include timing**:

```typescript
// In MemoryExtractorService
async extractFacts(...): Promise<ExtractedFact[]> {
  const startTime = Date.now();
  
  try {
    const facts = await this.pythonClient.extractMemoryFacts(...);
    const latency = Date.now() - startTime;
    
    memoryLogger.logExtraction(
      userId,
      rawPrompt.length,
      facts.length,
      latency
    );
    
    return facts;
  } catch (error) {
    // ...
  }
}
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Supabase migration applied to production
- [ ] Environment variables set in production
- [ ] Python service deployed with memory extraction endpoint
- [ ] OpenAI API key configured

### Post-Deployment
- [ ] Monitor extraction success rate
- [ ] Monitor context build latency
- [ ] Monitor embedding costs
- [ ] Check for supersession chains
- [ ] Verify RLS policies working

### Rollback Plan
- [ ] Feature flag: `ENABLE_MEMORY_SYSTEM=false`
- [ ] Falls back to old memory system
- [ ] No data loss (facts remain in DB)

---

## Success Metrics

### Quantitative
- **Extraction Success Rate**: > 95%
- **Context Build Latency**: < 200ms (p95)
- **Extraction Latency**: < 1s (p95)
- **Cost per User**: < $0.10/month
- **Fact Accuracy**: > 85% (manual review)

### Qualitative
- User feels "understood" after 5-10 optimizations
- Optimization quality improves with usage
- No stale/irrelevant context pollution
- Contradictions handled gracefully

---

## Troubleshooting

### Issue: Extraction fails
- Check Python service logs
- Verify OPENROUTER_API_KEY is set
- Check model availability
- Verify prompt length < 8K tokens

### Issue: Context build slow
- Check pgvector index exists
- Verify embedding cache working
- Check Supabase connection latency
- Consider increasing `lists` parameter in index

### Issue: Facts not appearing
- Check RLS policies
- Verify user authentication
- Check Supabase logs
- Verify embedding dimensions match (1536)

### Issue: High costs
- Check extraction frequency
- Verify caching working
- Consider cheaper embedding model
- Reduce extraction model calls

---

# Plan 2: Separate Service Migration

## Overview

This plan describes how to migrate the monolithic memory system (Plan 1) to a separate backend service. This migration should be done **after** Plan 1 is implemented and validated, typically when you have 50-100+ active users.

### Migration Strategy

**Incremental Migration** (Zero Downtime):
1. Deploy memory service alongside existing system
2. Dual-write to both systems
3. Validate consistency
4. Switch reads to new service
5. Deprecate old system

---

## Architecture Comparison

### Before (Monolithic)
```
Electron Main Process
├── MemoryExtractorService
├── SemanticMemoryService
├── ContextBuilderService
└── Direct Supabase connection
```

### After (Separate Service)
```
Electron Main Process
└── MemoryClient (HTTP/WebSocket)
    │
    ├─> Memory Service (FastAPI)
    │   ├── REST API
    │   ├── WebSocket Handler
    │   ├── Background Workers
    │   │   ├── Extraction Worker
    │   │   ├── Embedding Worker
    │   │   └── Upsert Worker
    │   └── Redis Queue
    │
    └─> Supabase (via service)
```

---

## Phase 1: Memory Service Development (Week 1, 20 hours)

### 1.1 Project Structure

```
memory-service/
├── app/
│   ├── main.py                 # FastAPI app
│   ├── config.py               # Configuration
│   ├── api/
│   │   ├── routes.py           # REST endpoints
│   │   └── websocket.py        # WebSocket handler
│   ├── core/
│   │   ├── extractor.py        # LLM fact extraction
│   │   ├── embeddings.py       # OpenAI embeddings
│   │   ├── semantic_memory.py  # Vector operations
│   │   └── context_builder.py  # Context retrieval
│   ├── workers/
│   │   ├── extraction_worker.py
│   │   ├── embedding_worker.py
│   │   └── upsert_worker.py
│   ├── models/
│   │   └── schemas.py          # Pydantic models
│   └── db/
│       └── supabase_client.py
├── tests/
│   ├── test_api.py
│   ├── test_workers.py
│   └── test_integration.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── README.md
```

### 1.2 Main Application

**File**: `memory-service/app/main.py`

```python
"""
Memory Service - FastAPI Application
Handles semantic memory extraction, storage, and retrieval.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import redis.asyncio as redis
import logging
import os

from app.api import routes, websocket
from app.workers import start_workers

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Global state
redis_client = None
background_tasks = []

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown.
    """
    # Startup
    global redis_client, background_tasks
    
    logger.info("[Startup] Initializing Memory Service...")
    
    # Connect to Redis
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    redis_client = await redis.from_url(redis_url, decode_responses=True)
    logger.info(f"[Startup] Connected to Redis: {redis_url}")
    
    # Start background workers
    background_tasks = await start_workers(redis_client)
    logger.info(f"[Startup] Started {len(background_tasks)} background workers")
    
    logger.info("[Startup] ✅ Memory Service ready")
    
    yield
    
    # Shutdown
    logger.info("[Shutdown] Stopping Memory Service...")
    
    # Cancel background tasks
    for task in background_tasks:
        task.cancel()
    
    # Close Redis connection
    await redis_client.close()
    
    logger.info("[Shutdown] ✅ Memory Service stopped")

# Create FastAPI app
app = FastAPI(
    title="Memory Service",
    description="Semantic memory extraction and retrieval service",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(routes.router, prefix="/api/v1", tags=["memory"])
app.include_router(websocket.router, tags=["websocket"])

# Health check
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    checks = {
        "redis": await check_redis(),
        "supabase": await check_supabase(),
        "openai": await check_openai()
    }
    
    all_healthy = all(checks.values())
    status_code = 200 if all_healthy else 503
    
    return {
        "status": "healthy" if all_healthy else "degraded",
        "checks": checks
    }

async def check_redis():
    """Check Redis connection"""
    try:
        await redis_client.ping()
        return True
    except:
        return False

async def check_supabase():
    """Check Supabase connection"""
    try:
        from app.db.supabase_client import get_supabase_client
        client = get_supabase_client()
        # Simple query to test connection
        result = client.table('memory_facts').select('id').limit(1).execute()
        return True
    except:
        return False

async def check_openai():
    """Check OpenAI API"""
    try:
        from app.core.embeddings import EmbeddingService
        service = EmbeddingService()
        # Test embedding generation
        await service.embed("test")
        return True
    except:
        return False

# Make redis_client available to other modules
def get_redis_client():
    return redis_client
```

### 1.3 REST API Routes

**File**: `memory-service/app/api/routes.py`

```python
"""
REST API Routes
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
import json
import uuid

from app.main import get_redis_client
from app.core.context_builder import ContextBuilder
from app.core.semantic_memory import SemanticMemoryService

router = APIRouter()

# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class ExtractionRequest(BaseModel):
    user_id: str
    raw_prompt: str
    skill: Optional[str] = None
    optimization_id: Optional[str] = None

class ExtractionResponse(BaseModel):
    job_id: str
    status: str

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    facts: Optional[List[dict]] = None
    error: Optional[str] = None

class ContextRequest(BaseModel):
    user_id: str
    raw_prompt: str

class ContextResponse(BaseModel):
    context: str

class FactsResponse(BaseModel):
    facts: List[dict]

# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("/extract", response_model=ExtractionResponse)
async def queue_extraction(req: ExtractionRequest):
    """
    Queue fact extraction (async, returns immediately).
    
    The extraction happens in the background. Use GET /extract/{job_id}
    to check status.
    """
    redis_client = get_redis_client()
    job_id = str(uuid.uuid4())
    
    # Queue the job
    await redis_client.lpush(
        "fact_extraction_queue",
        json.dumps({
            "job_id": job_id,
            "user_id": req.user_id,
            "raw_prompt": req.raw_prompt,
            "skill": req.skill,
            "optimization_id": req.optimization_id
        })
    )
    
    # Set initial status
    await redis_client.set(f"job:{job_id}:status", "queued", ex=3600)
    
    return ExtractionResponse(job_id=job_id, status="queued")

@router.get("/extract/{job_id}", response_model=JobStatusResponse)
async def get_extraction_status(job_id: str):
    """
    Check extraction job status.
    
    Status values:
    - queued: Job is waiting to be processed
    - processing: Job is currently being processed
    - completed: Job completed successfully
    - failed: Job failed with error
    """
    redis_client = get_redis_client()
    
    status = await redis_client.get(f"job:{job_id}:status")
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    
    response = JobStatusResponse(job_id=job_id, status=status)
    
    # If completed, include facts
    if status == "completed":
        facts_json = await redis_client.get(f"job:{job_id}:facts")
        if facts_json:
            response.facts = json.loads(facts_json)
    
    # If failed, include error
    if status.startswith("failed"):
        response.error = status.split(": ", 1)[1] if ": " in status else "Unknown error"
    
    return response

@router.post("/context", response_model=ContextResponse)
async def build_context(req: ContextRequest):
    """
    Build memory context for optimization (synchronous, fast).
    
    This endpoint is called before each optimization to inject
    relevant memory context.
    """
    try:
        builder = ContextBuilder()
        context = await builder.build_memory_context(req.user_id, req.raw_prompt)
        
        return ContextResponse(context=context)
        
    except Exception as e:
        # Graceful degradation: return empty context
        logger.error(f"[Context] Build failed: {e}")
        return ContextResponse(context="")

@router.get("/facts/{user_id}", response_model=FactsResponse)
async def get_user_facts(user_id: str, category: Optional[str] = None):
    """
    Get all facts for a user (for UI display).
    
    Optional category filter: IDENTITY, DOMAIN, OUTPUT_STYLE, etc.
    """
    try:
        memory = SemanticMemoryService()
        facts = await memory.get_user_facts(user_id, category)
        
        return FactsResponse(facts=facts)
        
    except Exception as e:
        logger.error(f"[Facts] Get failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/facts/{fact_id}")
async def delete_fact(fact_id: str):
    """
    Delete a specific fact.
    """
    try:
        memory = SemanticMemoryService()
        await memory.delete_fact(fact_id)
        
        return {"status": "deleted"}
        
    except Exception as e:
        logger.error(f"[Facts] Delete failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

### 1.4 WebSocket Handler

**File**: `memory-service/app/api/websocket.py`

```python
"""
WebSocket Handler
Real-time updates for memory changes.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

class ConnectionManager:
    """Manages WebSocket connections"""
    
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
    
    async def connect(self, user_id: str, websocket: WebSocket):
        """Accept and store connection"""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"[WebSocket] User {user_id} connected")
    
    def disconnect(self, user_id: str):
        """Remove connection"""
        self.active_connections.pop(user_id, None)
        logger.info(f"[WebSocket] User {user_id} disconnected")
    
    async def send_update(self, user_id: str, message: dict):
        """Send update to specific user"""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except:
                # Connection closed, remove it
                self.disconnect(user_id)

# Global connection manager
manager = ConnectionManager()

@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for real-time memory updates.
    
    Messages sent to client:
    - {"type": "fact_extracted", "fact": {...}}
    - {"type": "fact_reinforced", "fact_id": "..."}
    - {"type": "fact_superseded", "old_id": "...", "new_id": "..."}
    """
    await manager.connect(user_id, websocket)
    
    try:
        while True:
            # Keep connection alive with heartbeat
            data = await websocket.receive_text()
            
            # Echo heartbeat
            if data == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        manager.disconnect(user_id)

# Function called by workers to notify UI
async def notify_fact_extracted(user_id: str, fact: dict):
    """Notify user that a fact was extracted"""
    await manager.send_update(user_id, {
        "type": "fact_extracted",
        "fact": fact
    })

async def notify_fact_reinforced(user_id: str, fact_id: str):
    """Notify user that a fact was reinforced"""
    await manager.send_update(user_id, {
        "type": "fact_reinforced",
        "fact_id": fact_id
    })

async def notify_fact_superseded(user_id: str, old_id: str, new_id: str):
    """Notify user that a fact was superseded"""
    await manager.send_update(user_id, {
        "type": "fact_superseded",
        "old_id": old_id,
        "new_id": new_id
    })
```

### 1.5 Background Workers

**File**: `memory-service/app/workers/__init__.py`

```python
"""
Background Workers
Process queued jobs asynchronously.
"""

import asyncio
import json
import logging

from app.core.extractor import MemoryExtractor
from app.core.embeddings import EmbeddingService
from app.core.semantic_memory import SemanticMemoryService
from app.api.websocket import notify_fact_extracted

logger = logging.getLogger(__name__)

async def extraction_worker(redis_client):
    """
    Continuously process extraction queue.
    
    Flow:
    1. Pop job from queue
    2. Extract facts using LLM
    3. Generate embeddings
    4. Upsert facts with semantic deduplication
    5. Notify via WebSocket
    """
    extractor = MemoryExtractor()
    embedding_service = EmbeddingService()
    memory_service = SemanticMemoryService()
    
    logger.info("[ExtractionWorker] Started")
    
    while True:
        try:
            # Blocking pop with 1s timeout
            result = await redis_client.brpop("fact_extraction_queue", timeout=1)
            
            if not result:
                continue
            
            _, job_data = result
            job = json.loads(job_data)
            job_id = job['job_id']
            
            logger.info(f"[ExtractionWorker] Processing job {job_id}")
            
            # Update status
            await redis_client.set(f"job:{job_id}:status", "processing", ex=3600)
            
            # Extract facts
            facts = await extractor.extract_facts(
                job['raw_prompt'],
                job.get('skill'),
                job.get('optimization_id')
            )
            
            logger.info(f"[ExtractionWorker] Extracted {len(facts)} facts")
            
            # Process each fact
            for fact in facts:
                try:
                    # Generate embedding
                    embedding = await embedding_service.embed(fact['fact'])
                    
                    # Upsert with semantic deduplication
                    await memory_service.upsert_fact(
                        job['user_id'],
                        fact,
                        embedding
                    )
                    
                    # Notify via WebSocket
                    await notify_fact_extracted(job['user_id'], fact)
                    
                except Exception as e:
                    logger.error(f"[ExtractionWorker] Failed to process fact: {e}")
            
            # Mark complete
            await redis_client.set(f"job:{job_id}:status", "completed", ex=3600)
            await redis_client.set(f"job:{job_id}:facts", json.dumps(facts), ex=3600)
            
            logger.info(f"[ExtractionWorker] ✅ Job {job_id} completed")
            
        except Exception as e:
            logger.error(f"[ExtractionWorker] Error: {e}")
            if 'job' in locals():
                await redis_client.set(
                    f"job:{job['job_id']}:status",
                    f"failed: {str(e)}",
                    ex=3600
                )

async def start_workers(redis_client):
    """Start all background workers"""
    tasks = [
        asyncio.create_task(extraction_worker(redis_client)),
        # Add more workers as needed
    ]
    
    logger.info(f"[Workers] Started {len(tasks)} workers")
    return tasks
```

### 1.6 Core Services (Port from Electron)

**Files**:
- `memory-service/app/core/extractor.py` - Port from `memory_extractor.py`
- `memory-service/app/core/embeddings.py` - Port from `embedding-service.ts`
- `memory-service/app/core/semantic_memory.py` - Port from `semantic-memory-service.ts`
- `memory-service/app/core/context_builder.py` - Port from `context-builder-service.ts`

(Implementation details same as Plan 1, just ported to Python)

### 1.7 Docker Configuration

**File**: `memory-service/docker-compose.yml`

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  memory-service:
    build: .
    ports:
      - "8002:8002"
    environment:
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_KEY=${SUPABASE_ANON_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - MEMORY_EXTRACTION_MODEL=claude-haiku-4-5-20251001
    depends_on:
      - redis
    command: uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload

volumes:
  redis_data:
```

**File**: `memory-service/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app/ ./app/

# Expose port
EXPOSE 8002

# Run application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
```

---

## Phase 2: Electron Client (Week 1, 8 hours)

### 2.1 Memory Client

**File**: `electron/main/api/memory-client.ts`

```typescript
import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';

export interface ExtractionRequest {
  user_id: string;
  raw_prompt: string;
  skill: string | null;
  optimization_id: string;
}

export interface ContextRequest {
  user_id: string;
  raw_prompt: string;
}

export interface JobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  facts?: any[];
  error?: string;
}

/**
 * MemoryClient
 * HTTP/WebSocket client for Memory Service.
 */
export class MemoryClient {
  private http: AxiosInstance;
  private ws: WebSocket | null = null;
  private baseUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(baseUrl: string = 'http://localhost:8002') {
    this.baseUrl = baseUrl;
    this.http = axios.create({
      baseURL: `${baseUrl}/api/v1`,
      timeout: 5000,
    });
  }

  /**
   * Queue fact extraction (async, non-blocking)
   */
  async queueExtraction(req: ExtractionRequest): Promise<{ job_id: string }> {
    try {
      const response = await this.http.post('/extract', req);
      return response.data;
    } catch (error) {
      console.error('[MemoryClient] Extraction queue failed:', error);
      throw error;
    }
  }

  /**
   * Check extraction job status
   */
  async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      const response = await this.http.get(`/extract/${jobId}`);
      return response.data;
    } catch (error) {
      console.error('[MemoryClient] Get job status failed:', error);
      throw error;
    }
  }

  /**
   * Build memory context (synchronous, fast)
   */
  async buildContext(req: ContextRequest): Promise<string> {
    try {
      const response = await this.http.post('/context', req);
      return response.data.context;
    } catch (error) {
      console.error('[MemoryClient] Context build failed:', error);
      // Graceful degradation: return empty context
      return '';
    }
  }

  /**
   * Get user facts (for UI display)
   */
  async getUserFacts(userId: string, category?: string): Promise<any[]> {
    try {
      const response = await this.http.get(`/facts/${userId}`, {
        params: { category }
      });
      return response.data.facts;
    } catch (error) {
      console.error('[MemoryClient] Get facts failed:', error);
      return [];
    }
  }

  /**
   * Delete a fact
   */
  async deleteFact(factId: string): Promise<void> {
    await this.http.delete(`/facts/${factId}`);
  }

  /**
   * Connect to WebSocket for real-time updates
   */
  connectWebSocket(userId: string, onUpdate: (data: any) => void): void {
    const wsUrl = `${this.baseUrl.replace('http', 'ws')}/ws/${userId}`;
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      console.log('[MemoryClient] WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Start heartbeat
      const heartbeat = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send('ping');
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);
    });
    
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type !== 'pong') {
          onUpdate(message);
        }
      } catch (error) {
        console.error('[MemoryClient] Failed to parse WebSocket message:', error);
      }
    });
    
    this.ws.on('error', (error) => {
      console.error('[MemoryClient] WebSocket error:', error);
    });
    
    this.ws.on('close', () => {
      console.log('[MemoryClient] WebSocket disconnected');
      
      // Reconnect with exponential backoff
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        
        console.log(`[MemoryClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        setTimeout(() => this.connectWebSocket(userId, onUpdate), delay);
      }
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.http.get('/health', { timeout: 2000 });
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  }
}
```

### 2.2 Service Abstraction Layer

**File**: `electron/main/database/services/memory-service-interface.ts`

```typescript
/**
 * IMemoryService
 * Abstract interface for memory service.
 * Allows switching between local and remote implementations.
 */
export interface IMemoryService {
  /**
   * Queue fact extraction (async, non-blocking)
   */
  queueExtraction(
    userId: string,
    rawPrompt: string,
    skill: string | null,
    optimizationId: string
  ): Promise<void>;

  /**
   * Build memory context for optimization
   */
  buildContext(userId: string, rawPrompt: string): Promise<string>;

  /**
   * Get user facts for UI display
   */
  getUserFacts(userId: string, category?: string): Promise<any[]>;

  /**
   * Delete a fact
   */
  deleteFact(factId: string): Promise<void>;

  /**
   * Connect to real-time updates
   */
  connectRealtime?(userId: string, onUpdate: (data: any) => void): void;

  /**
   * Disconnect from real-time updates
   */
  disconnectRealtime?(): void;
}
```

### 2.3 Local Implementation (Existing)

**File**: `electron/main/database/services/local-memory-service.ts`

```typescript
import { IMemoryService } from './memory-service-interface';
import { MemoryExtractorService } from './memory-extractor-service';
import { SemanticMemoryService } from './semantic-memory-service';
import { ContextBuilderService } from './context-builder-service';

/**
 * LocalMemoryService
 * Local implementation using Electron services.
 */
export class LocalMemoryService implements IMemoryService {
  constructor(
    private extractor: MemoryExtractorService,
    private semantic: SemanticMemoryService,
    private contextBuilder: ContextBuilderService
  ) {}

  async queueExtraction(
    userId: string,
    rawPrompt: string,
    skill: string | null,
    optimizationId: string
  ): Promise<void> {
    // Extract facts
    const facts = await this.extractor.extractFacts(rawPrompt, skill, optimizationId);
    
    // Upsert each fact
    for (const fact of facts) {
      await this.semantic.upsertFact(userId, fact);
    }
  }

  async buildContext(userId: string, rawPrompt: string): Promise<string> {
    return await this.contextBuilder.buildMemoryContext(userId, rawPrompt);
  }

  async getUserFacts(userId: string, category?: string): Promise<any[]> {
    return await this.semantic.getUserFacts(userId, category);
  }

  async deleteFact(factId: string): Promise<void> {
    await this.semantic.deleteFact(factId);
  }
}
```

### 2.4 Remote Implementation

**File**: `electron/main/database/services/remote-memory-service.ts`

```typescript
import { IMemoryService } from './memory-service-interface';
import { MemoryClient } from '../../api/memory-client';

/**
 * RemoteMemoryService
 * Remote implementation using Memory Service API.
 */
export class RemoteMemoryService implements IMemoryService {
  constructor(private client: MemoryClient) {}

  async queueExtraction(
    userId: string,
    rawPrompt: string,
    skill: string | null,
    optimizationId: string
  ): Promise<void> {
    await this.client.queueExtraction({
      user_id: userId,
      raw_prompt: rawPrompt,
      skill,
      optimization_id: optimizationId
    });
  }

  async buildContext(userId: string, rawPrompt: string): Promise<string> {
    return await this.client.buildContext({
      user_id: userId,
      raw_prompt: rawPrompt
    });
  }

  async getUserFacts(userId: string, category?: string): Promise<any[]> {
    return await this.client.getUserFacts(userId, category);
  }

  async deleteFact(factId: string): Promise<void> {
    await this.client.deleteFact(factId);
  }

  connectRealtime(userId: string, onUpdate: (data: any) => void): void {
    this.client.connectWebSocket(userId, onUpdate);
  }

  disconnectRealtime(): void {
    this.client.disconnectWebSocket();
  }
}
```

### 2.5 Factory Pattern

**File**: `electron/main/database/services/memory-service-factory.ts`

```typescript
import { IMemoryService } from './memory-service-interface';
import { LocalMemoryService } from './local-memory-service';
import { RemoteMemoryService } from './remote-memory-service';
import { MemoryClient } from '../../api/memory-client';

/**
 * Create memory service based on configuration
 */
export function createMemoryService(): IMemoryService {
  const useRemote = process.env.USE_REMOTE_MEMORY === 'true';
  
  if (useRemote) {
    console.log('[Memory] Using remote memory service');
    const client = new MemoryClient(process.env.MEMORY_SERVICE_URL);
    return new RemoteMemoryService(client);
  } else {
    console.log('[Memory] Using local memory service');
    // Initialize local services (from Plan 1)
    // ... (existing initialization code)
    return new LocalMemoryService(extractor, semantic, contextBuilder);
  }
}
```

---

## Phase 3: Dual-Write Migration (Week 2, 8 hours)

### 3.1 Dual-Write Wrapper

**File**: `electron/main/database/services/dual-write-memory-service.ts`

```typescript
import { IMemoryService } from './memory-service-interface';

/**
 * DualWriteMemoryService
 * Writes to both local and remote services for migration.
 */
export class DualWriteMemoryService implements IMemoryService {
  constructor(
    private local: IMemoryService,
    private remote: IMemoryService
  ) {}

  async queueExtraction(
    userId: string,
    rawPrompt: string,
    skill: string | null,
    optimizationId: string
  ): Promise<void> {
    // Write to both (fire-and-forget for remote)
    await this.local.queueExtraction(userId, rawPrompt, skill, optimizationId);
    
    this.remote.queueExtraction(userId, rawPrompt, skill, optimizationId)
      .catch(err => console.warn('[DualWrite] Remote extraction failed:', err));
  }

  async buildContext(userId: string, rawPrompt: string): Promise<string> {
    // Read from local (primary)
    try {
      return await this.local.buildContext(userId, rawPrompt);
    } catch (error) {
      console.warn('[DualWrite] Local context failed, trying remote:', error);
      return await this.remote.buildContext(userId, rawPrompt);
    }
  }

  async getUserFacts(userId: string, category?: string): Promise<any[]> {
    // Read from local (primary)
    return await this.local.getUserFacts(userId, category);
  }

  async deleteFact(factId: string): Promise<void> {
    // Delete from both
    await Promise.all([
      this.local.deleteFact(factId),
      this.remote.deleteFact(factId)
    ]);
  }
}
```

### 3.2 Migration Configuration

**Update**: `.env`

```env
# Memory service migration
USE_REMOTE_MEMORY=false          # false = local, true = remote
ENABLE_DUAL_WRITE=true           # true during migration
MEMORY_SERVICE_URL=http://localhost:8002
```

### 3.3 Factory Update

**Update**: `memory-service-factory.ts`

```typescript
export function createMemoryService(): IMemoryService {
  const useRemote = process.env.USE_REMOTE_MEMORY === 'true';
  const enableDualWrite = process.env.ENABLE_DUAL_WRITE === 'true';
  
  if (enableDualWrite) {
    console.log('[Memory] Using dual-write mode (migration)');
    const local = createLocalService();
    const remote = createRemoteService();
    return new DualWriteMemoryService(local, remote);
  }
  
  if (useRemote) {
    console.log('[Memory] Using remote memory service');
    return createRemoteService();
  } else {
    console.log('[Memory] Using local memory service');
    return createLocalService();
  }
}
```

---

## Phase 4: Validation & Cutover (Week 2, 8 hours)

### 4.1 Consistency Checker

**File**: `electron/main/utils/memory-consistency-checker.ts`

```typescript
import { LocalMemoryService } from '../database/services/local-memory-service';
import { RemoteMemoryService } from '../database/services/remote-memory-service';

/**
 * Check consistency between local and remote memory stores
 */
export class MemoryConsistencyChecker {
  constructor(
    private local: LocalMemoryService,
    private remote: RemoteMemoryService
  ) {}

  async checkConsistency(userId: string): Promise<{
    consistent: boolean;
    localCount: number;
    remoteCount: number;
    mismatches: any[];
  }> {
    const localFacts = await this.local.getUserFacts(userId);
    const remoteFacts = await this.remote.getUserFacts(userId);
    
    const localMap = new Map(localFacts.map(f => [f.id, f]));
    const remoteMap = new Map(remoteFacts.map(f => [f.id, f]));
    
    const mismatches: any[] = [];
    
    // Check facts in local but not in remote
    for (const [id, fact] of localMap) {
      if (!remoteMap.has(id)) {
        mismatches.push({ type: 'missing_in_remote', fact });
      }
    }
    
    // Check facts in remote but not in local
    for (const [id, fact] of remoteMap) {
      if (!localMap.has(id)) {
        mismatches.push({ type: 'missing_in_local', fact });
      }
    }
    
    return {
      consistent: mismatches.length === 0,
      localCount: localFacts.length,
      remoteCount: remoteFacts.length,
      mismatches
    };
  }
}
```

### 4.2 Migration Steps

```markdown
## Migration Checklist

### Week 1: Preparation
- [ ] Deploy memory service to staging
- [ ] Run load tests
- [ ] Verify health checks
- [ ] Test WebSocket connections
- [ ] Monitor Redis queue

### Week 2: Dual-Write Phase
- [ ] Enable dual-write mode
- [ ] Monitor consistency
- [ ] Fix any discrepancies
- [ ] Run consistency checker daily
- [ ] Verify no data loss

### Week 3: Cutover
- [ ] Switch reads to remote service
- [ ] Monitor latency
- [ ] Monitor error rates
- [ ] Verify WebSocket updates
- [ ] Keep dual-write enabled

### Week 4: Cleanup
- [ ] Disable dual-write
- [ ] Deprecate local services
- [ ] Remove old code
- [ ] Update documentation
- [ ] Celebrate! 🎉
```

---

## Deployment

### Production Deployment (Railway)

```bash
# 1. Create Railway project
railway init

# 2. Add Redis
railway add redis

# 3. Deploy service
railway up

# 4. Set environment variables
railway variables set SUPABASE_URL=...
railway variables set OPENAI_API_KEY=...

# 5. Get service URL
railway domain
```

### Monitoring

**File**: `memory-service/app/monitoring.py`

```python
from prometheus_client import Counter, Histogram, Gauge
import time

# Metrics
extraction_requests = Counter('memory_extraction_requests_total', 'Total extraction requests')
extraction_duration = Histogram('memory_extraction_duration_seconds', 'Extraction duration')
context_build_duration = Histogram('memory_context_build_duration_seconds', 'Context build duration')
active_connections = Gauge('memory_websocket_connections', 'Active WebSocket connections')
queue_size = Gauge('memory_queue_size', 'Size of extraction queue')

# Middleware to track metrics
@app.middleware("http")
async def track_metrics(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time
    
    # Track by endpoint
    if request.url.path.startswith('/api/v1/extract'):
        extraction_duration.observe(duration)
    elif request.url.path.startswith('/api/v1/context'):
        context_build_duration.observe(duration)
    
    return response
```

---

## Cost Analysis

### Infrastructure Costs

| Component | Service | Cost/Month |
|-----------|---------|------------|
| Memory Service | Railway Hobby | $5 |
| Redis | Railway Redis | $5 |
| Total | | **$10/month** |

### Scaling Costs

| Users | Memory Service | Redis | Total |
|-------|----------------|-------|-------|
| 0-100 | $5 | $5 | $10 |
| 100-500 | $10 | $10 | $20 |
| 500-1000 | $20 | $15 | $35 |
| 1000+ | $50+ | $25+ | $75+ |

---

## Success Criteria

### Performance
- ✅ Context build latency < 200ms (p95)
- ✅ Extraction queue processing < 2s (p95)
- ✅ WebSocket latency < 100ms
- ✅ Service uptime > 99.5%

### Reliability
- ✅ Zero data loss during migration
- ✅ Graceful degradation on service failure
- ✅ Automatic reconnection on disconnect
- ✅ Queue persistence across restarts

### Cost
- ✅ Infrastructure cost < $20/month for 100 users
- ✅ LLM costs unchanged from monolithic
- ✅ No unexpected cost spikes

---

## Rollback Plan

### If Migration Fails

1. **Immediate**: Set `USE_REMOTE_MEMORY=false`
2. **Verify**: Local service still functional
3. **Investigate**: Check logs for root cause
4. **Fix**: Address issues in staging
5. **Retry**: Attempt migration again

### Data Recovery

- All data exists in Supabase (shared by both systems)
- No data loss possible
- Can rebuild either system from Supabase

---

## Conclusion

This migration plan provides a safe, incremental path from monolithic to microservice architecture. The dual-write phase ensures zero data loss, and the abstraction layer allows easy rollback if needed.

**Key Takeaways:**
1. Start with monolithic (Plan 1) for MVP
2. Migrate when you have 50-100+ users
3. Use dual-write for safe migration
4. Monitor consistency throughout
5. Rollback is always possible
