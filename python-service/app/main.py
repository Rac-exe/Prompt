import sys
import os
from pathlib import Path

# Load .env from the project root BEFORE any pipeline imports so that
# os.environ is populated when config.py reads OPENROUTER_API_KEY etc.
try:
    from dotenv import load_dotenv as _load_dotenv
    _env_path = Path(__file__).parent.parent.parent / ".env"
    _load_dotenv(dotenv_path=_env_path, override=False)
except ImportError:
    pass  # python-dotenv not installed; rely on system env vars

# Force UTF-8 stdout/stderr so emoji and non-ASCII chars don't crash the server
# on Windows where the default console encoding is cp1252.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.auth import require_auth, require_ws_auth
import logging
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

# Configure structured logging — INFO goes to stdout; WARNING+ become Sentry breadcrumbs;
# ERROR+ become Sentry events via LoggingIntegration.
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger("prmpt")

def _scrub_prompts(event, hint):
    _pii_words = ("prompt", "content", "message", "text")
    def _is_pii(k):
        kl = k.lower()
        return any(w in kl for w in _pii_words)

    if event.get("extra"):
        for key in list(event["extra"].keys()):
            if _is_pii(key):
                event["extra"][key] = "[REDACTED]"

    for bc in event.get("breadcrumbs", {}).get("values", []):
        if bc.get("data"):
            for key in list(bc["data"].keys()):
                if _is_pii(key):
                    bc["data"][key] = "[REDACTED]"

    req_data = event.get("request", {}).get("data")
    if isinstance(req_data, dict):
        for key in list(req_data.keys()):
            if _is_pii(key):
                req_data[key] = "[REDACTED]"

    for exc in event.get("exception", {}).get("values", []):
        if _is_pii(exc.get("value", "")):
            exc["value"] = "[REDACTED]"
        for frame in exc.get("stacktrace", {}).get("frames", []):
            if frame.get("vars"):
                for key in list(frame["vars"].keys()):
                    if _is_pii(key):
                        frame["vars"][key] = "[REDACTED]"

    return event

_is_dev = os.environ.get("APP_ENV", "development") == "development"

_sentry_dsn = os.environ.get("SENTRY_PYTHON_DSN", "")
_app_env = os.environ.get("APP_ENV", "development")
_app_version = os.environ.get("APP_VERSION", "0.0.0-dev")
DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY", "")

if not _sentry_dsn:
    logger.warning("[Sentry] SENTRY_PYTHON_DSN is not set — error tracking is disabled")
if _app_env == "development" and not _is_dev:
    logger.warning("[Sentry] APP_ENV is unset or 'development' but appears to be a production build — set APP_ENV=production")
if _app_version == "0.0.0-dev":
    logger.warning("[Sentry] APP_VERSION is not set — Sentry release will report as 0.0.0-dev")

sentry_sdk.init(
    dsn=_sentry_dsn,
    release=f"prmpt-python@{_app_version}",
    environment=_app_env,
    traces_sample_rate=1.0 if _is_dev else 0.2,
    send_default_pii=False,
    before_send=_scrub_prompts,
    integrations=[
        # Explicitly configure LoggingIntegration: INFO → breadcrumbs, ERROR → Sentry events.
        LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
    ],
)

import json
import time
import re
import base64
import websockets
import numpy as np
import io
import wave
import math
from scipy.signal import resample_poly
from math import gcd
from faster_whisper import WhisperModel
import asyncio
import torch

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next):
        import uuid as _uuid
        req_id = request.headers.get("x-request-id") or str(_uuid.uuid4())
        response: StarletteResponse = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

app = FastAPI()
app.add_middleware(RequestIDMiddleware)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["60/minute"],
    application_limits=["200/minute"],
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Preload heavy modules to eliminate cold start latency
logger.info("Loading pipeline_v2 modules...")
from pipeline_v2.context import ChatContext
from pipeline_v2.optimizer import optimize as pipeline_optimize
from pipeline_v2.config import (
    OPTIMIZER_MODEL, SUMMARIZER_MODEL, TITLE_MODEL, MEMORY_MODEL, OPENROUTER_API_KEY,
)
import uuid
logger.info("pipeline_v2 loaded")

@app.on_event("startup")
async def startup_event():
    """Single startup handler: warms up OpenRouter + preloads Whisper/VAD in parallel."""
    loop = asyncio.get_event_loop()

    async def _warmup_openrouter():
        try:
            logger.info("Warming up OpenRouter connection...")
            import litellm as _litellm
            kwargs: dict = {
                "model": OPTIMIZER_MODEL,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 1,
            }
            if OPENROUTER_API_KEY and "openrouter" in OPTIMIZER_MODEL.lower():
                kwargs["api_key"] = OPENROUTER_API_KEY
            await loop.run_in_executor(None, lambda: _litellm.completion(**kwargs))
            logger.info("OpenRouter connection warmed up")
        except Exception as e:
            logger.warning(f"Warmup failed (harmless if offline): {e}")

    async def _load_whisper():
        try:
            logger.info("Preloading faster-whisper model …")
            await loop.run_in_executor(None, get_faster_whisper_model)
            logger.info("faster-whisper ready")
        except Exception as e:
            logger.warning(f"faster-whisper preload failed: {e}")

    async def _load_vad():
        try:
            logger.info("Preloading Silero VAD model …")
            await loop.run_in_executor(None, get_vad_model)
            logger.info("Silero VAD ready")
        except Exception as e:
            logger.warning(f"Silero VAD preload failed: {e}")

    await asyncio.gather(_warmup_openrouter(), _load_whisper(), _load_vad())


# ============================================
# SKILL MANAGER - DISABLED (using simple system prompt instead)
# ============================================
# Skill system has been disabled to use a single, clear system prompt
# which prevents the LLM from generating content instead of optimizing prompts


# CORS middleware — defaults to localhost only; set ALLOWED_ORIGINS to override.
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()] if _raw_origins else [
    "http://127.0.0.1",
    "http://localhost",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

# Adaptive prompt optimization system with type detection and specialized strategies

def detect_prompt_type(prompt: str) -> str:
    """
    Detect the type of prompt to apply appropriate optimization strategy.
    Returns: coding, email, analysis, creative, image, documentation, business, or general
    """
    prompt_lower = prompt.lower()

    # Coding/Technical
    coding_keywords = ['function', 'code', 'program', 'script', 'algorithm', 'debug', 'implement',
                       'api', 'database', 'class', 'method', 'variable', 'loop', 'array', 'regex',
                       'python', 'javascript', 'java', 'c++', 'sql', 'html', 'css', 'react']
    if any(keyword in prompt_lower for keyword in coding_keywords):
        return 'coding'

    # Email/Communication
    email_keywords = ['email', 'message', 'letter', 'memo', 'write to', 'send to', 'contact',
                      'reach out', 'follow up', 'thank you note']
    if any(keyword in prompt_lower for keyword in email_keywords):
        return 'email'

    # Data Analysis
    analysis_keywords = ['analyze', 'analysis', 'data', 'statistics', 'metrics', 'trends',
                         'compare', 'evaluate', 'assess', 'review', 'report', 'findings',
                         'quarterly', 'sales', 'performance', 'financial']
    if any(keyword in prompt_lower for keyword in analysis_keywords):
        return 'analysis'

    # Creative Writing
    creative_keywords = ['story', 'poem', 'novel', 'character', 'plot', 'narrative', 'creative',
                        'fiction', 'write about', 'describe', 'imagine', 'fantasy', 'sci-fi']
    if any(keyword in prompt_lower for keyword in creative_keywords):
        return 'creative'

    # Image Generation
    image_keywords = ['image', 'picture', 'photo', 'illustration', 'drawing', 'painting',
                      'artwork', 'generate', 'create visual', 'design']
    if any(keyword in prompt_lower for keyword in image_keywords):
        return 'image'

    # Documentation
    doc_keywords = ['document', 'explain', 'guide', 'tutorial', 'how to', 'instructions',
                    'manual', 'documentation', 'walkthrough']
    if any(keyword in prompt_lower for keyword in doc_keywords):
        return 'documentation'

    # Business Communication
    business_keywords = ['client', 'project', 'proposal', 'meeting', 'deadline', 'budget',
                        'stakeholder', 'presentation', 'strategy', 'plan']
    if any(keyword in prompt_lower for keyword in business_keywords):
        return 'business'

    return 'general'


def get_optimization_strategy(prompt_type: str) -> str:
    """
    Returns the specialized system prompt for the detected prompt type.
    """

    strategies = {
        'coding': """Transform the coding request into a comprehensive technical specification PROMPT.

CRITICAL: Create INSTRUCTIONS for writing code, NOT the code itself.

Include these elements in your optimized prompt:
- Role context: "You are an expert software engineer..."
- Clear requirements: What the code should do
- Technical specifications: Language, frameworks, algorithms
- Edge cases: What scenarios to handle
- Code quality requirements: Type hints, docstrings, error handling
- Testing approach: What to validate
- Output structure: Function signature, implementation, usage example

Return ONLY the optimized prompt - a set of instructions for someone to write the code.""",

        'email': """Transform the email request into a structured communication PROMPT.

CRITICAL: Create INSTRUCTIONS for writing an email, NOT the email itself.

Include these elements in your optimized prompt:
- Role context: "You are a professional communicator..."
- Email structure: Subject line, opening, body, closing
- Tone requirements: Professional, concise, respectful
- Content to include: Purpose, key details, call-to-action
- Length guidance: Typically 3-4 paragraphs
- Audience consideration: Relationship to recipient
- Any specific requirements from the original request

Return ONLY the optimized prompt - a set of instructions for someone to write the email.""",

        'analysis': """You are a senior data analyst specializing in business intelligence.

Transform the analysis request into a comprehensive analytical framework.

Add these elements:
- Role context: Frame as senior analyst with domain expertise
- Chain of thought: Request step-by-step analytical approach
- Framework: Provide structure (overview → trends → root causes → insights → recommendations)
- Depth: Request specific numbers, percentages, comparisons
- Output structure: Organize findings logically with executive summary
- Actionable insights: Emphasize practical recommendations
- Visualization: Suggest appropriate charts/graphs if relevant

Output format: Structured analytical prompt with clear methodology.

Return ONLY the optimized prompt as plain text.""",

        'creative': """Transform the creative writing request into an inspiring PROMPT.

CRITICAL: Create INSTRUCTIONS for creative writing, NOT the poem/story/content itself.

Include these elements in your optimized prompt:
- Role context: "You are an award-winning writer..."
- What to create: Poem, story, character description, etc.
- Structure: Narrative arc, stanza format, story beats
- Style and tone: Voice, mood, point of view
- Specific elements: Setting, themes, sensory details
- Constraints: Word count, format, pacing
- Quality guidance: Avoid clichés, create emotional resonance
- Theme or message: What the piece should convey

Return ONLY the optimized prompt - a set of instructions for someone to create the content.""",

        'image': """You are a professional visual designer and art director.

Transform the image request into a detailed visual specification.

Add these elements:
- Visual details: Expand with lighting, colors, textures, atmosphere
- Composition: Suggest framing, perspective, focal points (rule of thirds, etc.)
- Subject details: Enhance with specific characteristics, poses, expressions
- Environment: Add background, setting, context elements
- Mood/atmosphere: Specify emotional tone and feeling
- Technical specs: Mention style (photorealistic, artistic, etc.), quality level
- Lighting: Detail light sources, shadows, time of day

Output format: Rich, descriptive prompt optimized for image generation.

Return ONLY the optimized prompt as plain text.""",

        'documentation': """You are a technical documentation specialist writing for developers.

Transform the documentation request into a comprehensive doc structure.

Add these elements:
- Role context: Frame as technical writer for specific audience
- Structure: Define sections (overview, prerequisites, step-by-step, examples, troubleshooting)
- Clarity: Request active voice, second person, clear headers
- Code examples: Specify need for copy-paste ready examples
- Completeness: Request edge cases, common errors, best practices
- Audience level: Specify assumed knowledge level
- Format: Use bullet points, numbered steps, code blocks appropriately

Output format: Structured documentation prompt with clear organization.

Return ONLY the optimized prompt as plain text.""",

        'business': """You are an experienced business professional and project manager.

Transform the business communication into a strategic, professional prompt.

Add these elements:
- Role context: Frame as experienced business professional
- Structure: Define logical flow (situation → impact → action → outcome)
- Tone: Specify professional, solution-focused communication
- Stakeholder focus: Consider audience needs and concerns
- Clarity: Request specific details (dates, metrics, actions)
- Accountability: Balance transparency with confidence
- Next steps: Include clear actions and follow-up plan

Output format: Professional business communication prompt with strategic framing.

Return ONLY the optimized prompt as plain text.""",

        'general': """You are an expert prompt optimization specialist.

Transform the request into a clearer, more specific, and more effective version.

Enhancement approach:
- Add clarity: Make vague requests specific
- Add structure: Organize complex requests logically
- Add context: Include relevant background or constraints
- Add guidance: Specify desired format, tone, or approach
- Remove ambiguity: Clarify unclear elements
- Maintain intent: Preserve the original meaning exactly

Output format: Clear, actionable prompt that will generate better results.

Return ONLY the optimized prompt as plain text."""
    }

    return strategies.get(prompt_type, strategies['general'])


# Main system prompt that orchestrates the adaptive optimization
SYSTEM_PROMPT = """You are a prompt improvement tool. You transform rough prompts into detailed, clear prompts.

CRITICAL: Your output must be ONLY the improved prompt text. Nothing else.

DO NOT:
- Answer the prompt
- Explain what you're doing
- Include symbols like ❌ or ✅
- Write "Here is..." or "CORRECT:" or any meta-text
- Write the final deliverable (don't write the actual email/code/poem)
- Have a conversation

DO:
- Output ONLY the improved version of the prompt itself
- Start immediately with the improved prompt text
- Make prompts more specific, detailed, and actionable

EXAMPLES:

User gives you: "write an email to boss for vacation"
You output: Compose a professional email to your supervisor requesting vacation leave. Include: clear subject line, specific dates requested, brief reason for time off, plan for coverage during absence, and professional closing. Tone should be respectful and concise, approximately 3-4 paragraphs.

User gives you: "what is this behavior"
You output: Analyze and identify the specific behavior being observed. Describe its characteristics, potential causes, underlying mechanisms, and typical contexts where this behavior occurs. Provide concrete examples and explain any relevant patterns or triggers.

User gives you: "write code for todo app"
You output: Develop a fully functional todo application with these features: add new tasks, delete tasks, edit existing tasks, mark tasks as complete/incomplete, persistent data storage. Use React for frontend, include proper state management, implement error handling and input validation. Provide complete working code with explanatory comments.

User gives you: "make this sound better: I need time off"
You output: Rewrite the following request to be more professional and persuasive while maintaining a respectful tone. Enhance clarity and provide appropriate context for a workplace time-off request.

Remember: Output ONLY the improved prompt. Start your response directly with it."""

class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str = Field(..., max_length=50_000)

class OptimizeRequest(BaseModel):
    prompt: str = Field(..., min_length=3, max_length=50_000)
    skip_cache: Optional[bool] = False
    messages: Optional[list[Message]] = Field(None, max_length=100)
    mode: Optional[str] = "fast"
    custom_instructions: Optional[str] = Field("", max_length=10_000)
    user_id: Optional[str] = None

class OptimizeResponse(BaseModel):
    optimized: str
    original: str
    model: str = ""
    latency_ms: Optional[float] = None

# ── Prompt cache with TTL (SCALE-01) ──────────────────────────────────────────
from cachetools import TTLCache
prompt_cache: TTLCache = TTLCache(maxsize=200, ttl=300)  # 200 entries, 5-min TTL

# ── Server-side rate limiting with daily cleanup (SCALE-02) ───────────────────
import asyncio as _asyncio
_rate_lock = _asyncio.Lock()
_rate_counters: dict[str, int] = {}   # key: "<user_id>:<YYYY-MM-DD>"
_rate_last_date: str = ""

DAILY_REQUEST_LIMIT = int(os.environ.get("DAILY_REQUEST_LIMIT", "50"))

_optimize_semaphore = _asyncio.Semaphore(int(os.environ.get("MAX_CONCURRENT_OPTIMIZATIONS", "50")))


async def _check_rate_limit(user_id: str) -> bool:
    """Return True if the user may proceed, False if daily limit reached."""
    from datetime import datetime, timezone
    global _rate_last_date
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    key = f"{user_id}:{today}"
    async with _rate_lock:
        if _rate_last_date != today:
            _rate_counters.clear()
            _rate_last_date = today
        count = _rate_counters.get(key, 0)
        if count >= DAILY_REQUEST_LIMIT:
            return False
        _rate_counters[key] = count + 1
        return True

def clean_optimized_text(text: str) -> str:
    """Remove markdown code blocks and other formatting artifacts."""
    # Remove markdown code blocks
    text = re.sub(r'^```[\w]*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n?```$', '', text, flags=re.MULTILINE)

    # Remove common prefixes (case insensitive)
    prefixes = [
        "Here is a polished, professional prompt ready for immediate use:",
        "Here is an optimized prompt",
        "Here's the optimized version:",
        "Here's the optimized prompt:",
        "Here is the optimized prompt:",
        "Optimized prompt:",
        "Optimized version:",
        "Optimized:",
    ]
    for prefix in prefixes:
        # Case insensitive check
        if text.strip().lower().startswith(prefix.lower()):
            text = text.strip()[len(prefix):].strip()
            break  # Only remove first matching prefix

    # Remove leading/trailing quotes if present
    text = text.strip()
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()

    return text.strip()

@app.post("/optimize", response_model=OptimizeResponse)
async def optimize_prompt(request: OptimizeRequest, auth: dict = Depends(require_auth)):
    # Derive user_id from verified JWT rather than trusting request body
    user_id = auth.get("sub") or request.user_id
    if user_id:
        sentry_sdk.set_user({"id": user_id})

    start_time = time.time()

    if not request.prompt or len(request.prompt.strip()) < 3:
        raise HTTPException(status_code=400, detail="Prompt too short (minimum 3 characters)")

    prompt_text = request.prompt.strip()

    # For regenerate requests, add a unique identifier to force different results
    if request.skip_cache:
        unique_id = str(int(time.time() * 1000000))  # Microsecond precision
        prompt_text = f"{prompt_text}\n\n[REGENERATE_{unique_id}]"
        logger.info(f"Regenerate request - added unique ID: {unique_id}")

    # Check cache (skip if refresh requested)
    if not request.skip_cache and prompt_text in prompt_cache:
        logger.info(f"Cache hit - returning cached result")
        latency = (time.time() - start_time) * 1000
        return OptimizeResponse(
            optimized=prompt_cache[prompt_text],
            original=request.prompt.strip(),  # Return original without unique ID
            model=OPTIMIZER_MODEL,
            latency_ms=latency
        )

    try:
        # Clean regenerate tag before processing
        clean_prompt = prompt_text
        if request.skip_cache and "[REGENERATE_" in clean_prompt:
            import re
            clean_prompt = re.sub(r'\n*\[REGENERATE_\d+\]', '', clean_prompt).strip()

        # Build context
        cc = ChatContext(session_id=str(uuid.uuid4()))
        if request.messages:
            for msg in request.messages:
                # msg is a Pydantic Message object with role/content
                cc.add(msg.role, msg.content)

        mode = getattr(request, 'mode', 'fast')
        custom_instructions = getattr(request, 'custom_instructions', '')
        
        models_info = {}
        # Call pipeline
        optimized_raw = pipeline_optimize(
            user_input=clean_prompt,
            cc=cc,
            model=OPTIMIZER_MODEL,
            provider="auto",
            stream=False,
            mode=mode,
            custom_instructions=custom_instructions,
            models_info=models_info,
        )
        
        optimized = clean_optimized_text(optimized_raw)

        logger.info(f"Original length: {len(clean_prompt)} chars")
        logger.info(f"Optimized length: {len(optimized)} chars")
        if len(clean_prompt) > 0:
            logger.info(f"Improvement ratio: {len(optimized)/len(clean_prompt):.2f}x")

        # Cache the result (TTLCache handles eviction automatically)
        prompt_cache[request.prompt.strip()] = optimized

        latency = (time.time() - start_time) * 1000

        return OptimizeResponse(
            optimized=optimized,
            original=request.prompt.strip(),
            model=OPTIMIZER_MODEL,
            latency_ms=latency
        )

    except Exception as e:
        sentry_sdk.capture_exception(e)
        error_msg = str(e)
        if "model" in error_msg.lower() or "not found" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail="Model not found. Please ensure Ollama is running and the model is installed (e.g., 'ollama pull llama3.2')"
            )
        logger.error(f"Optimization failed: {error_msg}")
        raise HTTPException(status_code=500, detail="Optimization failed — please try again")

@app.websocket("/ws/optimize-stream")
async def optimize_stream(websocket: WebSocket):
    """
    WebSocket endpoint for streaming prompt optimization using pipeline_v2.
    Auth token must be passed as ?token=<access_token> query param.
    """
    auth = await require_ws_auth(websocket)
    await websocket.accept()
    verified_user_id = auth.get("sub")
    logger.info(f"WebSocket connection accepted user={verified_user_id}")
    
    try:
        while True:
            data = await websocket.receive_json()
            
            request_id = data.get("request_id", str(int(time.time() * 1000)))
            prompt_text = data.get("prompt", "").strip()
            previous_output = data.get("previous_output", None)  # for regeneration self-critique
            messages = data.get("messages", None)
            mode = data.get("mode", "fast")
            custom_instructions = data.get("custom_instructions", "")
            attached_files = data.get("attached_files", [])
            forced_skill = data.get("forced_skill", None)
            sentry_trace = data.get("sentry_trace")
            baggage = data.get("baggage", "")
            # Use JWT-verified user id; fall back to request body only for legacy local mode
            user_id = verified_user_id or data.get("user_id")

            if user_id:
                sentry_sdk.set_user({"id": user_id})

            # Server-side rate limit check (enforced even for direct WebSocket connections)
            if user_id:
                allowed = await _check_rate_limit(user_id)
                if not allowed:
                    await websocket.send_json({
                        "type": "error",
                        "request_id": request_id,
                        "message": f"Daily limit of {DAILY_REQUEST_LIMIT} optimizations reached. Resets at midnight UTC.",
                    })
                    continue

            is_regeneration = bool(previous_output and previous_output.strip())
            logger.info(f"Processing request {request_id} (Mode: {mode}, Files: {len(attached_files)}, Skill: {forced_skill or 'auto'}, Regen: {is_regeneration})")

            # Continue distributed trace from Electron so Python spans are linked.
            if sentry_trace:
                incoming = {"sentry-trace": sentry_trace}
                if baggage:
                    incoming["baggage"] = baggage
                transaction = sentry_sdk.continue_trace(
                    incoming,
                    op="ai.optimization",
                    name=f"ws.optimize/{mode}",
                )
                sentry_sdk.get_current_scope().set_transaction_name(f"ws.optimize/{mode}")
            else:
                transaction = sentry_sdk.start_transaction(
                    op="ai.optimization",
                    name=f"ws.optimize/{mode}",
                )

            sentry_sdk.add_breadcrumb(
                category="optimize",
                message="optimize_stream request received",
                level="info",
                data={
                    "request_id": request_id,
                    "mode": mode,
                    "skill": forced_skill or "auto",
                    "is_regeneration": is_regeneration,
                    "file_count": len(attached_files),
                },
            )
            
            # Validate file count
            if len(attached_files) > 5:
                await websocket.send_json({
                    "type": "error",
                    "request_id": request_id,
                    "message": "Maximum 5 files allowed per message"
                })
                continue
            
            if not prompt_text or len(prompt_text) < 3:
                await websocket.send_json({
                    "type": "error",
                    "request_id": request_id,
                    "message": "Prompt too short (minimum 3 characters)"
                })
                continue

            cc = ChatContext(session_id=request_id)
            if messages and isinstance(messages, list):
                for msg in messages:
                    role_str = msg.get('role', 'user') if isinstance(msg, dict) else getattr(msg, 'role', 'user')
                    content_str = msg.get('content', '') if isinstance(msg, dict) else getattr(msg, 'content', '')
                    cc.add(role_str, content_str)
            
            async with _optimize_semaphore:
             with transaction:
              try:
                models_info = {}
                loop = asyncio.get_event_loop()
                chunk_queue: asyncio.Queue = asyncio.Queue()

                def run_stream():
                    """Run the blocking LLM generator in a thread, pushing chunks to the async queue."""
                    try:
                        gen = pipeline_optimize(
                            user_input=prompt_text,
                            cc=cc,
                            model=OPTIMIZER_MODEL,
                            provider="auto",
                            stream=True,
                            mode=mode,
                            custom_instructions=custom_instructions,
                            attached_files=attached_files,
                            forced_skill=forced_skill,
                            previous_output=previous_output,
                            models_info=models_info,
                        )
                        for chunk in gen:
                            loop.call_soon_threadsafe(chunk_queue.put_nowait, chunk)
                    finally:
                        loop.call_soon_threadsafe(chunk_queue.put_nowait, None)  # sentinel

                # Start blocking generator in thread — event loop stays free for other requests
                thread_future = loop.run_in_executor(None, run_stream)

                accumulated_text = ""
                chunk_count = 0

                while True:
                    chunk = await chunk_queue.get()
                    if chunk is None:
                        break
                    accumulated_text += chunk
                    chunk_count += 1
                    await websocket.send_json({
                        "type": "chunk",
                        "request_id": request_id,
                        "content": chunk,
                        "accumulated": accumulated_text
                    })

                await thread_future  # Propagate any thread exceptions

                cleaned_text = clean_optimized_text(accumulated_text)
                
                await websocket.send_json({
                    "type": "complete",
                    "request_id": request_id,
                    "optimized": cleaned_text,
                    "original": prompt_text,
                    "models_used": models_info,
                })
                
                sentry_sdk.add_breadcrumb(
                    category="optimize",
                    message="optimize_stream complete",
                    level="info",
                    data={"request_id": request_id, "chunk_count": chunk_count, "mode": mode},
                )
                logger.info(f"Request {request_id} complete. Chunks: {chunk_count}")
                
              except Exception as e:
                logger.error(f"OptimizeStream.request_error request_id={request_id} error={e}")
                sentry_sdk.capture_exception(e)
                logger.error(f"✗ Error processing request {request_id}: {e}")
                import traceback
                traceback.print_exc()
                await websocket.send_json({
                    "type": "error",
                    "request_id": request_id,
                    "message": "Optimization failed. Please try again."
                })
                
    except WebSocketDisconnect:
        logger.info("OptimizeStream.client_disconnected")
        logger.info("Client disconnected")
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"OptimizeStream.fatal_error error={e}")
        logger.error(f"✗ Fatal connection error: {e}")
    finally:
        pass # Connection closed

@app.get("/health")
async def health():
    """Lightweight liveness probe."""
    return {"status": "ok", "service": "prompt-optimizer"}


@app.get("/health/ready")
async def health_ready():
    """Readiness probe — checks that critical dependencies are available."""
    checks: dict = {}
    checks["llm_api_key"] = bool(OPENROUTER_API_KEY)
    checks["optimizer_model"] = bool(OPTIMIZER_MODEL)
    try:
        get_faster_whisper_model()
        checks["whisper_model"] = True
    except Exception:
        checks["whisper_model"] = False
    all_ok = all(checks.values())
    return {"status": "ready" if all_ok else "degraded", "checks": checks}


class TitleRequest(BaseModel):
    prompt: str = Field(..., max_length=50_000)


@app.post("/generate-title")
async def generate_title(request: TitleRequest, auth: dict = Depends(require_auth)):
    """
    Generate a short smart chat title (3-5 words) from the first user message.
    Uses TITLE_MODEL (defaults to SUMMARIZER_MODEL — cheap & fast).
    Falls back to "New Chat" if the LLM call fails or prompt is empty.
    """
    prompt_text = request.prompt.strip()
    if not prompt_text:
        return {"title": "New Chat"}

    try:
        import litellm as _litellm
        model = TITLE_MODEL

        kwargs: dict = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Generate a short title (3-5 words) for a chat based ONLY on the user's request. "
                        "Never use assistant-style phrases like 'I can help', 'I will', 'Sure', or 'Let me'. "
                        "Focus on what the user wants, not how you will respond. "
                        "Do not use punctuation or quotes. Return only the title, nothing else."
                    ),
                },
                {"role": "user", "content": prompt_text},
            ],
            "max_tokens": 20,
            "temperature": 0.3,
        }
        if OPENROUTER_API_KEY and ("openrouter" in model.lower()):
            kwargs["api_key"] = OPENROUTER_API_KEY

        response = _litellm.completion(**kwargs)
        raw_title = response.choices[0].message.content.strip()

        import re as _re
        raw_title = _re.sub(r'^[#"\'\s]+|[#"\'\s]+$', '', raw_title)
        # Hard cap at 5 words
        words = raw_title.split()[:5]
        title = " ".join(words) if words else "New Chat"

        logger.info(f"'{prompt_text[:50]}' -> '{title}'")
        return {"title": title}

    except Exception as exc:
        logger.error(f"TitleGen.llm_failed error={exc.__class__.__name__}: {exc}")
        logger.error(f"LLM failed ({exc.__class__.__name__}: {exc}), using fallback")
        return {"title": "New Chat"}


# ============================================================
# MEMORY FACT EXTRACTION
# ============================================================

class MemoryFact(BaseModel):
    category: str    # 'user' | 'behavioral' | 'context'
    key: str         # short label, e.g. "role", "preferred_tone"
    value: str       # the fact, e.g. "Senior Backend Engineer"
    confidence: float  # 0.0 – 1.0


class ExtractMemoryRequest(BaseModel):
    raw_prompt: str = Field(..., max_length=50_000)
    optimized_text: str = Field(..., max_length=50_000)
    skill: Optional[str] = Field(None, max_length=200)


class ExtractMemoryResponse(BaseModel):
    facts: List[MemoryFact]


MEMORY_EXTRACTION_SYSTEM_PROMPT = """You are a silent profiling engine. Given a user's raw prompt and the optimized version, extract factual observations about the user.

Return a JSON array of facts. Each fact must have:
- "category": one of "user" (identity, role, domain), "behavioral" (writing style, preferences), or "context" (recurring topics/tools)
- "key": a short snake_case label (e.g. "role", "primary_language", "preferred_tone", "domain")
- "value": a concise factual statement
- "confidence": 0.0 to 1.0 (how certain you are)

Rules:
- Only extract facts you are reasonably confident about (>= 0.5)
- Do NOT invent facts — only observe what is clearly present in the prompt
- Do NOT extract generic observations (e.g. "uses AI" is useless)
- Prefer specific, actionable facts (e.g. "works with React and TypeScript" over "is a developer")
- Return an empty array [] if nothing meaningful can be inferred
- Return ONLY the JSON array, no markdown, no explanation

Example output:
[
  {"category": "user", "key": "role", "value": "Full-stack developer", "confidence": 0.8},
  {"category": "context", "key": "primary_framework", "value": "React with TypeScript", "confidence": 0.9},
  {"category": "behavioral", "key": "preferred_tone", "value": "Technical and concise", "confidence": 0.6}
]"""


@app.post("/extract-memory-facts", response_model=ExtractMemoryResponse)
async def extract_memory_facts(request: ExtractMemoryRequest, auth: dict = Depends(require_auth)):
    """
    Extract user facts from a raw prompt + optimized output.
    Uses a cheap/fast model (same as optimizer) for minimal cost.
    Called fire-and-forget from Electron after each optimization.
    """
    raw = request.raw_prompt.strip()
    optimized = request.optimized_text.strip()

    if not raw or len(raw) < 10:
        return ExtractMemoryResponse(facts=[])

    try:
        import litellm as _litellm

        model = MEMORY_MODEL

        user_content = f"Raw prompt:\n{raw}\n\nOptimized version:\n{optimized}"
        if request.skill:
            user_content += f"\n\nDetected skill: {request.skill}"

        kwargs: dict = {
            "model": model,
            "messages": [
                {"role": "system", "content": MEMORY_EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "max_tokens": 300,
            "temperature": 0.1,
        }
        if OPENROUTER_API_KEY and "openrouter" in model.lower():
            kwargs["api_key"] = OPENROUTER_API_KEY

        t0 = time.time()
        response = _litellm.completion(**kwargs)
        latency_ms = int((time.time() - t0) * 1000)

        raw_text = response.choices[0].message.content.strip()

        # Log usage
        if response.usage:
            from pipeline_v2.usage_logger import log_usage as _log_usage
            _log_usage(
                call_type="memory_extraction",
                model=model,
                prompt_tokens=response.usage.prompt_tokens,
                completion_tokens=response.usage.completion_tokens,
                total_tokens=response.usage.total_tokens,
                latency_ms=latency_ms,
            )

        # Parse JSON response
        # Strip markdown code fences if present
        cleaned = raw_text
        if cleaned.startswith("```"):
            cleaned = re.sub(r'^```\w*\n?', '', cleaned)
            cleaned = re.sub(r'\n?```$', '', cleaned)
        cleaned = cleaned.strip()

        parsed = json.loads(cleaned)
        if not isinstance(parsed, list):
            logger.info(f"Expected array, got {type(parsed)}")
            return ExtractMemoryResponse(facts=[])

        valid_categories = {"user", "behavioral", "context"}
        facts = []
        for item in parsed:
            cat = item.get("category", "")
            if cat not in valid_categories:
                continue
            key = item.get("key", "").strip()
            value = item.get("value", "").strip()
            conf = float(item.get("confidence", 0.5))
            if key and value and 0.0 <= conf <= 1.0:
                facts.append(MemoryFact(
                    category=cat,
                    key=key,
                    value=value,
                    confidence=min(conf, 0.95),  # cap inferred confidence below explicit (1.0)
                ))

        logger.info(f"Extracted {len(facts)} facts in {latency_ms}ms")
        return ExtractMemoryResponse(facts=facts)

    except json.JSONDecodeError as je:
        logger.warning(f"MemoryExtract.json_parse_error error={je}")
        logger.error(f"JSON parse error: {je}")
        return ExtractMemoryResponse(facts=[])
    except Exception as exc:
        logger.error(f"MemoryExtract.error error={exc.__class__.__name__}: {exc}")
        logger.error(f"Error: {exc.__class__.__name__}: {exc}")
        return ExtractMemoryResponse(facts=[])


# ============================================================
# WHISPER TRANSCRIPTION PIPELINE  v3
# ============================================================
# Capture  → resample to 16 kHz  → VAD endpoint detection
#         → quality checks  → faster-whisper inference
#         → sliding window overlap  → context carryover
# ============================================================

WHISPER_RATE   = 16_000   # faster-whisper always expects 16 kHz mono float32

# Speech window accumulation
MIN_SPEECH_S   = 10.0     # seconds before a live partial trigger — most spoken
                          # prompts are under 10 s, so they get processed as a
                          # single chunk at the endpoint for maximum accuracy
MAX_SPEECH_S   = 30.0     # hard cap to prevent memory growth

# Sliding window overlap — ensures phonetic continuity across chunk boundaries
OVERLAP_SECONDS = 1.0

# Quality gates (applied AFTER resampling to 16 kHz)
MIN_INFER_DURATION_S = 0.5   # allow short voice commands (was 1.5)
MIN_INFER_RMS        = 0.0008 # float32 RMS floor — catches dead signal only

# Silero VAD — used for ENDPOINT DETECTION, not as an inference gate
VAD_WINDOW_MS      = 64     # ms — 64 ms is the most stable config for Silero at 16 kHz
VAD_SPEECH_THRESH  = 0.5    # confidence threshold (0–1)
VAD_MIN_SPEECH_MS  = 250    # ignore speech bursts shorter than this

# Debug WAV output
DEBUG_WAV_COUNT  = 3 if _is_dev else 0
_debug_wav_saved = 0


_fw_model  = None   # faster-whisper WhisperModel
_vad_model = None   # Silero VAD model
_vad_utils = None   # Silero VAD utility functions


def get_faster_whisper_model() -> WhisperModel:
    """
    Lazy-load faster-whisper 'small' model with int8 quantisation.
    small (244 M) gives much better accuracy than base (74 M) and
    the pipeline architecture keeps latency acceptable on CPU.
    """
    global _fw_model
    if _fw_model is None:
        logger.info("Loading faster-whisper 'small' (int8) …")
        _fw_model = WhisperModel("small", device="cpu", compute_type="int8")
        logger.info("faster-whisper model ready")
    return _fw_model


def get_vad_model():
    """
    Lazy-load Silero VAD model from torch.hub.
    Returns (model, get_speech_timestamps_fn).
    """
    global _vad_model, _vad_utils
    if _vad_model is None:
        logger.info("Loading Silero VAD model …")
        import torch
        _vad_model, _vad_utils = torch.hub.load(
            repo_or_dir = "snakers4/silero-vad",
            model       = "silero_vad",
            force_reload = False,
            onnx        = False,
        )
        _vad_model.eval()
        logger.info("Silero VAD ready")
    return _vad_model, _vad_utils


def _vad_has_speech(audio_f32: np.ndarray) -> bool:
    """
    Run Silero VAD on 16 kHz float32 audio.
    Returns True if at least one speech segment >= VAD_MIN_SPEECH_MS is found.

    Silero VAD operates on fixed windows of 32/64/96 ms at 16 kHz.
    Window size in samples = VAD_WINDOW_MS * WHISPER_RATE / 1000.
    """
    import torch
    try:
        vad_model, utils = get_vad_model()
        get_speech_timestamps = utils[0]  # first util function

        logger.info(f"audio length: {len(audio_f32) / WHISPER_RATE:.2f} seconds")

        # Silero requires a 1-D, float32, contiguous tensor at 16 kHz
        audio_tensor = torch.from_numpy(audio_f32).float().squeeze().contiguous()

        speech_ts = get_speech_timestamps(
            audio_tensor,
            vad_model,
            sampling_rate      = WHISPER_RATE,
            threshold          = VAD_SPEECH_THRESH,
            min_speech_duration_ms = VAD_MIN_SPEECH_MS,
            min_silence_duration_ms = 100,
            window_size_samples = VAD_WINDOW_MS * WHISPER_RATE // 1000,
        )

        has_speech = len(speech_ts) > 0
        total_speech_s = sum(
            (ts["end"] - ts["start"]) / WHISPER_RATE for ts in speech_ts
        )
        logger.info(f"segments={len(speech_ts)}  "
              f"total_speech={total_speech_s:.2f}s  "
              f"has_speech={has_speech}")
        return has_speech

    except Exception as e:
        logger.error(f"Error — falling back to pass-through: {e}")
        # If VAD fails for any reason, let the segment through so
        # we don't silently drop valid audio.
        return True


def _resample(audio_int16: np.ndarray, src_rate: int) -> np.ndarray:
    """
    Resample int16 audio from src_rate → WHISPER_RATE using
    scipy.signal.resample_poly (polyphase, no aliasing).
    Returns float32 in [-1, 1].
    """
    if src_rate == WHISPER_RATE:
        return audio_int16.astype(np.float32) / 32768.0

    g   = gcd(src_rate, WHISPER_RATE)
    up  = WHISPER_RATE // g
    dn  = src_rate      // g

    logger.info(f"{src_rate} Hz -> {WHISPER_RATE} Hz  (up={up}, dn={dn})")
    audio_f32 = audio_int16.astype(np.float32) / 32768.0
    resampled  = resample_poly(audio_f32, up, dn).astype(np.float32)
    return resampled


def _save_debug_wav(audio_int16: np.ndarray, capture_rate: int, tag: str = ""):
    """Save a WAV file for manual inspection. Writes at most DEBUG_WAV_COUNT files."""
    global _debug_wav_saved
    if _debug_wav_saved >= DEBUG_WAV_COUNT:
        return
    _debug_wav_saved += 1
    fname = f"debug_chunk_{_debug_wav_saved}{tag}.wav"
    try:
        with wave.open(fname, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)          # int16 = 2 bytes
            wf.setframerate(capture_rate)
            wf.writeframes(audio_int16.tobytes())
        logger.info(f"Saved {fname} ({len(audio_int16)/capture_rate:.2f}s @ {capture_rate} Hz)")
    except Exception as e:
        logger.error(f"Failed to save WAV: {e}")


class AudioTranscriptionRequest(BaseModel):
    audio_base64: str = Field(..., min_length=10, max_length=20_000_000)


def _transcribe_uploaded_wav(audio_bytes: bytes) -> str:
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            sample_rate = wf.getframerate()
            channel_count = wf.getnchannels()
            sample_width = wf.getsampwidth()
            frame_count = wf.getnframes()
            raw_frames = wf.readframes(frame_count)
    except wave.Error as exc:
        raise HTTPException(status_code=400, detail=f"Invalid WAV audio: {exc}")

    if sample_width != 2:
        raise HTTPException(status_code=400, detail="Only 16-bit PCM WAV audio is supported")

    audio_int16 = np.frombuffer(raw_frames, dtype=np.int16)
    if audio_int16.size == 0:
        raise HTTPException(status_code=400, detail="Uploaded audio is empty")

    if channel_count > 1:
        audio_int16 = audio_int16.reshape(-1, channel_count).mean(axis=1).astype(np.int16)

    audio_f32 = _resample(audio_int16, sample_rate)
    duration_s = len(audio_f32) / WHISPER_RATE
    rms = float(np.sqrt(np.mean(audio_f32 ** 2)))

    logger.info(f"Uploaded audio duration={duration_s:.2f}s rms={rms:.5f}")

    if duration_s < 0.3:
        raise HTTPException(status_code=400, detail="Audio is too short to transcribe")
    if rms < MIN_INFER_RMS:
        raise HTTPException(status_code=400, detail="Audio signal is too quiet")
    if not _vad_has_speech(audio_f32):
        raise HTTPException(status_code=400, detail="No speech detected in audio")

    model = get_faster_whisper_model()

    try:
        segments_gen, _info = model.transcribe(
            audio_f32,
            language="en",
            task="transcribe",
            beam_size=5,
            temperature=0.0,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            vad_filter=False,
            without_timestamps=True,
        )
        segments = list(segments_gen)
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        logger.error(f"Uploaded transcription failed: {exc}")
        raise HTTPException(status_code=500, detail="Transcription failed")

    text = " ".join(seg.text.strip() for seg in segments if seg.text.strip()).strip()
    return text


@app.post("/transcribe-audio")
async def transcribe_audio(request: AudioTranscriptionRequest, auth: dict = Depends(require_auth)):
    user_id = auth.get("sub")
    if user_id:
        sentry_sdk.set_user({"id": user_id})

    try:
        audio_bytes = base64.b64decode(request.audio_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 audio payload")

    text = _transcribe_uploaded_wav(audio_bytes)
    return {"text": text}


# ============================================================
# DEEPGRAM STREAMING TRANSCRIPTION PROXY
# ============================================================
# Client sends audio from the browser mic over a FastAPI WebSocket.
# This endpoint opens a second WebSocket to Deepgram's Nova-2 STT
# and relays audio/results between the two connections.
# ============================================================

_active_stream_sessions: set[str] = set()


async def _deepgram_relay(dg_ws, client_ws, session_id: str, finalized_parts: list[str]):
    """Background task: read Deepgram JSON results and forward to the client."""
    try:
        async for raw_msg in dg_ws:
            try:
                msg = json.loads(raw_msg)
            except (json.JSONDecodeError, TypeError):
                continue

            msg_type = msg.get("type", "")

            if msg_type == "Results":
                alt = (msg.get("channel", {})
                           .get("alternatives", [{}])[0])
                transcript = alt.get("transcript", "").strip()
                is_final = msg.get("is_final", False)
                speech_final = msg.get("speech_final", False)

                if is_final and transcript:
                    finalized_parts.append(transcript)

                finalized_text = " ".join(finalized_parts)
                if is_final:
                    accumulated = finalized_text
                else:
                    accumulated = (finalized_text + " " + transcript).strip() if transcript else finalized_text

                if transcript or is_final:
                    await client_ws.send_json({
                        "type": "transcription",
                        "text": transcript,
                        "accumulated": accumulated,
                        "is_final": is_final,
                        "speech_final": speech_final,
                    })

            elif msg_type == "Metadata":
                logger.info(f"[Deepgram] Metadata session={session_id}: request_id={msg.get('request_id')}")

    except websockets.exceptions.ConnectionClosedOK:
        logger.info(f"[Deepgram] Connection closed normally session={session_id}")
    except websockets.exceptions.ConnectionClosedError as e:
        logger.warning(f"[Deepgram] Connection closed with error session={session_id}: {e}")
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"[Deepgram] Relay error session={session_id}: {e}")


@app.websocket("/ws/transcribe-stream")
async def websocket_transcribe_stream(websocket: WebSocket):
    """Deepgram streaming proxy — client sends PCM audio, receives live transcription."""
    auth = await require_ws_auth(websocket)
    await websocket.accept()
    user_id = auth.get("sub")
    logger.info(f"WebSocket.transcribe_stream connected user={user_id}")

    session_id: str | None = None
    dg_ws = None
    relay_task: asyncio.Task | None = None
    finalized_parts: list[str] = []

    try:
        start_data = await websocket.receive_json()
        if start_data.get("action") != "start":
            await websocket.send_json({"type": "error", "message": "Expected {action: 'start'} as first message"})
            await websocket.close(code=1008)
            return

        sample_rate = int(start_data.get("sample_rate", 16000))
        session_id = start_data.get("session_id", f"stream_{int(time.time())}")
        logger.info(f"[Deepgram] Starting session={session_id} sample_rate={sample_rate}")

        api_key = DEEPGRAM_API_KEY
        if not api_key:
            logger.error("[Deepgram] DEEPGRAM_API_KEY is not set")
            await websocket.send_json({"type": "error", "message": "Deepgram API key not configured"})
            await websocket.close(code=1011)
            return

        dg_url = (
            "wss://api.deepgram.com/v1/listen?"
            "model=nova-2&language=en&smart_format=true"
            "&interim_results=true&utterance_end_ms=1000"
            "&vad_events=true&endpointing=300"
        )
        dg_headers = {"Authorization": f"Token {api_key}"}

        try:
            dg_ws = await websockets.connect(dg_url, additional_headers=dg_headers)
        except Exception as e:
            sentry_sdk.capture_exception(e)
            logger.error(f"[Deepgram] Failed to connect: {e}")
            await websocket.send_json({"type": "error", "message": f"Deepgram connection failed: {e}"})
            await websocket.close(code=1011)
            return

        _active_stream_sessions.add(session_id)
        relay_task = asyncio.create_task(
            _deepgram_relay(dg_ws, websocket, session_id, finalized_parts)
        )

        await websocket.send_json({
            "type": "status", "status": "listening", "session_id": session_id,
        })
        logger.info(f"[Deepgram] Session active session={session_id}")

        # ── Main receive loop: binary audio or text control messages ──
        while True:
            msg = await websocket.receive()

            if "bytes" in msg and msg["bytes"]:
                try:
                    await dg_ws.send(msg["bytes"])
                except websockets.exceptions.ConnectionClosed:
                    logger.warning(f"[Deepgram] WS closed while sending audio session={session_id}")
                    break

            elif "text" in msg and msg["text"]:
                try:
                    data = json.loads(msg["text"])
                except (json.JSONDecodeError, TypeError):
                    continue

                if data.get("action") == "stop":
                    logger.info(f"[Deepgram] Client requested stop session={session_id}")
                    try:
                        await dg_ws.send(json.dumps({"type": "CloseStream"}))
                    except websockets.exceptions.ConnectionClosed:
                        pass
                    break

    except WebSocketDisconnect:
        logger.info(f"WebSocket.transcribe_stream disconnected session={session_id}")
    except Exception as e:
        sentry_sdk.capture_exception(e)
        logger.error(f"WebSocket.transcribe_stream error session={session_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if relay_task and not relay_task.done():
            try:
                await asyncio.wait_for(relay_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning(f"[Deepgram] Relay task timed out session={session_id}")
                relay_task.cancel()
            except Exception:
                relay_task.cancel()

        if dg_ws:
            try:
                await dg_ws.close()
            except Exception:
                pass

        accumulated = " ".join(finalized_parts)
        try:
            await websocket.send_json({
                "type": "final",
                "text": accumulated,
                "accumulated": accumulated,
            })
            await websocket.send_json({"type": "status", "status": "stopped"})
        except Exception:
            pass

        if session_id:
            _active_stream_sessions.discard(session_id)

        logger.info(f"[Deepgram] Session ended session={session_id} "
                    f"accumulated_length={len(accumulated)}")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up on SIGTERM/SIGINT."""
    logger.info("[Shutdown] Cleaning up active transcription sessions...")
    _active_stream_sessions.clear()
    logger.info("[Shutdown] Cleanup complete — server stopping.")


@app.get("/")
async def root():
    return {
        "service": "Prompt Optimizer API",
        "version": "1.0.0",
        "endpoints": {
            "optimize": "POST /optimize",
            "health": "GET /health",
            "transcribe_audio": "POST /transcribe-audio",
            "transcribe_stream": "WS /ws/transcribe-stream",
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

