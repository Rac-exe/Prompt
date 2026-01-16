from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import ollama
import time
import re
import vosk
import numpy as np
import pyaudio
import io
import base64
import json
import threading
import queue
import asyncio
import os

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
SYSTEM_PROMPT = """You are an expert prompt optimization system.

Your only task is to rewrite the user’s input into a clearer, more specific, and more effective version of the same request.

Strict rules (no exceptions):
- Preserve the original meaning, intent, and scope exactly
- Do not add new ideas, facts, requirements, or assumptions
- Improve clarity, specificity, and structure
- Remove redundancy, filler, and ambiguity
- Make the result immediately usable
- Output ONLY the rewritten prompt or message
- Do NOT explain what you changed
- Do NOT describe improvements
- Do NOT include commentary, notes, or reasoning
- Do NOT add prefixes, suffixes, labels, or headers
- Do NOT wrap the output in quotes, code blocks, or formatting
- Return plain text only

Behavioral constraints:
- Do not ask questions
- Do not provide alternatives or multiple versions
- Do not include examples
- Do not introduce disclaimers or advice
- If the input is fragmented or informal, reconstruct it conservatively
- When intent is unclear, prefer minimal clarification over creative expansion

Context handling:
- If the input is an AI prompt, rewrite it as a clear, specific, and actionable prompt
- If the input is a message (email, chat, professional writing), rewrite it to sound clear and appropriate for its context
- If the input is technical or coding-related, rewrite it into precise, unambiguous instructions
- If the input is for image or video generation, rewrite it as a concise, descriptive generation prompt
- If the input is a question (exam, study, general), rewrite it for clarity without changing its meaning

Final requirement:
Return ONLY the optimized version of the input, as plain text, exactly as the user would want to submit it.
"""

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

# Vosk model (loaded lazily)
vosk_model = None
vosk_rec = None

def get_vosk_model():
    """Lazy load Vosk model."""
    global vosk_model, vosk_rec
    if vosk_model is None:
        # Try to find Vosk model directory
        # Default locations to check
        model_paths = [
            os.path.join(os.path.dirname(__file__), "..", "vosk-model-en-us-0.22"),
            os.path.join(os.path.expanduser("~"), "vosk-model-en-us-0.22"),
            "vosk-model-en-us-0.22",
            "vosk-model-small-en-us-0.15",  # Smaller alternative
        ]
        
        model_path = None
        for path in model_paths:
            if os.path.exists(path) and os.path.isdir(path):
                model_path = path
                break
        
        if model_path is None:
            raise FileNotFoundError(
                "Vosk model not found. Please download a model:\n"
                "1. Download from: https://alphacephei.com/vosk/models\n"
                "2. Extract to: python-service/vosk-model-en-us-0.22\n"
                "Or use: python -m vosk_download_model en-us-0.22"
            )
        
        print(f"[Vosk] Loading Vosk model from: {model_path}")
        vosk_model = vosk.Model(model_path)
        vosk_rec = vosk.KaldiRecognizer(vosk_model, RATE)
        vosk_rec.SetWords(True)
        print("[Vosk] Model loaded successfully")
    return vosk_rec

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
        
    def start_recording(self):
        """Start audio recording."""
        if self.is_recording:
            print("[Transcription] Already recording")
            return

        print("[Transcription] Starting recording...")
        self.is_recording = True
        self.audio_buffer = []

        # Start audio capture thread
        try:
            self.audio_thread = threading.Thread(target=self._capture_audio, daemon=True)
            self.audio_thread.start()
            print("[Transcription] Audio capture thread started")
        except Exception as e:
            print(f"[Transcription] Failed to start audio thread: {e}")
            self.is_recording = False
            return

        # Start transcription thread
        try:
            self.transcription_thread = threading.Thread(target=self._transcribe_loop, daemon=True)
            self.transcription_thread.start()
            print("[Transcription] Transcription thread started")
        except Exception as e:
            print(f"[Transcription] Failed to start transcription thread: {e}")
            self.is_recording = False
            return
        
    def stop_recording(self):
        """Stop audio recording."""
        self.is_recording = False
        
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

            chunk_count = 0
            first_chunk_validated = False

            while self.is_recording:
                try:
                    data = stream.read(CHUNK, exception_on_overflow=False)
                    chunk_count += 1

                    # Validate first audio chunk
                    if not first_chunk_validated:
                        print(f"[Transcription] First audio chunk validation:")
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

                        # Check if audio is silent (all zeros or very low values)
                        if audio_array.std() < 10:
                            print(f"  - WARNING: Audio appears to be silent or very quiet!")
                        else:
                            print(f"  - Audio has valid signal")

                        first_chunk_validated = True

                    if chunk_count % 10 == 0:  # Log every 10 chunks
                        print(f"[Transcription] Captured {chunk_count} audio chunks")

                    # Apply audio gain boost (amplify by 50x to compensate for low microphone volume)
                    audio_array = np.frombuffer(data, dtype=np.int16).copy()

                    # Amplify the audio signal
                    GAIN = 50.0  # Boost factor
                    audio_array = audio_array.astype(np.float32) * GAIN

                    # Clip to int16 range to prevent overflow
                    audio_array = np.clip(audio_array, -32768, 32767)

                    # Convert back to int16
                    audio_array = audio_array.astype(np.int16)

                    # Convert to bytes for Vosk
                    boosted_data = audio_array.tobytes()

                    # Log boosted audio stats every 50 chunks
                    if chunk_count % 50 == 0:
                        print(f"[Transcription] Boosted audio stats (chunk {chunk_count}):")
                        print(f"  - Original std: {np.frombuffer(data, dtype=np.int16).std():.2f}")
                        print(f"  - Boosted std: {audio_array.std():.2f}")
                        print(f"  - Boosted min/max: {audio_array.min()} / {audio_array.max()}")

                    # Vosk works with raw bytes (int16), not float32
                    self.audio_queue.put(boosted_data)
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
        """Continuously transcribe audio chunks using Vosk."""
        print("[Transcription] _transcribe_loop starting...")

        # Create a new recognizer for this session (model is already loaded globally)
        global vosk_model
        if vosk_model is None:
            print("[Transcription] Loading Vosk model (first time only)...")
            get_vosk_model()
            print("[Transcription] Vosk model loaded")

        # Create a new recognizer instance for this session
        recognizer = vosk.KaldiRecognizer(vosk_model, RATE)
        recognizer.SetWords(True)
        print("[Transcription] Created new recognizer for this session")

        accumulated_text = ""
        last_partial = ""

        print("[Transcription] Started transcription loop")
        print(f"[Transcription] is_recording = {self.is_recording}")
        print(f"[Transcription] audio_queue size = {self.audio_queue.qsize()}")

        audio_chunks_processed = 0
        first_transcription_chunk_validated = False

        # Give audio capture thread time to start filling the queue
        import time
        time.sleep(0.5)
        print(f"[Transcription] After 0.5s delay, queue size = {self.audio_queue.qsize()}")

        # Process audio chunks while recording OR while there are chunks in the queue
        while self.is_recording or not self.audio_queue.empty():
            try:
                # Get audio chunk (raw bytes)
                try:
                    # Use shorter timeout when stopping to process remaining chunks faster
                    timeout = 0.1 if self.is_recording else 0.05
                    audio_data = self.audio_queue.get(timeout=timeout)
                    audio_chunks_processed += 1

                    # Validate first chunk in transcription
                    if not first_transcription_chunk_validated:
                        print(f"[Transcription] First chunk validation in transcription loop:")
                        print(f"  - Received {len(audio_data)} bytes")
                        audio_array = np.frombuffer(audio_data, dtype=np.int16)
                        print(f"  - As int16 array: {len(audio_array)} samples")
                        print(f"  - Min/max: {audio_array.min()} / {audio_array.max()}")
                        print(f"  - Mean: {audio_array.mean():.2f}, Std: {audio_array.std():.2f}")

                        if audio_array.std() < 10:
                            print(f"  - WARNING: Audio signal appears silent!")

                        first_transcription_chunk_validated = True

                    if audio_chunks_processed % 10 == 0:
                        print(f"[Transcription] Processed {audio_chunks_processed} audio chunks from queue")
                except queue.Empty:
                    # Process partial results even if no new audio
                    if recognizer.AcceptWaveform(b''):
                        result = json.loads(recognizer.Result())
                        if result.get("text"):
                            transcribed_text = result["text"].strip()
                            print(f"[Transcription] Empty queue - got final text: '{transcribed_text}'")
                            if transcribed_text:
                                accumulated_text += " " + transcribed_text if accumulated_text else transcribed_text
                                accumulated_text = accumulated_text.strip()

                                if self.event_loop:
                                    asyncio.run_coroutine_threadsafe(
                                        self.websocket.send_json({
                                            "type": "transcription",
                                            "text": transcribed_text,
                                            "accumulated": accumulated_text
                                        }),
                                        self.event_loop
                                    )
                    continue

                # Process audio with Vosk
                if recognizer.AcceptWaveform(audio_data):
                    # Final result
                    result = json.loads(recognizer.Result())
                    transcribed_text = result.get("text", "").strip()

                    print(f"[Transcription] Vosk final result: '{transcribed_text}'")

                    if transcribed_text:
                        accumulated_text += " " + transcribed_text if accumulated_text else transcribed_text
                        accumulated_text = accumulated_text.strip()

                        print(f"[Transcription] Sending transcription update: '{transcribed_text}' (accumulated: '{accumulated_text}')")

                        # Send update via WebSocket
                        if self.event_loop:
                            asyncio.run_coroutine_threadsafe(
                                self.websocket.send_json({
                                    "type": "transcription",
                                    "text": transcribed_text,
                                    "accumulated": accumulated_text
                                }),
                                self.event_loop
                            )
                else:
                    # Partial result (interim)
                    partial_result = json.loads(recognizer.PartialResult())
                    partial_text = partial_result.get("partial", "").strip()

                    # Only send if partial text changed
                    if partial_text and partial_text != last_partial:
                        last_partial = partial_text
                        print(f"[Transcription] Vosk partial result: '{partial_text}'")

                        # Send partial update (optional - for live feedback)
                        if self.event_loop:
                            asyncio.run_coroutine_threadsafe(
                                self.websocket.send_json({
                                    "type": "partial",
                                    "text": partial_text,
                                    "accumulated": accumulated_text + " " + partial_text if accumulated_text else partial_text
                                }),
                                self.event_loop
                            )

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
        print(f"[Transcription] Final queue size: {self.audio_queue.qsize()}")

        # Get final result
        try:
            print("[Transcription] Getting final result from Vosk...")
            final_result = json.loads(recognizer.FinalResult())
            print(f"[Transcription] Final result: {final_result}")
            final_text = final_result.get("text", "").strip()
            if final_text:
                accumulated_text += " " + final_text if accumulated_text else final_text
                accumulated_text = accumulated_text.strip()
        except:
            pass
        
        # Send final transcription
        if accumulated_text and self.event_loop:
            asyncio.run_coroutine_threadsafe(
                self.websocket.send_json({
                    "type": "final",
                    "text": accumulated_text
                }),
                self.event_loop
            )

# Active transcription sessions
active_sessions: dict[str, TranscriptionSession] = {}

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """WebSocket endpoint for continuous transcription."""
    await websocket.accept()
    session_id = None
    event_loop = asyncio.get_event_loop()
    
    try:
        while True:
            data = await websocket.receive_json()
            
            if data["action"] == "start":
                session_id = data.get("session_id", f"session_{int(time.time())}")
                session = TranscriptionSession(websocket, event_loop)
                active_sessions[session_id] = session
                session.start_recording()
                await websocket.send_json({"type": "status", "status": "listening", "session_id": session_id})
                
            elif data["action"] == "stop":
                if session_id and session_id in active_sessions:
                    session = active_sessions[session_id]
                    session.stop_recording()
                    del active_sessions[session_id]
                    await websocket.send_json({"type": "status", "status": "stopped"})
                    
    except WebSocketDisconnect:
        if session_id and session_id in active_sessions:
            session = active_sessions[session_id]
            session.stop_recording()
            del active_sessions[session_id]
        print(f"[Transcription] WebSocket disconnected: {session_id}")

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
    """Preload Vosk model on application startup."""
    print("[Startup] Preloading Vosk model...")
    try:
        get_vosk_model()
        print("[Startup] Vosk model preloaded successfully")
    except Exception as e:
        print(f"[Startup] Warning: Failed to preload Vosk model: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
