from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class IndexStatus(str, Enum):
    INDEXING = "indexing"
    READY = "ready"
    STALE = "stale"
    ERROR = "error"
    PARTIAL = "partial"


class ChunkType(str, Enum):
    FILE = "file"
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"


class RelationshipType(str, Enum):
    CALLS = "calls"
    IMPORTS = "imports"
    INHERITS = "inherits"
    IMPLEMENTS = "implements"


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    repo_url: Optional[str] = None
    local_path: Optional[str] = None
    default_branch: str = "main"
    github_repo_owner: Optional[str] = None
    github_repo_name: Optional[str] = None


class ProjectResponse(BaseModel):
    id: str
    user_id: str
    name: str
    repo_url: Optional[str] = None
    local_path: Optional[str] = None
    current_branch: Optional[str] = None
    default_branch: str = "main"
    index_status: str = "stale"
    last_indexed_at: Optional[str] = None
    github_repo_owner: Optional[str] = None
    github_repo_name: Optional[str] = None


class ChunkInput(BaseModel):
    file_path: str
    start_line: int
    end_line: int
    chunk_type: ChunkType
    name: str
    signature: Optional[str] = None
    language: str
    docstring: Optional[str] = None
    content_hash: str
    callees: list[str] = Field(default_factory=list)
    imports: list[str] = Field(default_factory=list)
    code_body: Optional[str] = Field(default=None, max_length=5000)
    is_exported: bool = False


class CallGraphEdge(BaseModel):
    from_name: str
    from_file: str
    to_name: str
    to_file: str
    relationship_type: RelationshipType = RelationshipType.CALLS


class IngestRequest(BaseModel):
    project_id: str
    chunks: list[ChunkInput] = Field(..., max_length=10_000)
    call_graph: list[CallGraphEdge] = Field(default_factory=list)
    language_map: dict[str, int] = Field(default_factory=dict)
    branch: Optional[str] = None


class RetrieveRequest(BaseModel):
    project_id: str
    query: str = Field(..., min_length=1, max_length=10_000)
    branch: Optional[str] = None
    limit: int = Field(default=15, ge=1, le=50)


class RetrievedChunk(BaseModel):
    id: str
    file_path: str
    start_line: int
    end_line: int
    chunk_type: str
    name: str
    signature: Optional[str] = None
    language: str
    semantic_summary: Optional[str] = None
    code_body: Optional[str] = None
    concepts: list[str] = Field(default_factory=list)
    similarity_score: float
    branch: Optional[str] = None
    branch_diverged: bool = False


class RetrieveResponse(BaseModel):
    ranked_chunks: list[RetrievedChunk]
    related_chunks: list[RetrievedChunk]
    branch_context: Optional[dict] = None
    query_intent: Optional[str] = None
    query_concepts: list[str] = Field(default_factory=list)


class ContextRequest(BaseModel):
    project_id: str
    query: str = Field(..., min_length=1, max_length=10_000)
    branch: Optional[str] = None
    limit: int = Field(default=10, ge=1, le=50)


class ProbableLocation(BaseModel):
    file_path: str
    start_line: int
    end_line: int
    chunk_type: str
    name: str
    signature: Optional[str] = None
    language: str
    semantic_summary: Optional[str] = None
    code_body: Optional[str] = None
    concepts: list[str] = Field(default_factory=list)
    confidence_score: float
    is_exported: bool = False
    branch: Optional[str] = None
    branch_diverged: bool = False


class ContextResponse(BaseModel):
    probable_locations: list[ProbableLocation] = Field(default_factory=list)
    related_locations: list[ProbableLocation] = Field(default_factory=list)
    intent: str = "general"
    concepts: list[str] = Field(default_factory=list)
    project_summary: Optional[str] = None
    branch_context: Optional[dict] = None


class SyncRequest(BaseModel):
    project_id: Optional[str] = None


class WebhookPayload(BaseModel):
    ref: Optional[str] = None
    commits: Optional[list[dict]] = None
    repository: Optional[dict] = None
    sender: Optional[dict] = None
