from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import ollama
import time
import re

app = FastAPI()

# CORS middleware to allow Electron to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# System prompt for optimization
SYSTEM_PROMPT = """You are an expert prompt engineer. Your task is to optimize user prompts to be:
1. Clear and specific
2. Well-structured with proper formatting
3. Action-oriented
4. Include necessary context
5. Remove redundancy
6. Improve clarity without changing intent

Return ONLY the optimized prompt, no explanations or meta-commentary. Do not wrap it in code blocks or add any prefix like "Here's the optimized version:". Just return the prompt itself."""

class OptimizeRequest(BaseModel):
    prompt: str

class OptimizeResponse(BaseModel):
    optimized: str
    original: str
    model: str = "llama3.2"
    latency_ms: Optional[float] = None

# Simple in-memory cache (LRU would be better for production)
prompt_cache: dict[str, str] = {}
MAX_CACHE_SIZE = 100

def clean_optimized_text(text: str) -> str:
    """Remove markdown code blocks and other formatting artifacts."""
    # Remove markdown code blocks
    text = re.sub(r'^```[\w]*\n?', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n?```$', '', text, flags=re.MULTILINE)
    
    # Remove common prefixes
    prefixes = [
        "Here's the optimized version:",
        "Optimized prompt:",
        "Here's the optimized prompt:",
        "Optimized:",
    ]
    for prefix in prefixes:
        if text.strip().startswith(prefix):
            text = text.strip()[len(prefix):].strip()
    
    return text.strip()

@app.post("/optimize", response_model=OptimizeResponse)
async def optimize_prompt(request: OptimizeRequest):
    start_time = time.time()
    
    if not request.prompt or len(request.prompt.strip()) < 3:
        raise HTTPException(status_code=400, detail="Prompt too short (minimum 3 characters)")
    
    prompt_text = request.prompt.strip()
    
    # Check cache
    if prompt_text in prompt_cache:
        latency = (time.time() - start_time) * 1000
        return OptimizeResponse(
            optimized=prompt_cache[prompt_text],
            original=prompt_text,
            latency_ms=latency
        )
    
    try:
        # Call Ollama
        response = ollama.chat(
            model="llama3.2",  # Default model - user should configure
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Optimize this prompt: {prompt_text}"}
            ],
            options={
                "temperature": 0.7,
                "num_predict": 500
            }
        )
        
        optimized = response["message"]["content"]
        optimized = clean_optimized_text(optimized)
        
        # Cache the result
        if len(prompt_cache) >= MAX_CACHE_SIZE:
            # Remove oldest entry (simple FIFO)
            prompt_cache.pop(next(iter(prompt_cache)))
        prompt_cache[prompt_text] = optimized
        
        latency = (time.time() - start_time) * 1000
        
        return OptimizeResponse(
            optimized=optimized,
            original=prompt_text,
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

@app.get("/health")
async def health():
    """Health check endpoint."""
    try:
        # Try to list models to verify Ollama is accessible
        models = ollama.list()
        return {
            "status": "ok",
            "service": "prompt-optimizer",
            "ollama_connected": True,
            "models_available": len(models.get("models", []))
        }
    except Exception as e:
        return {
            "status": "degraded",
            "service": "prompt-optimizer",
            "ollama_connected": False,
            "error": str(e)
        }

@app.get("/")
async def root():
    return {
        "service": "Prompt Optimizer API",
        "version": "1.0.0",
        "endpoints": {
            "optimize": "POST /optimize",
            "health": "GET /health"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
