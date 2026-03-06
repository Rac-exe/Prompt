"""
context.py — ChatContext management.

Storage: local JSON files in pipeline_v2/storage/sessions/
Designed so load/save functions can be swapped for Supabase later.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import List

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")  # GPT-4 / Claude compatible
    def _count_tokens(text: str) -> int:
        return len(_enc.encode(text))
except Exception:
    # Fallback if tiktoken is unavailable
    def _count_tokens(text: str) -> int:  # type: ignore
        return len(text) // 4

# ── Storage root ──────────────────────────────────────────────────────────────
STORAGE_DIR = Path(__file__).parent / "storage"


# ─────────────────────────────────────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Message:
    """Single turn in conversation."""
    role: str      # "user" or "assistant"
    content: str
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class ChatContext:
    """Conversation history for a session."""
    session_id: str
    messages: List[Message] = field(default_factory=list)

    def compact_with_summary(self, summary_text: str, keep_recent: int = 4) -> None:
        """
        Replace old messages with a summary block, keep the most recent ones.
        This mutates the messages list in place — call save_chat_context() after
        to persist the compacted version to disk.

        Before: [msg1, msg2, ..., msg13, msg14, msg15]
        After:  [SUMMARY_BLOCK, msg14, msg15]
        """
        recent = self.messages[-keep_recent:] if len(self.messages) > keep_recent else self.messages
        summary_msg = Message(
            role="system",
            content=f"[CONVERSATION SUMMARY — {len(self.messages) - len(recent)} earlier messages compressed]\n{summary_text}",
        )
        self.messages = [summary_msg] + recent

    def to_text(self, max_messages: int = 10) -> str:
        """Format messages as plain text for LLM. Summary blocks are included as-is."""
        # Always include a summary block if present, then recent messages
        summary_msgs = [m for m in self.messages if m.role == "system" and m.content.startswith("[CONVERSATION SUMMARY")]
        regular_msgs = [m for m in self.messages if not (m.role == "system" and m.content.startswith("[CONVERSATION SUMMARY"))]
        recent_regular = regular_msgs[-(max_messages):]
        all_msgs = summary_msgs + recent_regular  # summary first, then recent

        if not all_msgs:
            return "(no previous conversation)"
        return "\n".join(
            f"{msg.role.upper()}: {msg.content}" for msg in all_msgs
        )

    def add(self, role: str, content: str):
        self.messages.append(Message(role=role, content=content))

    def token_estimate(self) -> int:
        """Exact token count using tiktoken (cl100k_base). Falls back to chars/4."""
        return sum(_count_tokens(m.content) for m in self.messages)


# ─────────────────────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────────────────────

def load_chat_context(session_id: str) -> ChatContext:
    """Load CC from local JSON. Returns empty CC for new sessions."""
    path = STORAGE_DIR / "sessions" / f"{session_id}.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        return ChatContext(
            session_id=session_id,
            messages=[Message(**m) for m in data.get("messages", [])],
        )
    return ChatContext(session_id=session_id)


def save_chat_context(cc: ChatContext) -> None:
    """Save CC to local JSON."""
    path = STORAGE_DIR / "sessions" / f"{cc.session_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"session_id": cc.session_id, "messages": [asdict(m) for m in cc.messages]}, indent=2),
        encoding="utf-8",
    )

