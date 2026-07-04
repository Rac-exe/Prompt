"""
test_api.py — Standalone test for API-based LLM prompt optimization.

Tests the same system prompts from main.py but via cloud LLM APIs (OpenAI,
Anthropic, Gemini, etc.) using litellm for a unified interface.

This file is completely isolated — it does NOT modify or affect the running app.

Setup:
    pip install litellm python-dotenv
    Add your API key(s) to .env:
        OPENAI_API_KEY=sk-...
        ANTHROPIC_API_KEY=sk-ant-...
        GEMINI_API_KEY=...

Usage:
    # Single-shot (default: gpt-4o-mini)
    python test_api.py "write an email to my boss for leave"

    # Pick a specific model
    python test_api.py "write code for a todo app" --model gpt-4o
    python test_api.py "write code for a todo app" --model claude-3-5-sonnet-20241022
    python test_api.py "write code for a todo app" --model gemini/gemini-1.5-pro

    # Streaming mode
    python test_api.py "write a poem about rain" --stream

    # Compare multiple models side by side
    python test_api.py "explain machine learning" --compare
"""

import argparse
import os
import sys
import time

from dotenv import load_dotenv

# ── Load .env from project root ───────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

try:
    import litellm
    litellm.set_verbose = False  # Suppress debug noise
except ImportError:
    print("❌  litellm not installed. Run: pip install litellm")
    sys.exit(1)

# ── Reuse existing system prompts from main.py ────────────────────────────────
# Import directly so there's zero duplication — if main.py changes, this picks
# up those changes automatically.
sys.path.insert(0, os.path.dirname(__file__))
from app.main import SYSTEM_PROMPT, detect_prompt_type, get_optimization_strategy, clean_optimized_text

# ── Models to compare ─────────────────────────────────────────────────────────
COMPARE_MODELS = [
    "gpt-4o-mini",
    "claude-3-5-haiku-20241022",
    "gemini/gemini-1.5-flash",
]

# ─────────────────────────────────────────────────────────────────────────────
# Core optimization function
# ─────────────────────────────────────────────────────────────────────────────

def get_litellm_kwargs(provider: str, model: str) -> tuple[str, dict]:
    """Return (resolved_model, extra_kwargs) for litellm based on provider."""
    if provider == "megallm":
        api_key = os.getenv("MEGALLM_API_KEY")
        api_base = os.getenv("MEGALLM_API_BASE", "https://ai.megallm.io/v1")
        if not api_key:
            print("❌  MEGALLM_API_KEY not set in .env")
            sys.exit(1)
        # Prefix with "openai/" so litellm skips model validation and sends
        # the request directly to api_base as an OpenAI-compatible call.
        resolved_model = f"openai/{model}" if not model.startswith("openai/") else model
        return resolved_model, {"api_key": api_key, "api_base": api_base}
    return model, {}  # litellm picks up standard env vars automatically


def optimize(prompt: str, model: str = "gpt-4o-mini", stream: bool = False, provider: str = "auto") -> str:
    """Run prompt optimization using a cloud LLM API via litellm."""

    prompt_type = detect_prompt_type(prompt)
    strategy = get_optimization_strategy(prompt_type)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Specific strategy for this {prompt_type} prompt:\n\n{strategy}"},
        {"role": "user",   "content": prompt},
    ]

    resolved_model, extra = get_litellm_kwargs(provider, model)

    print(f"\n{'─' * 60}")
    print(f"  Provider  : {provider}")
    print(f"  Model     : {model}")  # show original name, not the openai/ prefixed one
    print(f"  Type      : {prompt_type}")
    print(f"  Streaming : {stream}")
    if provider == "megallm":
        print(f"  API Base  : {os.getenv('MEGALLM_API_BASE', 'https://api.megallm.com/v1')}")
    print(f"{'─' * 60}\n")

    start = time.time()

    if stream:
        result = ""
        response = litellm.completion(
            model=resolved_model,
            messages=messages,
            max_tokens=800,
            temperature=0.7,
            stream=True,
            **extra,
        )
        print("Optimized prompt (streaming):\n")
        for chunk in response:
            token = chunk.choices[0].delta.content or ""
            print(token, end="", flush=True)
            result += token
        print()  # newline after stream ends
        elapsed = time.time() - start
        result = clean_optimized_text(result)
    else:
        response = litellm.completion(
            model=resolved_model,
            messages=messages,
            max_tokens=800,
            temperature=0.7,
            **extra,
        )
        elapsed = time.time() - start
        result = clean_optimized_text(response.choices[0].message.content)
        print("Optimized prompt:\n")
        print(result)

    # Stats
    print(f"\n{'─' * 60}")
    print(f"  Latency   : {elapsed * 1000:.0f}ms")
    print(f"  Input len : {len(prompt)} chars")
    print(f"  Output len: {len(result)} chars")
    print(f"  Ratio     : {len(result)/max(len(prompt),1):.1f}x")
    print(f"{'─' * 60}\n")

    return result


def compare(prompt: str, models: list[str] = COMPARE_MODELS, provider: str = "auto"):
    """Run the same prompt through multiple models and print results side by side."""
    results = {}
    for model in models:
        print(f"\n{'═' * 60}")
        print(f"  Testing: {model}")
        print(f"{'═' * 60}")
        try:
            results[model] = optimize(prompt, model=model, provider=provider)
        except Exception as e:
            print(f"  ❌ Error: {e}")
            results[model] = None

    print(f"\n{'═' * 60}")
    print("  COMPARISON SUMMARY")
    print(f"{'═' * 60}")
    for model, result in results.items():
        status = "✅" if result else "❌"
        length = len(result) if result else 0
        print(f"  {status}  {model:<45} {length} chars")
    print(f"{'═' * 60}\n")


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Test API-based LLM prompt optimization",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("prompt", help="The rough prompt to optimize")
    parser.add_argument(
        "--model", "-m",
        default="gpt-4o-mini",
        help="LLM model to use (default: gpt-4o-mini)",
    )
    parser.add_argument(
        "--stream", "-s",
        action="store_true",
        help="Stream the output token by token",
    )
    parser.add_argument(
        "--compare", "-c",
        action="store_true",
        help=f"Compare across models: {', '.join(COMPARE_MODELS)}",
    )
    parser.add_argument(
        "--provider", "-p",
        default="auto",
        choices=["auto", "megallm"],
        help="Provider to use: 'auto' uses standard env keys, 'megallm' uses MEGALLM_API_KEY + MEGALLM_API_BASE",
    )

    args = parser.parse_args()

    print(f"\n  Original prompt: \"{args.prompt}\"")

    if args.compare:
        compare(args.prompt, provider=args.provider)
    else:
        try:
            optimize(args.prompt, model=args.model, stream=args.stream, provider=args.provider)
        except litellm.AuthenticationError:
            print(f"\n❌  Authentication failed for model '{args.model}'.")
            print("    Check your API key in the .env file.")
            print("    Expected key names:")
            print("      OPENAI_API_KEY    → for gpt-* models")
            print("      ANTHROPIC_API_KEY → for claude-* models")
            print("      GEMINI_API_KEY    → for gemini/* models")
        except litellm.NotFoundError:
            print(f"\n❌  Model '{args.model}' not found or not accessible.")
            print("    Try: gpt-4o-mini, claude-3-5-haiku-20241022, gemini/gemini-1.5-flash")
        except Exception as e:
            print(f"\n❌  Error: {e}")


if __name__ == "__main__":
    main()
