"""
document_parser.py -- In-memory file parsing for PDF and image attachments.

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
from typing import Union, List, Dict, Tuple

# PDF parsing
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False
    print("[Files] WARNING: PyMuPDF not installed. PDF parsing disabled.")

# Image processing
try:
    from PIL import Image
    import io
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False
    print("[Files] WARNING: Pillow not installed. Image fallback disabled.")


# ── Constants ─────────────────────────────────────────────────────────────────

MAX_FILE_SIZE = 10_000_000  # 10 MB
MAX_EXTRACTED_TOKENS = 8_000  # Prevent prompt injection via massive PDFs
CHARS_PER_TOKEN = 4  # Rough estimate for token counting

ALLOWED_MIMES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
}

# Magic bytes for file type validation
MAGIC_BYTES = {
    "application/pdf": [b"%PDF"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/webp": [b"RIFF", b"WEBP"],  # WEBP has RIFF header + WEBP marker
    "image/gif": [b"GIF87a", b"GIF89a"],
}


# ── Sanitization ──────────────────────────────────────────────────────────────

def sanitize_extracted_text(text: str) -> str:
    """
    Remove potential prompt injection patterns from extracted text.
    This is a defense-in-depth measure -- the 8K token cap is the primary protection.
    """
    injection_patterns = [
        r'ignore\s+(all\s+)?previous\s+instructions',
        r'you\s+are\s+now\s+(in\s+)?admin',
        r'system\s*:\s*',
        r'<\|im_start\|>',
        r'<\|im_end\|>',
        r'<\|system\|>',
        r'###\s*instruction',
        r'disregard\s+(all\s+)?prior',
    ]

    for pattern in injection_patterns:
        text = re.sub(pattern, '[REDACTED]', text, flags=re.IGNORECASE)

    max_chars = MAX_EXTRACTED_TOKENS * CHARS_PER_TOKEN
    if len(text) > max_chars:
        text = text[:max_chars] + "\n\n[... content truncated at 8,000 token limit]"

    return text


# ── Validation ────────────────────────────────────────────────────────────────

def validate_file(name: str, mime_type: str, raw_bytes: bytes) -> Tuple[bool, str]:
    """
    Validate file using magic bytes (not file extension).
    Returns (is_valid, error_message). error_message is '' when valid.
    """
    if mime_type not in ALLOWED_MIMES:
        msg = f"Unsupported file type '{mime_type}' for '{name}' -- only PDF and images are supported"
        print(f"[Files] ERROR: {msg}")
        return False, msg

    if len(raw_bytes) > MAX_FILE_SIZE:
        msg = f"'{name}' exceeds the 10 MB file size limit ({len(raw_bytes) // 1_000_000} MB)"
        print(f"[Files] ERROR: {msg}")
        return False, msg

    if len(raw_bytes) == 0:
        msg = f"'{name}' appears to be empty (0 bytes)"
        print(f"[Files] ERROR: {msg}")
        return False, msg

    magic_signatures = MAGIC_BYTES.get(mime_type, [])
    if not magic_signatures:
        msg = f"No magic-byte rule defined for {mime_type}"
        print(f"[Files] ERROR: {msg}")
        return False, msg

    # Special handling for WEBP (needs both RIFF and WEBP markers)
    if mime_type == "image/webp":
        has_riff = raw_bytes[:4] == b"RIFF"
        has_webp = b"WEBP" in raw_bytes[:16]
        if not (has_riff and has_webp):
            msg = f"'{name}' does not appear to be a valid WEBP image (magic bytes mismatch)"
            print(f"[Files] ERROR: {msg}")
            return False, msg
        return True, ""

    # Standard magic byte check
    for signature in magic_signatures:
        if raw_bytes[:len(signature)] == signature:
            return True, ""

    msg = f"'{name}' does not match the expected format for {mime_type} (magic bytes mismatch)"
    print(f"[Files] ERROR: {msg}")
    return False, msg


# ── PDF Parsing ───────────────────────────────────────────────────────────────

def parse_pdf(raw_bytes: bytes, name: str = "document.pdf") -> Tuple[bool, str]:
    """
    Extract text from PDF using PyMuPDF (in-memory, no temp files).
    Returns (success, text_or_error_message).
    """
    if not HAS_PYMUPDF:
        return False, "PDF parsing unavailable: PyMuPDF not installed. Run: pip install PyMuPDF"

    try:
        doc = fitz.open(stream=raw_bytes, filetype="pdf")

        text_parts = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            page_text = page.get_text()
            if page_text.strip():
                text_parts.append(page_text)

        doc.close()

        if not text_parts:
            return False, f"'{name}' appears to be a scanned or image-based PDF with no extractable text."

        full_text = "\n\n".join(text_parts)
        extracted = sanitize_extracted_text(full_text)
        print(f"[Files] PDF '{name}': extracted {len(extracted)} chars from {len(text_parts)} pages")
        return True, extracted

    except Exception as e:
        print(f"[Files] PDF parsing failed for '{name}': {e.__class__.__name__}: {e}")
        return False, f"Failed to read '{name}': the file may be corrupted or password-protected"


# ── Image Processing ──────────────────────────────────────────────────────────

def parse_image_fallback(raw_bytes: bytes, mime_type: str, name: str = "image") -> Tuple[bool, str]:
    """
    Fallback for non-vision models: extract basic image metadata using Pillow.
    Returns (success, description_text).
    """
    if not HAS_PILLOW:
        return False, f"Image processing unavailable for '{name}': Pillow not installed."

    try:
        img = Image.open(io.BytesIO(raw_bytes))

        width, height = img.size
        mode = img.mode
        format_name = img.format or mime_type.split('/')[-1].upper()

        description = f"{format_name} image, {width}x{height} pixels"
        if mode in ("RGBA", "LA"):
            description += ", with transparency"

        try:
            if hasattr(img, '_getexif') and callable(img._getexif):
                exif = img._getexif()
                if exif and 270 in exif:
                    description += f"\nImage description: {exif[270]}"
        except Exception:
            pass

        print(f"[Files] Image '{name}': {description}")
        return True, description

    except Exception as e:
        print(f"[Files] Image processing failed for '{name}': {e.__class__.__name__}: {e}")
        return False, f"Could not read image '{name}': the file may be corrupted"


def create_vision_message_part(raw_bytes: bytes, mime_type: str) -> Dict:
    """
    Create a vision-ready message part for multimodal models.
    Returns a dict in OpenAI vision format.
    """
    base64_image = base64.b64encode(raw_bytes).decode('utf-8')

    # Normalise GIF to PNG for vision APIs that don't support GIF directly
    vision_mime = mime_type if mime_type in ("image/png", "image/jpeg", "image/webp") else "image/png"
    if mime_type == "image/gif" and HAS_PILLOW:
        try:
            img = Image.open(io.BytesIO(raw_bytes))
            buf = io.BytesIO()
            img.convert("RGB").save(buf, format="PNG")
            raw_bytes = buf.getvalue()
            base64_image = base64.b64encode(raw_bytes).decode('utf-8')
            vision_mime = "image/png"
        except Exception:
            pass  # fall through with original bytes

    data_url = f"data:{vision_mime};base64,{base64_image}"

    return {
        "type": "image_url",
        "image_url": {
            "url": data_url,
            "detail": "high"
        }
    }


# ── Main Parser ───────────────────────────────────────────────────────────────

def parse_file(
    name: str,
    mime_type: str,
    base64_data: str,
    supports_vision: bool = False
) -> Tuple[bool, Union[str, Dict]]:
    """
    Parse a file attachment.

    Returns:
        (success, result)
        - success=True,  result=str  -- extracted text (PDF or image fallback)
        - success=True,  result=dict -- vision message part (image + vision model)
        - success=False, result=str  -- human-readable error message (NOT injected into LLM)
    """
    print(f"[Files] Processing: '{name}' ({mime_type}, {len(base64_data)} base64 chars)")

    # Decode base64
    try:
        raw_bytes = base64.b64decode(base64_data)
    except Exception as e:
        msg = f"Could not decode '{name}': invalid base64 data"
        print(f"[Files] ERROR: {msg}: {e}")
        return False, msg

    print(f"[Files]   decoded {len(raw_bytes):,} bytes")

    # Validate
    is_valid, err = validate_file(name, mime_type, raw_bytes)
    if not is_valid:
        return False, err

    # Route to appropriate parser
    if mime_type == "application/pdf":
        success, result = parse_pdf(raw_bytes, name)
        if success:
            return True, f"[ATTACHED PDF: {name}]\n\n{result}\n\n[END OF PDF]"
        return False, result

    elif mime_type.startswith("image/"):
        if supports_vision:
            print(f"[Files]   vision model: passing image directly")
            return True, create_vision_message_part(raw_bytes, mime_type)
        else:
            success, description = parse_image_fallback(raw_bytes, mime_type, name)
            if success:
                return True, f"[ATTACHED IMAGE: {name}]\n{description}"
            return False, description

    else:
        return False, f"Unsupported file type: {mime_type}"


# ── Batch Processing ──────────────────────────────────────────────────────────

def parse_files(
    files: List[Dict],
    supports_vision: bool = False
) -> Tuple[str, List[Dict]]:
    """
    Parse multiple files and return (text_context, vision_parts).

    Files that fail processing are logged but NOT injected into the LLM context --
    they are skipped silently so the optimization still succeeds.

    Args:
        files: List of {name, mimeType, base64} dicts
        supports_vision: Whether the model supports vision

    Returns:
        (text_context, vision_message_parts)
    """
    if not files:
        return "", []

    print(f"[Files] parse_files: processing {len(files)} file(s), vision={supports_vision}")

    text_parts = []
    vision_parts = []

    for file_data in files:
        name = file_data.get("name", "unknown")
        mime_type = file_data.get("mimeType", "")
        base64_data = file_data.get("base64", "")

        if not base64_data:
            print(f"[Files] Skipping '{name}': no base64 data received")
            continue

        success, result = parse_file(name, mime_type, base64_data, supports_vision)

        if success:
            if isinstance(result, str):
                text_parts.append(result)
                print(f"[Files]   OK '{name}' -> {len(result)} chars of text context")
            elif isinstance(result, dict):
                vision_parts.append(result)
                print(f"[Files]   OK '{name}' -> vision message part")
        else:
            # Log but do NOT inject the error string into the LLM prompt
            print(f"[Files]   SKIP '{name}': {result}")

    text_context = "\n\n".join(text_parts) if text_parts else ""
    print(f"[Files] done: text={len(text_context)} chars, vision_parts={len(vision_parts)}")

    return text_context, vision_parts
