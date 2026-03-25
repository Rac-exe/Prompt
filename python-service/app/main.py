from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import sys

# Force UTF-8 stdout/stderr so emoji and non-ASCII chars don't crash the server
# on Windows where the default console encoding is cp1252.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import json
import time
import re
import whisper
import numpy as np
import pyaudio
import io
import wave
import math
from scipy.signal import resample_poly
from math import gcd
from faster_whisper import WhisperModel
import threading
import queue
import asyncio
import os
import torch

app = FastAPI()

# Preload heavy modules to eliminate cold start latency
print("[Startup] Loading pipeline_v2 modules...")
from pipeline_v2.context import ChatContext
from pipeline_v2.optimizer import optimize as pipeline_optimize
import uuid
print("[Startup] pipeline_v2 loaded")

@app.on_event("startup")
async def startup_event():
    # Warm up litellm / OpenRouter TLS connections in the background
    try:
        print("[Startup] Warming up OpenRouter connection...")
        import litellm
        import os
        model = os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini")
        
        # We do a direct ping to litellm instead of pipeline_optimize
        # so this doesn't pollute the local usage logs or chat history
        # We set max_tokens=1 so it uses effectively 0 compute/cost
        api_key = os.environ.get("OPENROUTER_API_KEY")
        
        # Prepare kwargs
        kwargs = {"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1}
        if api_key and ("openrouter" in model.lower() or provider_check(model)):
            kwargs["api_key"] = api_key
            
        litellm.completion(**kwargs)
        print("[Startup] OpenRouter connection warmed up")
    except Exception as e:
        print(f"[Startup] WARNING: Warmup failed (this is harmless if no internet): {e}")

def provider_check(model: str) -> bool:
    return "openrouter" in model.lower()

# ============================================
# SKILL MANAGER - DISABLED (using simple system prompt instead)
# ============================================
# Skill system has been disabled to use a single, clear system prompt
# which prevents the LLM from generating content instead of optimizing prompts


# CORS middleware to allow Electron to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    content: str

class OptimizeRequest(BaseModel):
    prompt: str
    skip_cache: Optional[bool] = False  # Set to True to bypass cache (for refresh)
    messages: Optional[list[Message]] = None  # Chat history for context-aware optimization
    mode: Optional[str] = "fast"  # new dual-mode toggle ("fast" or "thinking")
    custom_instructions: Optional[str] = ""  # User's custom prompt instructions

class OptimizeResponse(BaseModel):
    optimized: str
    original: str
    model: str = ""
    latency_ms: Optional[float] = None

# Simple in-memory cache (LRU would be better for production)
prompt_cache: dict[str, str] = {}
MAX_CACHE_SIZE = 100

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
async def optimize_prompt(request: OptimizeRequest):
    start_time = time.time()

    if not request.prompt or len(request.prompt.strip()) < 3:
        raise HTTPException(status_code=400, detail="Prompt too short (minimum 3 characters)")

    prompt_text = request.prompt.strip()

    # For regenerate requests, add a unique identifier to force different results
    if request.skip_cache:
        unique_id = str(int(time.time() * 1000000))  # Microsecond precision
        prompt_text = f"{prompt_text}\n\n[REGENERATE_{unique_id}]"
        print(f"[Optimize] Regenerate request - added unique ID: {unique_id}")

    # Check cache (skip if refresh requested)
    if not request.skip_cache and prompt_text in prompt_cache:
        print(f"[Optimize] Cache hit - returning cached result")
        latency = (time.time() - start_time) * 1000
        return OptimizeResponse(
            optimized=prompt_cache[prompt_text],
            original=request.prompt.strip(),  # Return original without unique ID
            model=os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini"),
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
        
        # Call pipeline
        optimized_raw = pipeline_optimize(
            user_input=clean_prompt,
            cc=cc,
            model=os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini"),
            provider="auto",
            stream=False,
            mode=mode,
            custom_instructions=custom_instructions
        )
        
        optimized = clean_optimized_text(optimized_raw)

        print(f"[Optimize] Original length: {len(clean_prompt)} chars")
        print(f"[Optimize] Optimized length: {len(optimized)} chars")
        if len(clean_prompt) > 0:
            print(f"[Optimize] Improvement ratio: {len(optimized)/len(clean_prompt):.2f}x")

        # Cache the result
        cache_key = request.prompt.strip()
        if len(prompt_cache) >= MAX_CACHE_SIZE:
            prompt_cache.pop(next(iter(prompt_cache)))
        prompt_cache[cache_key] = optimized

        latency = (time.time() - start_time) * 1000

        return OptimizeResponse(
            optimized=optimized,
            original=request.prompt.strip(),
            model=os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini"),
            latency_ms=latency
        )

    except Exception as e:
        error_msg = str(e)
        if "model" in error_msg.lower() or "not found" in error_msg.lower():
            raise HTTPException(
                status_code=500,
                detail="Model not found. Please ensure Ollama is running and the model is installed (e.g., 'ollama pull llama3.2')"
            )
        raise HTTPException(status_code=500, detail=f"Optimization failed: {error_msg}")

@app.websocket("/ws/optimize-stream")
async def optimize_stream(websocket: WebSocket):
    """
    WebSocket endpoint for streaming prompt optimization using pipeline_v2.
    """
    await websocket.accept()
    print("[OptimizeStream] WebSocket connection accepted")
    
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

            is_regeneration = bool(previous_output and previous_output.strip())
            print(f"[OptimizeStream] Processing request {request_id} (Mode: {mode}, Files: {len(attached_files)}, Skill: {forced_skill or 'auto'}, Regen: {is_regeneration})")
            
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
            
            try:
                # Call pipeline configured for streaming, returning a generator
                stream_gen = pipeline_optimize(
                    user_input=prompt_text,
                    cc=cc,
                    model=os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini"),
                    provider="auto",
                    stream=True,
                    mode=mode,
                    custom_instructions=custom_instructions,
                    attached_files=attached_files,
                    forced_skill=forced_skill,
                    previous_output=previous_output,
                )
                
                accumulated_text = ""
                chunk_count = 0
                
                for chunk in stream_gen:
                    accumulated_text += chunk
                    chunk_count += 1
                    await websocket.send_json({
                        "type": "chunk",
                        "request_id": request_id,
                        "content": chunk,
                        "accumulated": accumulated_text
                    })
                
                cleaned_text = clean_optimized_text(accumulated_text)
                
                await websocket.send_json({
                    "type": "complete",
                    "request_id": request_id,
                    "optimized": cleaned_text,
                    "original": prompt_text
                })
                
                print(f"[OptimizeStream] Request {request_id} complete. Chunks: {chunk_count}")
                
            except Exception as e:
                print(f"[OptimizeStream] ✗ Error processing request {request_id}: {e}")
                import traceback
                traceback.print_exc()
                await websocket.send_json({
                    "type": "error",
                    "request_id": request_id,
                    "message": f"Optimization failed: {str(e)}"
                })
                
    except WebSocketDisconnect:
        print("[OptimizeStream] Client disconnected")
    except Exception as e:
        print(f"[OptimizeStream] ✗ Fatal connection error: {e}")
    finally:
        pass # Connection closed

@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "prompt-optimizer",
        "api_ready": True
    }


class TitleRequest(BaseModel):
    prompt: str


@app.post("/generate-title")
async def generate_title(request: TitleRequest):
    """
    Generate a short smart chat title (3-5 words) from the first user message.
    Uses the same model as the optimizer (gpt-4o-mini via OpenRouter).
    Falls back to "New Chat" if the LLM call fails or prompt is empty.
    """
    prompt_text = request.prompt.strip()
    if not prompt_text:
        return {"title": "New Chat"}

    try:
        import litellm as _litellm
        model = os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini")
        api_key = os.environ.get("OPENROUTER_API_KEY")

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
        if api_key and ("openrouter" in model.lower()):
            kwargs["api_key"] = api_key

        response = _litellm.completion(**kwargs)
        raw_title = response.choices[0].message.content.strip()

        # Sanitise: strip quotes, punctuation, leading hashes the model might add
        import re as _re
        raw_title = _re.sub(r'^[#"\'\s]+|[#"\'\s]+$', '', raw_title)
        # Hard cap at 5 words
        words = raw_title.split()[:5]
        title = " ".join(words) if words else "New Chat"

        print(f"[TitleGen] '{prompt_text[:50]}' -> '{title}'")
        return {"title": title}

    except Exception as exc:
        print(f"[TitleGen] LLM failed ({exc.__class__.__name__}: {exc}), using fallback")
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
    raw_prompt: str
    optimized_text: str
    skill: Optional[str] = None


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
async def extract_memory_facts(request: ExtractMemoryRequest):
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

        model = os.environ.get("OPTIMIZER_MODEL", "openrouter/openai/gpt-4o-mini")
        api_key = os.environ.get("OPENROUTER_API_KEY")

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
        if api_key and "openrouter" in model.lower():
            kwargs["api_key"] = api_key

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
            print(f"[MemoryExtract] Expected array, got {type(parsed)}")
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

        print(f"[MemoryExtract] Extracted {len(facts)} facts in {latency_ms}ms")
        return ExtractMemoryResponse(facts=facts)

    except json.JSONDecodeError as je:
        print(f"[MemoryExtract] JSON parse error: {je}")
        return ExtractMemoryResponse(facts=[])
    except Exception as exc:
        print(f"[MemoryExtract] Error: {exc.__class__.__name__}: {exc}")
        return ExtractMemoryResponse(facts=[])


# ============================================================
# WHISPER TRANSCRIPTION PIPELINE  v3
# ============================================================
# Capture  → resample to 16 kHz  → VAD endpoint detection
#         → quality checks  → faster-whisper inference
#         → sliding window overlap  → context carryover
# ============================================================

WHISPER_RATE   = 16_000   # faster-whisper always expects 16 kHz mono float32
CAPTURE_CHUNK  = 1024     # frames per PyAudio read
CAPTURE_CHANS  = 1        # mono

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
DEBUG_WAV_COUNT  = 3
_debug_wav_saved = 0

# Sentinel object placed on audio_queue by the capture thread after
# its last chunk.  The transcription loop uses this to know all audio
# has been enqueued.
STOP_SIGNAL = object()

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
        print("[FW] Loading faster-whisper 'small' (int8) …")
        _fw_model = WhisperModel("small", device="cpu", compute_type="int8")
        print("[FW] faster-whisper model ready")
    return _fw_model


def get_vad_model():
    """
    Lazy-load Silero VAD model from torch.hub.
    Returns (model, get_speech_timestamps_fn).
    """
    global _vad_model, _vad_utils
    if _vad_model is None:
        print("[VAD] Loading Silero VAD model …")
        import torch
        _vad_model, _vad_utils = torch.hub.load(
            repo_or_dir = "snakers4/silero-vad",
            model       = "silero_vad",
            force_reload = False,
            onnx        = False,
        )
        _vad_model.eval()
        print("[VAD] Silero VAD ready")
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

        print(f"[VAD] audio length: {len(audio_f32) / WHISPER_RATE:.2f} seconds")

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
        print(f"[VAD] segments={len(speech_ts)}  "
              f"total_speech={total_speech_s:.2f}s  "
              f"has_speech={has_speech}")
        return has_speech

    except Exception as e:
        print(f"[VAD] Error — falling back to pass-through: {e}")
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

    print(f"[Resample] {src_rate} Hz -> {WHISPER_RATE} Hz  (up={up}, dn={dn})")
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
        print(f"[Debug] Saved {fname} ({len(audio_int16)/capture_rate:.2f}s @ {capture_rate} Hz)")
    except Exception as e:
        print(f"[Debug] Failed to save WAV: {e}")


class TranscriptionSession:
    """Manages a single transcription session."""

    def __init__(self, websocket: WebSocket, event_loop):
        self.websocket       = websocket
        self.event_loop      = event_loop
        self.audio_queue     = queue.Queue()   # items: np.ndarray int16 chunks
        self.is_recording    = False
        self.capture_rate    = 0               # set after device is opened
        self.audio_thread    = None
        self.transcription_thread = None
        self.accumulated_text = ""

    # ── lifecycle ────────────────────────────────────────────────

    def start_recording(self):
        if self.is_recording:
            print("[Transcription] Already recording")
            return

        print("[Transcription] ===== STARTING RECORDING SESSION =====")
        self.is_recording     = True
        self.accumulated_text = ""
        self.capture_rate     = 0

        # Drain stale queue data
        while not self.audio_queue.empty():
            try: self.audio_queue.get_nowait()
            except: break
        print("[Transcription] Audio queue cleared")

        self.audio_thread = threading.Thread(
            target=self._capture_audio, daemon=True, name="audio-capture"
        )
        self.audio_thread.start()
        print("[Transcription] Audio capture thread started")

        self.transcription_thread = threading.Thread(
            target=self._transcribe_loop, daemon=True, name="transcribe-loop"
        )
        self.transcription_thread.start()
        print("[Transcription] Transcription thread started")
        print("[Transcription] ===== SESSION ACTIVE =====")

    def stop_recording(self):
        print("[Transcription] ===== STOPPING RECORDING SESSION =====")
        print("[Transcription] stop requested")
        # Set flag — the capture thread will see this, exit its loop,
        # and THEN place STOP_SIGNAL on the queue.  This guarantees every
        # captured chunk is enqueued before the sentinel.
        self.is_recording = False
        # Notify UI immediately so it can show "Processing…"
        if self.event_loop:
            asyncio.run_coroutine_threadsafe(
                self.websocket.send_json({"type": "status", "status": "processing"}),
                self.event_loop
            )

    # ── audio capture ────────────────────────────────────────────

    def _capture_audio(self):
        """
        Record from the default microphone at its NATIVE sample rate.

        Why native rate?  On Windows, WASAPI/MME drivers often ignore
        rate=16000 and open at 44100 or 48000 Hz anyway, but report
        success.  The bytes then arrive 2–3× faster than expected, so
        Whisper hears sped-up speech and hallucinates.  By capturing at
        the native rate and resampling in software we guarantee correct
        timing.
        """
        audio  = None
        stream = None
        try:
            print("[Capture] Initialising PyAudio …")
            audio = pyaudio.PyAudio()

            # ── Discover native device rate ─────────────────────
            try:
                dev_info = audio.get_default_input_device_info()
                native_rate = int(dev_info["defaultSampleRate"])
                dev_name    = dev_info["name"]
            except Exception as e:
                print(f"[Capture] Could not query default device: {e}. Falling back to 44100 Hz")
                native_rate = 44_100
                dev_name    = "unknown"

            print(f"[Capture] Device  : {dev_name}")
            print(f"[Capture] Native rate: {native_rate} Hz")
            print(f"[Capture] Channels: {CAPTURE_CHANS}  |  Chunk: {CAPTURE_CHUNK} frames")

            self.capture_rate = native_rate

            stream = audio.open(
                format=pyaudio.paInt16,
                channels=CAPTURE_CHANS,
                rate=native_rate,
                input=True,
                frames_per_buffer=CAPTURE_CHUNK,
            )
            print("[Capture] Stream opened — recording …")

            chunk_count       = 0
            debug_chunks_left = 5    # log first N chunks in detail

            stop_signal_sent = False

            while True:
                try:
                    raw = stream.read(CAPTURE_CHUNK, exception_on_overflow=False)
                except IOError as e:
                    print(f"[Capture] Stream read error: {e}")
                    break

                chunk_count += 1
                chunk_arr = np.frombuffer(raw, dtype=np.int16).copy()
                rms       = float(np.sqrt(np.mean(chunk_arr.astype(np.float32) ** 2)))

                if debug_chunks_left > 0:
                    dur_ms = len(chunk_arr) / native_rate * 1000
                    print(f"[Capture] chunk #{chunk_count}: "
                          f"{len(chunk_arr)} samples  {dur_ms:.1f} ms  "
                          f"RMS={rms:.1f}  min={chunk_arr.min()}  max={chunk_arr.max()}")
                    debug_chunks_left -= 1
                elif chunk_count % 50 == 0:
                    dur_s = chunk_count * CAPTURE_CHUNK / native_rate
                    print(f"[Capture] {chunk_count} chunks ({dur_s:.1f}s recorded)  RMS={rms:.1f}")

                # Always enqueue the chunk BEFORE checking the stop flag so
                # the very last chunk captured is never lost.
                self.audio_queue.put(chunk_arr)

                if not self.is_recording:
                    print("[Capture] stop flag received — exiting capture loop")
                    break

            print(f"[Capture] Stopped — {chunk_count} chunks captured "
                  f"({chunk_count * CAPTURE_CHUNK / native_rate:.1f}s)")

            # Place STOP_SIGNAL *after* the last chunk so the transcription
            # thread is guaranteed to see every audio frame before the sentinel.
            self.audio_queue.put(STOP_SIGNAL)
            stop_signal_sent = True
            print("[Capture] STOP_SIGNAL placed after last chunk")

        except Exception as e:
            print(f"[Capture] FATAL: {e}")
            import traceback; traceback.print_exc()
            if self.event_loop:
                asyncio.run_coroutine_threadsafe(
                    self.websocket.send_json({"type": "error",
                                             "message": f"Microphone error: {e}"}),
                    self.event_loop
                )
        finally:
            # Guarantee the sentinel is sent even on unexpected errors so the
            # transcription thread never blocks forever.
            if not stop_signal_sent:
                self.audio_queue.put(STOP_SIGNAL)
                print("[Capture] STOP_SIGNAL placed in finally (error path)")
            if stream:
                try: stream.stop_stream(); stream.close()
                except: pass
            if audio:
                try: audio.terminate()
                except: pass
            print("[Capture] PyAudio cleaned up")

    # ── transcription loop ───────────────────────────────────────

    def _transcribe_loop(self):
        """
        Drain audio_queue, accumulate audio, run VAD for endpoint
        detection, then call Whisper with sliding window overlap.
        Live partial results are sent while recording; a final
        result is sent when the session ends.
        """
        print("[TranscLoop] Starting …")
        model = get_faster_whisper_model()

        # ── Wait for capture thread to open the mic and set capture_rate ──
        wait_limit = 5.0
        waited     = 0.0
        while self.capture_rate == 0 and waited < wait_limit:
            time.sleep(0.05)
            waited += 0.05

        if self.capture_rate == 0:
            print("[TranscLoop] capture_rate never set after "
                  f"{wait_limit}s — microphone may not be available")
            self._flush_final_if_needed(is_final=True)
            return

        cap_rate       = self.capture_rate
        buffer         = []
        buffer_frames  = 0
        max_frames     = int(MAX_SPEECH_S * cap_rate)
        last_infer_t   = time.time()
        overlap_frames = int(OVERLAP_SECONDS * cap_rate)

        # ── VAD endpoint detection state ──────────────────────────
        speech_active  = False
        silence_frames = 0
        SILENCE_ENDPOINT_FRAMES = int(0.6 * cap_rate)
        has_speech_since_last_emit = False   # prevents hallucinations on tail silence

        # VAD check buffer — accumulate ~300 ms of audio before running
        # Silero so each VAD call has enough samples for a reliable result.
        vad_check_buffer = []
        vad_check_frames = 0
        VAD_CHECK_INTERVAL = int(0.3 * cap_rate)

        print(f"[TranscLoop] capture_rate={cap_rate} Hz  "
              f"max_buffer={MAX_SPEECH_S}s ({max_frames} frames)  "
              f"silence_endpoint=0.6s ({SILENCE_ENDPOINT_FRAMES} frames)  "
              f"overlap={OVERLAP_SECONDS}s ({overlap_frames} frames)")

        # ── sentinel-based drain loop ─────────────────────────────
        while True:
            chunk = self.audio_queue.get()   # blocks until something arrives

            if chunk is STOP_SIGNAL:
                print("[TranscLoop] STOP signal received — draining complete")
                break

            buffer.append(chunk)
            buffer_frames += len(chunk)

            # Accumulate chunks for batched VAD check
            vad_check_buffer.append(chunk)
            vad_check_frames += len(chunk)

            if buffer_frames % (cap_rate * 2) < len(chunk):   # log every ~2 s
                print(f"[TranscLoop] buffer={buffer_frames/cap_rate:.1f}s  "
                      f"queue_size={self.audio_queue.qsize()}  "
                      f"speech_active={speech_active}")

            # ── VAD check (every ~300 ms of accumulated audio) ────
            if vad_check_frames >= VAD_CHECK_INTERVAL:
                vad_audio_int16 = np.concatenate(vad_check_buffer)
                vad_audio_f32   = _resample(vad_audio_int16, cap_rate)
                is_speech       = _vad_has_speech(vad_audio_f32)

                if is_speech:
                    silence_frames = 0
                    speech_active  = True
                    has_speech_since_last_emit = True
                else:
                    silence_frames += vad_check_frames

                vad_check_buffer = []
                vad_check_frames = 0

            # ── inference triggers ────────────────────────────────

            # 1. Endpoint trigger: speech followed by sufficient silence
            #    Buffer is cleared completely — no overlap needed because
            #    the utterance is finished.
            if (speech_active
                    and silence_frames >= SILENCE_ENDPOINT_FRAMES
                    and buffer_frames > 0):
                print(f"[TranscLoop] endpoint trigger "
                      f"({buffer_frames/cap_rate:.1f}s buffered, "
                      f"{silence_frames/cap_rate:.2f}s silence)")
                audio_int16   = np.concatenate(buffer)
                buffer        = []
                buffer_frames = 0
                last_infer_t  = time.time()
                speech_active = False
                silence_frames = 0
                has_speech_since_last_emit = False
                self._infer(model, audio_int16, cap_rate, is_final=False)

            # 2. Overflow trigger (hard cap to prevent memory growth)
            elif buffer_frames >= max_frames:
                print(f"[TranscLoop] overflow trigger "
                      f"({buffer_frames/cap_rate:.1f}s buffered)")
                audio_int16 = np.concatenate(buffer)
                if len(audio_int16) > overlap_frames:
                    buffer        = [audio_int16[-overlap_frames:].copy()]
                    buffer_frames = overlap_frames
                else:
                    buffer        = []
                    buffer_frames = 0
                last_infer_t = time.time()
                has_speech_since_last_emit = False
                self._infer(model, audio_int16, cap_rate, is_final=False)

            # 3. Live trigger during active speech (periodic partial results)
            #    Keeps overlap so long continuous speech has phonetic continuity.
            elif (speech_active
                      and buffer_frames >= int(MIN_SPEECH_S * cap_rate)):
                elapsed = time.time() - last_infer_t
                if elapsed >= MIN_SPEECH_S:
                    print(f"[TranscLoop] live trigger "
                          f"({buffer_frames/cap_rate:.1f}s buffered)")
                    audio_int16 = np.concatenate(buffer)
                    if len(audio_int16) > overlap_frames:
                        buffer        = [audio_int16[-overlap_frames:].copy()]
                        buffer_frames = overlap_frames
                    else:
                        buffer        = []
                        buffer_frames = 0
                    last_infer_t = time.time()
                    self._infer(model, audio_int16, cap_rate, is_final=False)

        # ── final inference on remaining buffer ──────────────────
        # Only run if there is un-emitted speech.  If the endpoint
        # already fired and nothing new was spoken, skip — otherwise
        # Whisper hallucinates on the leftover silence.
        if buffer_frames > 0 and has_speech_since_last_emit:
            total_s = buffer_frames / cap_rate
            print(f"[TranscLoop] final inference on {total_s:.2f}s of audio")
            audio_int16 = np.concatenate(buffer)
            self._infer(model, audio_int16, cap_rate, is_final=True)
        else:
            if buffer_frames > 0:
                print(f"[TranscLoop] Skipping final — no new speech since last emit "
                      f"({buffer_frames/cap_rate:.2f}s of silence/overlap)")
            else:
                print("[TranscLoop] No audio captured")
            self._flush_final_if_needed(is_final=True)

        print("[TranscLoop] Done")

    # ── inference ────────────────────────────────────────────────

    def _infer(self, model: WhisperModel, audio_int16: np.ndarray,
               cap_rate: int, is_final: bool = False):
        """
        Full pipeline for one audio batch:
          1. Compute quality metrics on the raw (native-rate) buffer
          2. Save debug WAV if quota allows
          3. Resample to 16 kHz float32
          4. Duration gate — skip if too short (bypassed for final)
          5. RMS gate — skip if too quiet
          6. Zero-Crossing-Rate (ZCR) log — diagnostic only
          7. faster-whisper inference with context carryover
          8. Accumulate + deduplicate + send

        VAD is NOT applied here — it is used for endpoint detection
        in _transcribe_loop() instead.
        """
        tag = "FINAL" if is_final else "live"
        print(f"[Infer] CALLED with audio length: {len(audio_int16)}"
              f" ({len(audio_int16)/cap_rate:.2f}s @ {cap_rate} Hz)")

        # ── 1. Raw buffer quality metrics ────────────────────────────────
        raw_duration_s = len(audio_int16) / cap_rate
        raw_rms        = float(np.sqrt(np.mean(audio_int16.astype(np.float32) ** 2)))
        raw_peak       = int(np.abs(audio_int16).max())
        raw_db         = 20 * math.log10(raw_rms / 32768.0 + 1e-9)

        print(f"[Infer:{tag}] raw buffer  dur={raw_duration_s:.2f}s  "
              f"RMS={raw_rms:.1f}  peak={raw_peak}  dB={raw_db:.1f}")

        # ── 2. Debug WAV ──────────────────────────────────────────────────
        _save_debug_wav(audio_int16, cap_rate, tag=f"_{tag.lower()}")

        # ── 3. Resample to WHISPER_RATE ───────────────────────────────────
        print(f"[Infer:{tag}] resampling {cap_rate} Hz -> {WHISPER_RATE} Hz ...")
        audio_f32 = _resample(audio_int16, cap_rate)

        resampled_dur = len(audio_f32) / WHISPER_RATE
        resampled_rms = float(np.sqrt(np.mean(audio_f32 ** 2)))
        print(f"[Infer:{tag}] resampled  dur={resampled_dur:.2f}s  "
              f"RMS_f32={resampled_rms:.4f}  "
              f"min={audio_f32.min():.4f}  max={audio_f32.max():.4f}")

        # ── 4. Duration gate (bypassed for final inference) ──────────────
        print(f"[Infer:{tag}] duration: {resampled_dur:.3f}s  "
              f"(minimum: {MIN_INFER_DURATION_S}s)")
        if resampled_dur < MIN_INFER_DURATION_S and not is_final:
            print(f"[Infer:{tag}] SKIP: duration too short (non-final)")
            self._flush_final_if_needed(is_final)
            return
        if is_final and resampled_dur < 0.3:
            print(f"[Infer:{tag}] SKIP: final segment too short (<0.3s)")
            self._flush_final_if_needed(is_final)
            return

        # ── 5. RMS gate ───────────────────────────────────────────────────
        print(f"[Infer:{tag}] RMS: {resampled_rms:.5f}  "
              f"(threshold: {MIN_INFER_RMS})")
        if resampled_rms < MIN_INFER_RMS:
            print(f"[Infer:{tag}] SKIP: RMS below threshold (dead signal)")
            self._flush_final_if_needed(is_final)
            return

        # ── 6. Zero-Crossing Rate (diagnostic) ───────────────────────────
        zcr_total  = np.sum(np.abs(np.diff(audio_f32 > 0)))
        zcr_rate   = zcr_total / max(len(audio_f32) - 1, 1)
        print(f"[Infer:{tag}] ZCR={zcr_rate:.4f} crossings/sample  "
              f"({zcr_total} total)")

        # ── 7. faster-whisper inference ────────────────────────────────────
        print(f"[Infer:{tag}] starting faster-whisper inference …")
        t0 = time.time()
        try:
            segments_gen, info = model.transcribe(
                audio_f32,
                language                   = "en",
                task                       = "transcribe",
                beam_size                  = 5,
                temperature                = 0.0,
                condition_on_previous_text = False,
                no_speech_threshold        = 0.6,
                log_prob_threshold         = -1.0,
                vad_filter                 = False,
                without_timestamps         = True,
            )
            # Materialise the lazy generator
            segments = list(segments_gen)
        except Exception as e:
            print(f"[Infer:{tag}] faster-whisper error: {e}")
            import traceback; traceback.print_exc()
            self._flush_final_if_needed(is_final)
            return

        elapsed_ms = int((time.time() - t0) * 1000)
        detected_lang = getattr(info, "language", "?")
        lang_prob     = getattr(info, "language_probability", 0.0)
        print(f"[Infer:{tag}] inference done in {elapsed_ms}ms  "
              f"lang={detected_lang} ({lang_prob:.2f})")

        # Log individual segments
        raw_parts = []
        for i, seg in enumerate(segments):
            nsp = getattr(seg, "no_speech_prob", None)
            nsp_str = f"{nsp:.3f}" if nsp is not None else "?"
            text = seg.text.strip()
            print(f"  segment[{i}]  [{seg.start:.2f}s-{seg.end:.2f}s]  "
                  f"no_speech={nsp_str}  '{text}'")
            if text:
                raw_parts.append(text)

        raw_text = " ".join(raw_parts).strip()
        print(f"[Infer:{tag}] combined result: '{raw_text}'")

        if not raw_text:
            print(f"[Infer:{tag}] empty output — skipping")
            self._flush_final_if_needed(is_final)
            return

        # ── 8. Accumulate + word-boundary dedup + send ───────────────────
        if self.accumulated_text:
            acc_words = self.accumulated_text.split()
            new_words = raw_text.split()
            overlap   = 0
            for length in range(min(len(acc_words), len(new_words), 8), 0, -1):
                if acc_words[-length:] == new_words[:length]:
                    overlap = length
                    break
            unique = new_words[overlap:]
            if unique:
                self.accumulated_text = (
                    self.accumulated_text + " " + " ".join(unique)
                ).strip()
        else:
            self.accumulated_text = raw_text

        print(f"[Infer:{tag}] accumulated: '{self.accumulated_text}'")

        self._send({
            "type":        "final" if is_final else "transcription",
            "text":        raw_text,
            "accumulated": self.accumulated_text,
        })

    def _flush_final_if_needed(self, is_final: bool):
        """If this was the last inference call, still deliver whatever we have."""
        if is_final:
            self._send({
                "type":        "final",
                "text":        self.accumulated_text,
                "accumulated": self.accumulated_text,
            })

    # ── helpers ──────────────────────────────────────────────────

    def _send(self, payload: dict):
        if self.event_loop:
            asyncio.run_coroutine_threadsafe(
                self.websocket.send_json(payload),
                self.event_loop
            )

# Active transcription sessions
active_sessions: dict[str, TranscriptionSession] = {}

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """WebSocket endpoint for continuous transcription."""
    await websocket.accept()
    print("[WebSocket] Client connected")
    session_id = None
    event_loop = asyncio.get_event_loop()

    try:
        while True:
            data = await websocket.receive_json()
            print(f"[WebSocket] Received message: {data}")

            if data["action"] == "start":
                session_id = data.get("session_id", f"session_{int(time.time())}")
                print(f"[WebSocket] Starting transcription session: {session_id}")
                session = TranscriptionSession(websocket, event_loop)
                active_sessions[session_id] = session
                session.start_recording()
                print(f"[WebSocket] Recording started for session: {session_id}")
                await websocket.send_json({"type": "status", "status": "listening", "session_id": session_id})

            elif data["action"] == "stop":
                print(f"[WebSocket] Received stop request for session: {session_id}")
                if session_id and session_id in active_sessions:
                    session = active_sessions[session_id]
                    session.stop_recording()
                    print(f"[WebSocket] Stopping recording for session: {session_id}")

                    # Wait for the transcription thread to drain the queue and
                    # deliver the final result — poll in short increments so we
                    # don't block the event loop, timeout after 30 s.
                    max_wait_s = 30.0
                    poll_interval_s = 0.2
                    waited = 0.0
                    while waited < max_wait_s:
                        t = session.transcription_thread
                        if t is None or not t.is_alive():
                            break
                        await asyncio.sleep(poll_interval_s)
                        waited += poll_interval_s

                    if waited >= max_wait_s:
                        print(f"[WebSocket] WARNING: transcription thread did not finish within {max_wait_s}s")

                    print(f"[WebSocket] Transcription thread finished after {waited:.1f}s")
                    del active_sessions[session_id]
                    await websocket.send_json({"type": "status", "status": "stopped"})
                else:
                    print(f"[WebSocket] WARNING: Stop requested but no active session found: {session_id}")

    except WebSocketDisconnect:
        print(f"[WebSocket] Client disconnected (session: {session_id})")
        if session_id and session_id in active_sessions:
            session = active_sessions[session_id]
            session.stop_recording()
            del active_sessions[session_id]
    except Exception as e:
        print(f"[WebSocket] Error in websocket handler: {e}")
        import traceback
        traceback.print_exc()
        if session_id and session_id in active_sessions:
            session = active_sessions[session_id]
            session.stop_recording()
            del active_sessions[session_id]

@app.get("/")
async def root():
    return {
        "service": "Prompt Optimizer API",
        "version": "1.0.0",
        "endpoints": {
            "optimize": "POST /optimize",
            "health": "GET /health",
            "transcribe": "WebSocket /ws/transcribe"
        }
    }

@app.on_event("startup")
async def startup_event():
    """Preload faster-whisper and Silero VAD models at startup."""
    print("[Startup] Preloading faster-whisper model …")
    try:
        get_faster_whisper_model()
        print("[Startup] faster-whisper ready")
    except Exception as e:
        print(f"[Startup] Warning: faster-whisper preload failed: {e}")

    print("[Startup] Preloading Silero VAD model …")
    try:
        get_vad_model()
        print("[Startup] Silero VAD ready")
    except Exception as e:
        print(f"[Startup] Warning: Silero VAD preload failed: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


