"""
cli.py — Interactive CLI for pipeline_v2.

Usage:
    # Single prompt
    python -m pipeline_v2.cli "write an email to my boss for leave" --provider megallm --model claude-sonnet-4-5-20250929

    # Interactive session (context persists across turns)
    python -m pipeline_v2.cli --interactive --provider megallm --model claude-sonnet-4-5-20250929

    # Stream output
    python -m pipeline_v2.cli "explain machine learning" --stream --provider megallm

    # Custom session ID
    python -m pipeline_v2.cli "write a blog post" --session my_session
"""

import argparse
import time
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / ".env")

from .context import load_chat_context, save_chat_context
from .optimizer import optimize
from .skills import list_available_skills


def run_once(user_input: str, session_id: str,
             model: str, provider: str, stream: bool, verbose: bool) -> str:
    """Run a single optimization and save chat context."""
    cc = load_chat_context(session_id)

    if verbose:
        print(f"\n  Session    : {session_id}")
        print(f"  CC msgs    : {len(cc.messages)}")

    start = time.time()
    result = optimize(user_input, cc, model=model, provider=provider, stream=stream)
    elapsed = time.time() - start

    # Save updated context
    cc.add("user", user_input)
    cc.add("assistant", result)
    save_chat_context(cc)

    return result


def run_interactive(session_id: str, model: str, provider: str, stream: bool, verbose: bool):
    """Interactive loop — keeps chat context across multiple turns."""
    print(f"\n🚀  pipeline_v2 interactive mode")
    print(f"    Session: {session_id}  |  Model: {model}  |  Provider: {provider}")
    print(f"    Type 'quit' or Ctrl+C to exit.\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n👋  Bye!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit", "q"):
            print("👋  Bye!")
            break

        run_once(user_input, session_id, model, provider, stream, verbose)


def main():
    parser = argparse.ArgumentParser(
        description="pipeline_v2 — Context-aware, skill-based prompt optimizer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("prompt", nargs="?", help="Prompt to optimize (omit for --interactive)")
    parser.add_argument("--model", "-m", default="gpt-4o-mini", help="LLM model (default: gpt-4o-mini)")
    parser.add_argument("--provider", "-p", default="auto", choices=["auto", "megallm"])
    parser.add_argument("--stream", "-s", action="store_true", help="Stream output token by token")
    parser.add_argument("--interactive", "-i", action="store_true", help="Multi-turn interactive mode")
    parser.add_argument("--session", default="test_session", help="Session ID (default: test_session)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show extra debug info")
    parser.add_argument("--skills", action="store_true", help="List available skill files and exit")

    args = parser.parse_args()

    if args.skills:
        skills = list_available_skills()
        print(f"Available skills ({len(skills)}): {', '.join(sorted(skills))}")
        return

    if args.interactive:
        run_interactive(args.session, args.model, args.provider, args.stream, args.verbose)
    elif args.prompt:
        run_once(args.prompt, args.session, args.model, args.provider, args.stream, args.verbose)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
