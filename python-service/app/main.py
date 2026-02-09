from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import ollama
import time
import re
import whisper
import numpy as np
import pyaudio
import io
import base64
import json
import threading
import queue
import asyncio
import os
import torch
from pathlib import Path

app = FastAPI()

# ============================================
# SKILL MANAGER - Load optimization strategies from skill files
# ============================================

class SkillManager:
    """Manages loading and retrieval of skill-based optimization strategies."""
    
    def __init__(self, skills_dir: str = "app/skills"):
        self.skills_dir = Path(skills_dir)
        self.skills = {}
        self.skill_keywords = {}
        self.load_skills()
    
    def load_skills(self):
        """Load all skill files from the skills directory."""
        if not self.skills_dir.exists():
            print(f"[SkillManager] WARNING: Skills directory not found: {self.skills_dir}")
            return
        
        skill_files = list(self.skills_dir.glob("skill_*.md"))
        print(f"[SkillManager] Loading {len(skill_files)} skill files...")
        
        for skill_file in skill_files:
            skill_name = skill_file.stem.replace("skill_", "")
            try:
                with open(skill_file, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Parse frontmatter (YAML between ---)
                keywords = []
                strategy_content = content
                
                if content.startswith('---'):
                    parts = content.split('---', 2)
                    if len(parts) >= 3:
                        frontmatter = parts[1]
                        strategy_content = parts[2].strip()
                        
                        # Extract keywords from frontmatter
                        for line in frontmatter.split('\n'):
                            if line.strip().startswith('keywords:'):
                                # Parse keywords list
                                keywords_str = line.split('keywords:', 1)[1].strip()
                                if keywords_str.startswith('['):
                                    # Parse JSON-style list
                                    import json
                                    try:
                                        keywords = json.loads(keywords_str)
                                    except:
                                        pass
                
                self.skills[skill_name] = strategy_content
                self.skill_keywords[skill_name] = keywords
                print(f"[SkillManager] ✓ Loaded skill '{skill_name}' ({len(keywords)} keywords)")
                
            except Exception as e:
                print(f"[SkillManager] ✗ Failed to load {skill_file.name}: {e}")
        
        print(f"[SkillManager] Successfully loaded {len(self.skills)} skills")
    
    def get_strategy(self, skill_name: str) -> str:
        """Get the optimization strategy for a specific skill."""
        return self.skills.get(skill_name, self.skills.get('general', ''))
    
    def get_keywords(self, skill_name: str) -> list:
        """Get the keywords for a specific skill."""
        return self.skill_keywords.get(skill_name, [])

# Initialize SkillManager
skill_manager = SkillManager()


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
                        'fiction', 'write about', 'describe', 'imagine', 'fantasy', 'sci-fi',
                        'blog', 'article', 'essay', 'script', 'lyrics', 'screenplay']
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
    Now loads from skill files via SkillManager.
    """
    return skill_manager.get_strategy(prompt_type)


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
            latency_ms=latency
        )

    if request.skip_cache:
        print(f"[Optimize] Cache bypassed - generating fresh optimization (refresh requested)")

    try:
        # Detect prompt type for adaptive optimization
        prompt_type = detect_prompt_type(prompt_text)
        optimization_strategy = get_optimization_strategy(prompt_type)

        print(f"[Optimize] Detected prompt type: {prompt_type}")
        print(f"[Optimize] Applying {prompt_type} optimization strategy")

        # Check if we have chat history (context-aware mode)
        has_history = request.messages and len(request.messages) > 0
        if has_history:
            print(f"[Optimize] Context-aware mode: {len(request.messages)} previous messages")
        
        # Use higher temperature for regenerate requests to ensure different results
        temperature = 1.2 if request.skip_cache else 0.7

        # Build messages array for Ollama
        ollama_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": f"Specific strategy for this {prompt_type} prompt:\n\n{optimization_strategy}"},
        ]
        
        # If we have chat history, include it for context
        if has_history:
            for msg in request.messages:
                ollama_messages.append({
                    "role": msg.role,
                    "content": msg.content
                })
        
        # Add the current user prompt
        ollama_messages.append({"role": "user", "content": prompt_text})

        # Call Ollama with adaptive system prompt
        response = ollama.chat(
            model="llama3.2",  # Default model - user should configure
            messages=ollama_messages,
            options={
                "temperature": temperature,
                "num_predict": 800  # Increased from 500 to allow for richer optimizations
            }
        )

        optimized = response["message"]["content"]
        optimized = clean_optimized_text(optimized)

        # Remove the unique ID from optimized text if it was added for regenerate
        if request.skip_cache and "[REGENERATE_" in optimized:
            import re
            optimized = re.sub(r'\n*\[REGENERATE_\d+\]', '', optimized).strip()

        print(f"[Optimize] Original length: {len(request.prompt.strip())} chars")
        print(f"[Optimize] Optimized length: {len(optimized)} chars")
        print(f"[Optimize] Improvement ratio: {len(optimized)/len(request.prompt.strip()):.2f}x")

        # Cache the result (use original prompt as key)
        cache_key = request.prompt.strip()
        if len(prompt_cache) >= MAX_CACHE_SIZE:
            # Remove oldest entry (simple FIFO)
            prompt_cache.pop(next(iter(prompt_cache)))
        prompt_cache[cache_key] = optimized

        latency = (time.time() - start_time) * 1000

        return OptimizeResponse(
            optimized=optimized,
            original=request.prompt.strip(),
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
    WebSocket endpoint for streaming prompt optimization.
    Streams the optimized text as it's being generated for better UX.
    """
    await websocket.accept()
    print("[OptimizeStream] WebSocket connection accepted")
    
    try:
        # Receive prompt data from client
        data = await websocket.receive_json()
        prompt_text = data.get("prompt", "").strip()
        skip_cache = data.get("skip_cache", False)
        messages = data.get("messages", None)  # Chat history for context
        
        print(f"[OptimizeStream] Received prompt: {prompt_text[:50]}... (length: {len(prompt_text)})")
        print(f"[OptimizeStream] skip_cache: {skip_cache}, has_history: {messages is not None}")
        
        if not prompt_text or len(prompt_text) < 3:
            await websocket.send_json({
                "type": "error",
                "message": "Prompt too short (minimum 3 characters)"
            })
            await websocket.close()
            return
        
        # Detect prompt type for adaptive optimization
        prompt_type = detect_prompt_type(prompt_text)
        optimization_strategy = get_optimization_strategy(prompt_type)
        
        print(f"[OptimizeStream] Detected prompt type: {prompt_type}")
        
        # Build messages for Ollama
        ollama_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "system", "content": f"Specific strategy for this {prompt_type} prompt:\n\n{optimization_strategy}"}
        ]
        
        # Add chat history if provided
        if messages and isinstance(messages, list):
            for msg in messages:
                if hasattr(msg, 'role') and hasattr(msg, 'content'):
                    ollama_messages.append({
                        "role": msg.role,
                        "content": msg.content
                    })
        
        # Add current user prompt
        ollama_messages.append({"role": "user", "content": prompt_text})
        
        # Use higher temperature for regenerate requests
        temperature = 1.2 if skip_cache else 0.7
        
        print(f"[OptimizeStream] Starting Ollama streaming with temperature={temperature}")
        
        # Stream response from Ollama
        stream = ollama.chat(
            model="llama3.2",
            messages=ollama_messages,
            options={
                "temperature": temperature,
                "num_predict": 800
            },
            stream=True  # Enable streaming!
        )
        
        # Stream chunks to client
        accumulated_text = ""
        chunk_count = 0
        
        for chunk in stream:
            if chunk.get("message"):
                content = chunk["message"]["content"]
                accumulated_text += content
                chunk_count += 1
                
                # Send chunk to client
                await websocket.send_json({
                    "type": "chunk",
                    "content": content,
                    "accumulated": accumulated_text
                })
                
                # if chunk_count % 10 == 0:
                #     print(f"[OptimizeStream] Sent {chunk_count} chunks, {len(accumulated_text)} chars so far")
        
        print(f"[OptimizeStream] Streaming complete. Total chunks: {chunk_count}, total chars: {len(accumulated_text)}")
        
        # Clean the accumulated text
        cleaned_text = clean_optimized_text(accumulated_text)
        
        print(f"[OptimizeStream] Cleaned text length: {len(cleaned_text)} chars")
        
        # Send completion signal with final cleaned text
        await websocket.send_json({
            "type": "complete",
            "optimized": cleaned_text,
            "original": prompt_text
        })
        
        print("[OptimizeStream] ✓ Optimization complete, closing connection")
        
    except WebSocketDisconnect:
        print("[OptimizeStream] Client disconnected")
    except Exception as e:
        print(f"[OptimizeStream] ✗ Error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Optimization failed: {str(e)}"
            })
        except:
            pass  # Connection might be closed
    finally:
        try:
            await websocket.close()
        except:
            pass

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

# Whisper model (loaded lazily)
whisper_model = None

def get_whisper_model():
    """Lazy load Whisper model (small)."""
    global whisper_model
    if whisper_model is None:
        print("[Whisper] Loading Whisper small model...")
        # Load the small model for balance between speed and accuracy
        whisper_model = whisper.load_model("small")
        print("[Whisper] Model loaded successfully")
    return whisper_model

# Audio configuration
CHUNK = 4096
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
RECORD_SECONDS = 1  # Process audio in 1-second chunks

class TranscriptionSession:
    """Manages a single transcription session."""
    def __init__(self, websocket: WebSocket, event_loop):
        self.websocket = websocket
        self.event_loop = event_loop
        self.audio_queue = queue.Queue()
        self.is_recording = False
        self.audio_buffer = []
        self.transcription_thread = None
        self.accumulated_text = ""  # Store accumulated transcription for live updates
        
    def start_recording(self):
        """Start audio recording."""
        if self.is_recording:
            print("[Transcription] Already recording")
            return

        print("[Transcription] ===== STARTING RECORDING SESSION =====")
        self.is_recording = True
        self.audio_buffer = []
        self.accumulated_text = ""  # Reset accumulated text for new session

        # Clear any old audio data from previous session
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except:
                break
        print("[Transcription] Audio queue cleared for new session")

        # Start audio capture thread
        try:
            print("[Transcription] Spawning audio capture thread...")
            self.audio_thread = threading.Thread(target=self._capture_audio, daemon=True)
            self.audio_thread.start()
            print("[Transcription] ✓ Audio capture thread started successfully")
        except Exception as e:
            print(f"[Transcription] ✗ Failed to start audio thread: {e}")
            import traceback
            traceback.print_exc()
            self.is_recording = False
            return

        # Start transcription thread
        try:
            print("[Transcription] Spawning transcription thread...")
            self.transcription_thread = threading.Thread(target=self._transcribe_loop, daemon=True)
            self.transcription_thread.start()
            print("[Transcription] ✓ Transcription thread started successfully")
            print("[Transcription] ===== RECORDING SESSION ACTIVE =====")
        except Exception as e:
            print(f"[Transcription] ✗ Failed to start transcription thread: {e}")
            import traceback
            traceback.print_exc()
            self.is_recording = False
            return
        
    def stop_recording(self):
        """Stop audio recording."""
        print("[Transcription] ===== STOPPING RECORDING SESSION =====")
        print(f"[Transcription] is_recording was: {self.is_recording}")
        self.is_recording = False
        print("[Transcription] Recording flag set to False, waiting for threads to finish...")
        
    def _capture_audio(self):
        """Capture audio from microphone."""
        print("[Transcription] _capture_audio method started")
        audio = None
        stream = None

        try:
            print("[Transcription] Initializing PyAudio...")
            audio = pyaudio.PyAudio()
            print(f"[Transcription] PyAudio initialized successfully")

            # List all available audio devices
            print("[Transcription] Enumerating audio devices...")
            device_count = audio.get_device_count()
            print(f"[Transcription] Found {device_count} audio devices")

            default_input_device = None
            try:
                default_input_device = audio.get_default_input_device_info()
                print(f"[Transcription] Default input device: {default_input_device['name']} (index={default_input_device['index']})")
            except Exception as e:
                print(f"[Transcription] No default input device: {e}")

            for i in range(device_count):
                try:
                    device_info = audio.get_device_info_by_index(i)
                    if device_info['maxInputChannels'] > 0:
                        print(f"[Transcription]   Device {i}: {device_info['name']} (input channels={device_info['maxInputChannels']})")
                except Exception as e:
                    print(f"[Transcription]   Device {i}: Error getting info - {e}")

            print(f"[Transcription] Opening audio stream with: FORMAT={FORMAT}, CHANNELS={CHANNELS}, RATE={RATE}, CHUNK={CHUNK}")

            # Check if default input device supports our requirements
            if default_input_device:
                device_index = default_input_device['index']
                max_input_channels = default_input_device['maxInputChannels']
                default_sample_rate = default_input_device['defaultSampleRate']

                print(f"[Transcription] Using device {device_index}: {default_input_device['name']}")
                print(f"  - Max input channels: {max_input_channels}")
                print(f"  - Default sample rate: {default_sample_rate} Hz")

                if default_sample_rate != RATE:
                    print(f"  - WARNING: Device default rate {default_sample_rate} != requested rate {RATE}")

            try:
                stream = audio.open(
                    format=FORMAT,
                    channels=CHANNELS,
                    rate=RATE,
                    input=True,
                    frames_per_buffer=CHUNK
                )
                print("[Transcription] Audio stream opened successfully")
            except Exception as e:
                print(f"[Transcription] Failed to open audio stream: {e}")
                import traceback
                traceback.print_exc()
                raise

            print("[Transcription] Started audio capture - now reading from microphone")
            print("[Transcription] ========================================")
            print("[Transcription] MICROPHONE DIAGNOSTIC MODE ENABLED")
            print("[Transcription] Will log detailed audio metrics every 10 chunks")
            print("[Transcription] ========================================")

            chunk_count = 0
            first_chunk_validated = False

            while self.is_recording:
                try:
                    data = stream.read(CHUNK, exception_on_overflow=False)
                    chunk_count += 1

                    # Validate first audio chunk
                    if not first_chunk_validated:
                        print(f"[Transcription] ========================================")
                        print(f"[Transcription] FIRST AUDIO CHUNK VALIDATION:")
                        print(f"[Transcription] ========================================")
                        print(f"  - Chunk byte size: {len(data)} bytes")
                        print(f"  - Expected byte size: {CHUNK * 2} bytes (CHUNK={CHUNK}, int16=2 bytes)")
                        print(f"  - Audio format: {FORMAT} (8=paInt16)")
                        print(f"  - Channels: {CHANNELS}")
                        print(f"  - Sample rate: {RATE} Hz")

                        # Check audio data validity
                        audio_array = np.frombuffer(data, dtype=np.int16)
                        print(f"  - NumPy dtype: {audio_array.dtype}")
                        print(f"  - Audio samples: {len(audio_array)}")
                        print(f"  - Audio min/max: {audio_array.min()} / {audio_array.max()}")
                        print(f"  - Audio mean: {audio_array.mean():.2f}")
                        print(f"  - Audio std dev: {audio_array.std():.2f}")

                        # Calculate RMS and dB for first chunk
                        rms = np.sqrt(np.mean(audio_array.astype(np.float32)**2))
                        if rms > 0:
                            db = 20 * np.log10(rms / 32768.0)
                        else:
                            db = -100
                        peak = np.abs(audio_array).max()

                        print(f"  - RMS amplitude: {rms:.2f}")
                        print(f"  - Decibels (dB): {db:.2f} dB")
                        print(f"  - Peak amplitude: {peak} / 32768 ({(peak/32768.0*100):.4f}%)")

                        # Check if audio is silent (all zeros or very low values)
                        print(f"\n[Transcription] DIAGNOSIS:")
                        if db < -60:
                            print(f"  - STATUS: CRITICAL - Audio is essentially SILENT!")
                            print(f"  - LIKELY CAUSES:")
                            print(f"    1. Microphone is MUTED in Windows settings")
                            print(f"    2. Wrong microphone selected (check Sound Control Panel)")
                            print(f"    3. Microphone volume set to 0%")
                            print(f"    4. Application doesn't have microphone permissions")
                            print(f"  - ACTION REQUIRED: Check Windows microphone settings!")
                        elif db < -40:
                            print(f"  - STATUS: WARNING - Audio is very quiet")
                            print(f"  - SUGGESTION: Increase microphone volume in Windows settings")
                        elif db < -20:
                            print(f"  - STATUS: OK - Normal speech levels detected")
                        else:
                            print(f"  - STATUS: EXCELLENT - Strong audio signal detected")

                        print(f"[Transcription] ========================================")
                        first_chunk_validated = True

                    if chunk_count % 10 == 0:  # Log every 10 chunks
                        print(f"[Transcription] Captured {chunk_count} audio chunks")

                    # For Whisper, we apply moderate gain only if audio is too quiet
                    audio_array = np.frombuffer(data, dtype=np.int16).copy()

                    # Check audio level and apply adaptive gain
                    audio_std = audio_array.std()
                    if audio_std < 100:
                        # Audio is very quiet, apply moderate gain
                        GAIN = 5.0  # Moderate boost for Whisper (reduced from 50x)
                        audio_array = audio_array.astype(np.float32) * GAIN
                        audio_array = np.clip(audio_array, -32768, 32767)
                        audio_array = audio_array.astype(np.int16)

                    # Convert to bytes for processing
                    processed_data = audio_array.tobytes()

                    # Log audio stats every 10 chunks for better debugging
                    if chunk_count % 10 == 0:
                        original_audio = np.frombuffer(data, dtype=np.int16)

                        # Calculate RMS (Root Mean Square) amplitude
                        rms = np.sqrt(np.mean(original_audio.astype(np.float32)**2))

                        # Calculate decibels (dB) - reference is max int16 value
                        if rms > 0:
                            db = 20 * np.log10(rms / 32768.0)
                        else:
                            db = -100  # Very quiet/silent

                        # Calculate peak amplitude
                        peak = np.abs(original_audio).max()

                        print(f"[Transcription] Audio metrics (chunk {chunk_count}):")
                        print(f"  - RMS amplitude: {rms:.2f}")
                        print(f"  - Decibels (dB): {db:.2f} dB")
                        print(f"  - Peak amplitude: {peak} / 32768 ({(peak/32768.0*100):.2f}%)")
                        print(f"  - Std deviation: {original_audio.std():.2f}")
                        print(f"  - Min/Max: {original_audio.min()} / {original_audio.max()}")
                        print(f"  - Gain applied: {'YES (5x)' if audio_std < 100 else 'NO'}")

                        # Audio quality assessment
                        if db < -60:
                            print(f"  - Quality: VERY QUIET/SILENT - Likely no microphone input!")
                        elif db < -40:
                            print(f"  - Quality: Quiet - Microphone may be muted or volume too low")
                        elif db < -20:
                            print(f"  - Quality: Normal speech levels")
                        else:
                            print(f"  - Quality: Loud - Good signal")

                    # Queue audio data for transcription
                    self.audio_queue.put(processed_data)
                except Exception as e:
                    print(f"[Transcription] Audio capture error while reading: {e}")
                    import traceback
                    traceback.print_exc()
                    break

            print(f"[Transcription] Stopped capturing audio (total chunks: {chunk_count})")

        except Exception as e:
            print(f"[Transcription] EXCEPTION in _capture_audio: {e}")
            import traceback
            traceback.print_exc()
            if self.event_loop:
                asyncio.run_coroutine_threadsafe(
                    self.websocket.send_json({"type": "error", "message": f"Audio capture failed: {str(e)}"}),
                    self.event_loop
                )
        finally:
            print("[Transcription] Cleaning up audio resources...")
            if stream:
                try:
                    stream.stop_stream()
                    stream.close()
                    print("[Transcription] Stream closed")
                except Exception as e:
                    print(f"[Transcription] Error closing stream: {e}")
            if audio:
                try:
                    audio.terminate()
                    print("[Transcription] PyAudio terminated")
                except Exception as e:
                    print(f"[Transcription] Error terminating PyAudio: {e}")
    
    def _transcribe_loop(self):
        """Continuously transcribe audio chunks using Whisper."""
        print("[Transcription] _transcribe_loop starting...")

        # Load Whisper model
        model = get_whisper_model()
        print("[Transcription] Whisper model ready")

        accumulated_audio = []
        audio_chunks_processed = 0

        print("[Transcription] Started transcription loop")
        print(f"[Transcription] is_recording = {self.is_recording}")
        print(f"[Transcription] audio_queue size = {self.audio_queue.qsize()}")

        # Give audio capture thread time to start filling the queue
        import time
        time.sleep(0.5)
        print(f"[Transcription] After 0.5s delay, queue size = {self.audio_queue.qsize()}")

        # Collect audio in chunks and transcribe periodically for live feedback
        last_transcription_time = time.time()
        transcription_interval = 1.5  # Transcribe every 1.5 seconds for faster live updates

        while self.is_recording or not self.audio_queue.empty():
            try:
                # Get audio chunk (raw bytes)
                try:
                    timeout = 0.1 if self.is_recording else 0.05
                    audio_data = self.audio_queue.get(timeout=timeout)
                    audio_chunks_processed += 1

                    # Convert bytes to numpy array and accumulate
                    audio_array = np.frombuffer(audio_data, dtype=np.int16)
                    accumulated_audio.append(audio_array)

                    if audio_chunks_processed % 10 == 0:
                        print(f"[Transcription] Accumulated {audio_chunks_processed} audio chunks")

                except queue.Empty:
                    # Check if we should transcribe what we have
                    if accumulated_audio and time.time() - last_transcription_time > transcription_interval:
                        self._process_accumulated_audio(model, accumulated_audio)
                        accumulated_audio = []
                        last_transcription_time = time.time()
                    continue

                # Transcribe periodically while recording
                current_time = time.time()
                if accumulated_audio and (current_time - last_transcription_time) >= transcription_interval:
                    self._process_accumulated_audio(model, accumulated_audio)
                    accumulated_audio = []
                    last_transcription_time = current_time

            except Exception as e:
                print(f"[Transcription] Transcription error: {e}")
                import traceback
                traceback.print_exc()
                if self.is_recording and self.event_loop:
                    asyncio.run_coroutine_threadsafe(
                        self.websocket.send_json({"type": "error", "message": str(e)}),
                        self.event_loop
                    )

        print(f"[Transcription] Exited while loop. is_recording = {self.is_recording}")
        print(f"[Transcription] Stopped transcription loop (processed {audio_chunks_processed} chunks)")

        # Process any remaining audio
        if accumulated_audio:
            print("[Transcription] Processing final audio buffer...")
            self._process_accumulated_audio(model, accumulated_audio, is_final=True)

    def _process_accumulated_audio(self, model, audio_chunks, is_final=False):
        """Process accumulated audio chunks with Whisper."""
        try:
            # Concatenate all audio chunks
            audio_array = np.concatenate(audio_chunks)

            print(f"[Transcription] Processing {len(audio_array)} samples ({len(audio_array)/RATE:.2f}s of audio)...")
            print(f"[Transcription] Audio stats - min: {audio_array.min()}, max: {audio_array.max()}, mean: {audio_array.mean():.2f}, std: {audio_array.std():.2f}")

            # Check if audio contains actual signal
            audio_std = audio_array.std()
            if audio_std < 10:
                print(f"[Transcription] WARNING: Audio signal is too quiet (std={audio_std:.2f}), likely silence or no microphone input")
                # Don't skip processing, let Whisper decide, but warn the user

            # Normalize audio properly for Whisper
            # 1. Convert int16 to float32
            audio_float = audio_array.astype(np.float32)

            # 2. Normalize to [-1, 1] range
            audio_float = audio_float / 32768.0

            # 3. Apply additional normalization to ensure proper range
            # BUT only if we have actual signal (avoid amplifying silence)
            max_val = np.abs(audio_float).max()
            if max_val > 0.001:  # Only normalize if we have actual signal
                audio_float = audio_float / max_val
            else:
                print(f"[Transcription] WARNING: Maximum amplitude is very low ({max_val:.6f}), audio may be silence")

            # 4. Pad or trim audio to meet Whisper's expectations (Whisper expects at least 0.1s of audio)
            min_samples = int(0.1 * RATE)  # 0.1 seconds minimum
            if len(audio_float) < min_samples:
                print(f"[Transcription] Audio too short ({len(audio_float)} samples), padding to {min_samples}")
                audio_float = np.pad(audio_float, (0, min_samples - len(audio_float)), mode='constant')

            print(f"[Transcription] Normalized audio - min: {audio_float.min():.4f}, max: {audio_float.max():.4f}, mean: {audio_float.mean():.4f}")
            print(f"[Transcription] Calling Whisper transcribe with language='en'...")

            # Transcribe with Whisper - force language to English
            result = model.transcribe(
                audio_float,
                language="en",  # Force English language
                fp16=torch.cuda.is_available(),  # Use FP16 if GPU available
                verbose=True,  # Enable verbose to see what Whisper is doing
                task="transcribe"  # Explicitly set task to transcribe (not translate)
            )

            transcribed_text = result["text"].strip()
            print(f"[Transcription] Whisper result: '{transcribed_text}'")

            # Also log the segments for debugging
            if "segments" in result:
                print(f"[Transcription] Number of segments: {len(result['segments'])}")
                for i, segment in enumerate(result["segments"]):
                    print(f"[Transcription] Segment {i}: '{segment.get('text', '')}' (no_speech_prob: {segment.get('no_speech_prob', 'N/A')})")

            # Check if this is actual speech or just noise
            # Whisper returns empty or whitespace for non-speech audio
            if transcribed_text and len(transcribed_text) > 0:
                # Accumulate text for live updates
                if not is_final:
                    # For live updates, append new text
                    if transcribed_text not in self.accumulated_text:
                        self.accumulated_text += " " + transcribed_text if self.accumulated_text else transcribed_text
                        self.accumulated_text = self.accumulated_text.strip()
                else:
                    # For final, use accumulated text plus any new text
                    if transcribed_text not in self.accumulated_text:
                        self.accumulated_text += " " + transcribed_text if self.accumulated_text else transcribed_text
                        self.accumulated_text = self.accumulated_text.strip()

                print(f"[Transcription] Accumulated text: '{self.accumulated_text}'")

                if self.event_loop:
                    message_type = "final" if is_final else "transcription"
                    asyncio.run_coroutine_threadsafe(
                        self.websocket.send_json({
                            "type": message_type,
                            "text": transcribed_text,
                            "accumulated": self.accumulated_text  # Send accumulated text for live display
                        }),
                        self.event_loop
                    )
            else:
                print("[Transcription] No speech detected in audio (empty result or silence)")

        except Exception as e:
            print(f"[Transcription] Error processing audio: {e}")
            import traceback
            traceback.print_exc()

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
                    # Wait a moment for final transcription to complete
                    await asyncio.sleep(1.0)
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
    """Preload Whisper model on application startup."""
    print("[Startup] Preloading Whisper model...")
    try:
        get_whisper_model()
        print("[Startup] Whisper model preloaded successfully")
    except Exception as e:
        print(f"[Startup] Warning: Failed to preload Whisper model: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)