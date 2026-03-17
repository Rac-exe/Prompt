"""
document_parser.py — In-memory file parsing for PDF and image attachments.

Security features:
- Magic-byte validation (defense-in-depth, doesn't trust Electron)
- 10 MB hard limit per file
- 8,000 token cap on extracted text
- Sanitization of potential prompt injection patterns
- Graceful error handling (never crashes the pipeline)
"""

from __future__ import annotations

import base64
import re
from typing import Union, List, Dict
from pathlib import Path

# PDF parsing
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False
    print("⚠️  PyMuPDF not installed. PDF parsing disabled.")

# Image processing
try:
    from PIL import Image
    import io
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False
    print("⚠️  Pillow not installed. Image fallback disabled.")


# ── Constants ─────────────────────────────────────────────────────────────────

MAX_FILE_SIZE = 10_000_000  # 10 MB
MAX_EXTRACTED_TOKENS = 8_000  # Prevent prompt injection via massive PDFs
CHARS_PER_TOKEN = 4  # Rough estimate for token counting

ALLOWED_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
}

# Magic bytes for file type validation
MAGIC_BYTES = {
    "application/pdf": [b"%PDF"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/webp": [b"RIFF", b"WEBP"],  # WEBP has RIFF header + WEBP marker
}


# ── Sanitization ──────────────────────────────────────────────────────────────

def sanitize_extracted_text(text: str) -> str:
    """
    Remove potential prompt injection patterns from extracted text.
    This is a defense-in-depth measure — the 8K token cap is the primary protection.
    """
    # Common injection patterns
    injection_patterns = [
        r'ignore\s+(all\s+)?previous\s+instructions',
        r'you\s+are\s+now\s+(in\s+)?admin',
        r'system\s*:\s*',
        r'<\|im_start\|>',  # ChatML injection
        r'<\|im_end\|>',
        r'<\|system\|>',
        r'###\s*instruction',
        r'disregard\s+(all\s+)?prior',
    ]
    
    for pattern in injection_patterns:
        text = re.sub(pattern, '[REDACTED]', text, flags=re.IGNORECASE)
    
    # Hard cap at token limit
    max_chars = MAX_EXTRACTED_TOKENS * CHARS_PER_TOKEN
    if len(text) > max_chars:
        text = text[:max_chars] + "\n\n[... content truncated at 8,000 token limit]"
    
    return text


# ── Validation ────────────────────────────────────────────────────────────────

def validate_file(name: str, mime_type: str, raw_bytes: bytes) -> bool:
    """
    Validate file using magic bytes (not file extension).
    Returns True if valid, False otherwise.
    """
    if mime_type not in ALLOWED_MIMES:
        print(f"❌  Invalid MIME type: {mime_type}")
        return False
    
    if len(raw_bytes) > MAX_FILE_SIZE:
        print(f"❌  File too large: {len(raw_bytes)} bytes (max {MAX_FILE_SIZE})")
        return False
    
    # Check magic bytes
    magic_signatures = MAGIC_BYTES.get(mime_type, [])
    if not magic_signatures:
        print(f"❌  No magic bytes defined for {mime_type}")
        return False
    
    # Special handling for WEBP (needs both RIFF and WEBP markers)
    if mime_type == "image/webp":
        has_riff = raw_bytes[:4] == b"RIFF"
        has_webp = b"WEBP" in raw_bytes[:16]
        if not (has_riff and has_webp):
            print(f"❌  Invalid WEBP magic bytes")
            return False
        return True
    
    # Standard magic byte check
    for signature in magic_signatures:
        if raw_bytes.startswith(signature):
            return True
    
    print(f"❌  Magic byte mismatch for {mime_type}")
    return False


# ── PDF Parsing ───────────────────────────────────────────────────────────────

def parse_pdf(raw_bytes: bytes) -> str:
    """
    Extract text from PDF using PyMuPDF (in-memory, no temp files).
    Returns sanitized plain text, truncated to token limit.
    """
    if not HAS_PYMUPDF:
        return "[PDF parsing unavailable: PyMuPDF not installed]"
    
    try:
        # Open PDF from memory
        doc = fitz.open(stream=raw_bytes, filetype="pdf")
        
        text_parts = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text_parts.append(page.get_text())
        
        doc.close()
        
        full_text = "\n\n".join(text_parts)
        return sanitize_extracted_text(full_text)
    
    except Exception as e:
        print(f"⚠️  PDF parsing failed: {e.__class__.__name__}: {e}")
        return "[PDF parsing failed: file may be corrupted or encrypted]"


# ── Image Processing ──────────────────────────────────────────────────────────

def parse_image_fallback(raw_bytes: bytes, mime_type: str) -> str:
    """
    Fallback for non-vision models: extract basic image metadata using Pillow.
    Returns a text description of the image.
    """
    if not HAS_PILLOW:
        return "[Image processing unavailable: Pillow not installed]"
    
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        
        # Extract metadata
        width, height = img.size
        mode = img.mode  # RGB, RGBA, L, etc.
        format_name = img.format or "unknown"
        
        description = f"[Image: {format_name}, {width}×{height}px, {mode} mode]"
        
        # Try to extract any embedded text (EXIF, etc.)
        if hasattr(img, '_getexif') and img._getexif():
            exif = img._getexif()
            if exif and 270 in exif:  # ImageDescription tag
                description += f"\nDescription: {exif[270]}"
        
        return description
    
    except Exception as e:
        print(f"⚠️  Image processing failed: {e.__class__.__name__}: {e}")
        return "[Image processing failed: file may be corrupted]"


def create_vision_message_part(raw_bytes: bytes, mime_type: str) -> Dict:
    """
    Create a vision-ready message part for multimodal models.
    Returns a dict in OpenAI vision format.
    """
    # Re-encode to base64 for vision API
    base64_image = base64.b64encode(raw_bytes).decode('utf-8')
    
    # Map MIME types to data URL format
    mime_map = {
        "image/png": "image/png",
        "image/jpeg": "image/jpeg",
        "image/webp": "image/webp",
    }
    
    data_url = f"data:{mime_map.get(mime_type, 'image/png')};base64,{base64_image}"
    
    return {
        "type": "image_url",
        "image_url": {
            "url": data_url,
            "detail": "high"  # Use high detail for better analysis
        }
    }


# ── Main Parser ───────────────────────────────────────────────────────────────

def parse_file(
    name: str,
    mime_type: str,
    base64_data: str,
    supports_vision: bool = False
) -> Union[str, Dict]:
    """
    Parse a file attachment and return either:
    - str: Extracted text (for PDFs or image fallback)
    - dict: Vision message part (for images with vision-capable models)
    
    Args:
        name: Original filename
        mime_type: MIME type (e.g., "application/pdf")
        base64_data: Base64-encoded file content
        supports_vision: Whether the target model supports vision API
    
    Returns:
        Extracted text or vision message part dict
    """
    try:
        # Decode base64
        raw_bytes = base64.b64decode(base64_data)
    except Exception as e:
        print(f"❌  Base64 decode failed for {name}: {e}")
        return f"[File {name}: decode error]"
    
    # Validate file
    if not validate_file(name, mime_type, raw_bytes):
        return f"[File {name}: validation failed]"
    
    # Route to appropriate parser
    if mime_type == "application/pdf":
        text = parse_pdf(raw_bytes)
        return f"[ATTACHED PDF: {name}]\n\n{text}\n\n[END OF PDF]"
    
    elif mime_type.startswith("image/"):
        if supports_vision:
            # Return vision message part for multimodal models
            return create_vision_message_part(raw_bytes, mime_type)
        else:
            # Fallback to text description
            description = parse_image_fallback(raw_bytes, mime_type)
            return f"[ATTACHED IMAGE: {name}]\n{description}"
    
    else:
        return f"[File {name}: unsupported type {mime_type}]"


# ── Batch Processing ──────────────────────────────────────────────────────────

def parse_files(
    files: List[Dict],
    supports_vision: bool = False
) -> tuple[str, List[Dict]]:
    """
    Parse multiple files and return (text_context, vision_parts).
    
    Args:
        files: List of {name, mimeType, base64} dicts
        supports_vision: Whether the model supports vision
    
    Returns:
        (text_context, vision_message_parts)
        - text_context: Combined text from all PDFs and non-vision images
        - vision_message_parts: List of vision API message parts for images
    """
    if not files:
        return "", []
    
    text_parts = []
    vision_parts = []
    
    for file_data in files:
        name = file_data.get("name", "unknown")
        mime_type = file_data.get("mimeType", "")
        base64_data = file_data.get("base64", "")
        
        result = parse_file(name, mime_type, base64_data, supports_vision)
        
        if isinstance(result, str):
            text_parts.append(result)
        elif isinstance(result, dict):
            vision_parts.append(result)
    
    # Combine all text parts
    text_context = "\n\n".join(text_parts) if text_parts else ""
    
    return text_context, vision_parts
