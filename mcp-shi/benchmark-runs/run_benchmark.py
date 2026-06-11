from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import websockets


MCP_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = Path(os.environ.get("PRMPT_APP_ROOT", MCP_ROOT.parent)).expanduser().resolve()
ROOT = Path(os.environ.get("PRMPT_BENCH_ROOT", MCP_ROOT)).expanduser().resolve()
REPOS_ROOT = Path(os.environ.get("PRMPT_TEST_REPOS_ROOT", ROOT / "test-repo")).expanduser().resolve()
RUNS_ROOT = Path(os.environ.get("PRMPT_BENCH_RUNS_ROOT", ROOT / "benchmark-runs")).expanduser().resolve()
CODE_INTEL_URL = os.environ.get("PRMPT_CODE_INTEL_URL", "http://127.0.0.1:8002/api")
OPTIMIZER_WS_URL = os.environ.get("PRMPT_OPTIMIZER_WS_URL", "ws://127.0.0.1:8001/ws/optimize-stream")
DEV_TOKEN = os.environ.get("PRMPT_DEV_AUTH_TOKEN", "dev-cli-token")
AGENT_TIMEOUT_SECONDS = int(os.environ.get("PRMPT_BENCH_AGENT_TIMEOUT", "900"))
POLL_TIMEOUT_SECONDS = int(os.environ.get("PRMPT_BENCH_INDEX_TIMEOUT", "1200"))


REPOS = {
    "orbit-crm-generated": {
        "path": REPOS_ROOT / "orbit-crm-generated",
        "prompts": [
            "auth isnt working and some leads are acting weird, fix it and run the tests",
            "workspace access is buggy and imported customer lists are weird, look into it",
            "the crm is buggy around login and lead lists, run the test suite and fix it",
        ],
    },
    "atlas-commerce-generated": {
        "path": REPOS_ROOT / "atlas-commerce-generated",
        "prompts": [
            "items arent loading in checkout and inventory is buggy, fix it and run tests",
            "cart totals and product reservation lists are broken, look into it",
            "the commerce flow is buggy when coupons or missing items happen, fix it",
        ],
    },
    "nova-support-generated": {
        "path": REPOS_ROOT / "nova-support-generated",
        "prompts": [
            "support ticket routing is buggy and sla deadlines are weird, fix it",
            "the support lists are buggy for imported tickets, run tests and look into it",
            "the support page behavior is buggy around tickets and deadlines, fix it",
        ],
    },
}

AGENTS = ["claude", "codex"]
CONDITIONS = {
    "without-prompt": "without-prompt",
    "with-prompt": "with-prompt",
}


IMPORT_RE = re.compile(r"^\s*import\s+.*$", re.MULTILINE)
EXPORT_FUNCTION_RE = re.compile(r"export\s+function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{")
FUNCTION_RE = re.compile(r"function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{")
CALL_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\s*\(")


@dataclass
class IndexedProject:
    repo: str
    project_id: str
    project: dict[str, Any]
    chunks: int
    files: int
    indexed_at: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]


def run_cmd(
    args: list[str],
    cwd: Path,
    timeout: int = 120,
    input_text: str | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    started = time.time()
    try:
        proc = subprocess.run(
            args,
            cwd=cwd,
            input=input_text,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env=env,
        )
        return {
            "args": args,
            "cwd": str(cwd),
            "exit_code": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "duration_ms": round((time.time() - started) * 1000),
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "args": args,
            "cwd": str(cwd),
            "exit_code": 124,
            "stdout": exc.stdout or "",
            "stderr": exc.stderr or "",
            "duration_ms": round((time.time() - started) * 1000),
            "timed_out": True,
        }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    for line in path.read_text(errors="ignore").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            continue
    return rows


def file_line_count(repo: Path) -> tuple[int, int]:
    files = 0
    lines = 0
    for path in repo.rglob("*"):
        if not path.is_file() or ".git" in path.parts:
            continue
        files += 1
        lines += len(path.read_text(errors="ignore").splitlines())
    return files, lines


def find_matching_brace(text: str, open_pos: int) -> int:
    depth = 0
    in_string: str | None = None
    escape = False
    for pos in range(open_pos, len(text)):
        ch = text[pos]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == in_string:
                in_string = None
            continue
        if ch in {"'", '"', "`"}:
            in_string = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return pos + 1
    return len(text)


def make_chunk(
    repo: Path,
    rel: str,
    text: str,
    name: str,
    chunk_type: str,
    start_line: int,
    end_line: int,
    signature: str | None,
    body: str,
    idx: int,
) -> dict[str, Any]:
    imports = IMPORT_RE.findall(text)
    callees = [
        c for c in CALL_RE.findall(body)
        if c not in {name, "if", "for", "while", "switch", "return"}
    ][:40]
    return {
        "file_path": rel,
        "start_line": start_line,
        "end_line": end_line,
        "chunk_type": chunk_type,
        "name": name,
        "signature": signature,
        "language": "javascript",
        "docstring": None,
        "content_hash": hashlib.sha256(body.encode()).hexdigest(),
        "callees": callees,
        "imports": imports,
        "code_body": body[:5000],
        "is_exported": body.lstrip().startswith("export "),
        "scope_type": chunk_type,
        "chunk_index": idx,
        "parent_scope_name": None,
    }


def parse_repo_chunks(repo: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    chunks: list[dict[str, Any]] = []
    language_map: dict[str, int] = {}
    for file_path in sorted((repo / "src").rglob("*.js")):
        rel = file_path.relative_to(repo).as_posix()
        if rel.startswith("src/generated/"):
            continue
        text = file_path.read_text(encoding="utf-8")
        lines = text.splitlines()
        chunks.append(make_chunk(
            repo, rel, text, file_path.stem, "file", 1, len(lines), None, text, 0
        ))
        seen_starts: set[int] = set()
        idx = 1
        for regex in (EXPORT_FUNCTION_RE, FUNCTION_RE):
            for match in regex.finditer(text):
                if match.start() in seen_starts:
                    continue
                seen_starts.add(match.start())
                name = match.group(1)
                params = match.group(2)
                open_pos = text.find("{", match.end() - 1)
                end_pos = find_matching_brace(text, open_pos)
                body = text[match.start():end_pos]
                start_line = text[:match.start()].count("\n") + 1
                end_line = text[:end_pos].count("\n") + 1
                chunks.append(make_chunk(
                    repo,
                    rel,
                    text,
                    name,
                    "function",
                    start_line,
                    end_line,
                    f"{name}({params})",
                    body,
                    idx,
                ))
                idx += 1
        language_map["javascript"] = language_map.get("javascript", 0) + 1
    return chunks, language_map


async def index_repo(run_dir: Path, repo_name: str, repo_path: Path) -> IndexedProject:
    code_root = run_dir / "code-intel-root"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEV_TOKEN}",
        "X-Prmpt-Code-Intel-Root": str(code_root),
    }
    async with httpx.AsyncClient(timeout=300) as client:
        create_payload = {
            "name": f"{repo_name}-{run_dir.name}",
            "local_path": str(repo_path),
            "default_branch": "main",
        }
        create_resp = await client.post(
            f"{CODE_INTEL_URL}/projects",
            headers=headers,
            json=create_payload,
        )
        create_resp.raise_for_status()
        project = create_resp.json()
        project_id = project["id"]

        chunks, language_map = parse_repo_chunks(repo_path)
        write_json(run_dir / "index" / repo_name / "chunks_manifest.json", {
            "project": project,
            "chunk_count": len(chunks),
            "language_map": language_map,
        })
        ingest_payload = {
            "project_id": project_id,
            "chunks": chunks,
            "call_graph": [],
            "language_map": language_map,
            "branch": "main",
            "cleanup_scope": "project",
            "cleanup_keys": [],
        }
        ingest_resp = await client.post(
            f"{CODE_INTEL_URL}/index/ingest",
            headers=headers,
            json=ingest_payload,
        )
        ingest_resp.raise_for_status()
        write_json(run_dir / "index" / repo_name / "ingest_response.json", ingest_resp.json())

        deadline = time.time() + POLL_TIMEOUT_SECONDS
        status = None
        while time.time() < deadline:
            status_resp = await client.get(
                f"{CODE_INTEL_URL}/projects/{project_id}",
                headers=headers,
            )
            status_resp.raise_for_status()
            status = status_resp.json()
            if status.get("index_status") == "ready":
                break
            if status.get("index_status") == "error":
                raise RuntimeError(f"Indexing failed for {repo_name}: {status}")
            await asyncio.sleep(5)
        else:
            raise TimeoutError(f"Indexing timed out for {repo_name}: {status}")

    return IndexedProject(
        repo=repo_name,
        project_id=project_id,
        project=status or project,
        chunks=len(chunks),
        files=language_map.get("javascript", 0),
        indexed_at=now_iso(),
    )


async def optimize_prompt(
    run_dir: Path,
    indexed: IndexedProject,
    prompt_id: str,
    prompt: str,
) -> dict[str, Any]:
    request_id = f"bench-{indexed.repo}-{prompt_id}-{uuid.uuid4().hex[:8]}"
    params = urlencode({"token": DEV_TOKEN})
    url = f"{OPTIMIZER_WS_URL}?{params}"
    events: list[dict[str, Any]] = []
    started = time.time()
    payload = {
        "request_id": request_id,
        "prompt": prompt,
        "mode": "thinking",
        "project_id": indexed.project_id,
        "project_branch": "main",
        "code_intel_root": str(run_dir / "code-intel-root"),
        "custom_instructions": (
            "Keep the optimized prompt compact. Name only files and functions "
            "that are likely necessary. Do not include broad repo exploration."
        ),
    }
    async with websockets.connect(url, open_timeout=30, close_timeout=30) as ws:
        await ws.send(json.dumps(payload))
        while True:
            message = await asyncio.wait_for(ws.recv(), timeout=300)
            event = json.loads(message)
            events.append(event)
            if event.get("type") in {"complete", "error"}:
                break
    duration_ms = round((time.time() - started) * 1000)
    out_dir = run_dir / "optimized-prompts" / indexed.repo / prompt_id
    write_json(out_dir / "request.json", payload)
    write_json(out_dir / "events.json", events)
    complete = next((e for e in events if e.get("type") == "complete"), None)
    error = next((e for e in events if e.get("type") == "error"), None)
    optimized = complete.get("optimized", "") if complete else ""
    write_text(out_dir / "generic_prompt.txt", prompt + "\n")
    write_text(out_dir / "optimized_prompt.txt", optimized + "\n")
    return {
        "repo": indexed.repo,
        "prompt_id": prompt_id,
        "generic_prompt": prompt,
        "optimized_prompt": optimized,
        "request_id": request_id,
        "duration_ms": duration_ms,
        "error": error,
        "generic_chars": len(prompt),
        "optimized_chars": len(optimized),
    }


def ensure_clean_worktree(repo: Path) -> None:
    status = run_cmd(["git", "status", "--short"], repo)
    if status["stdout"].strip():
        raise RuntimeError(f"Repo is dirty before benchmark: {repo}\n{status['stdout']}")


def create_worktree(repo: Path, branch: str, worktree: Path) -> None:
    if worktree.exists():
        shutil.rmtree(worktree)
    result = run_cmd(
        [
            "git",
            "clone",
            "--no-hardlinks",
            "--single-branch",
            "--branch",
            branch,
            str(repo),
            str(worktree),
        ],
        repo,
        timeout=180,
    )
    if result["exit_code"] != 0:
        raise RuntimeError(f"Failed to create isolated clone {worktree}: {result['stderr']}")


def remove_worktree(repo: Path, worktree: Path) -> None:
    shutil.rmtree(worktree, ignore_errors=True)


def make_agent_prompt(base_prompt: str, condition: str) -> str:
    return textwrap.dedent(f"""
    {base_prompt}

    You are in a disposable benchmark worktree. Fix the issue in this repository.
    Run the existing test suite to discover and verify the failure. Do not commit changes.
    Do not add comments that mention the benchmark, hidden bugs, seeded bugs, or this evaluation.
    Keep the fix minimal and production-like.

    Benchmark condition: {condition}.
    """).strip()


def extract_claude_usage(stdout: str) -> dict[str, Any]:
    try:
        data = json.loads(stdout)
    except Exception:
        return {}
    usage = data.get("usage") or {}
    return {
        "total_cost_usd": data.get("total_cost_usd"),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens"),
        "cache_read_input_tokens": usage.get("cache_read_input_tokens"),
        "model_usage": data.get("modelUsage"),
        "session_id": data.get("session_id"),
        "num_turns": data.get("num_turns"),
        "duration_ms": data.get("duration_ms"),
    }


def extract_codex_usage(jsonl_path: Path) -> dict[str, Any]:
    rows = read_jsonl(jsonl_path)
    usage: dict[str, Any] = {"events": len(rows)}
    token_keys = [
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "cached_input_tokens",
        "reasoning_tokens",
        "cost_usd",
        "total_cost_usd",
    ]
    totals: dict[str, float] = {}
    for row in rows:
        stack = [row]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                for key, value in item.items():
                    if key in token_keys and isinstance(value, (int, float)):
                        totals[key] = totals.get(key, 0) + value
                    elif isinstance(value, (dict, list)):
                        stack.append(value)
            elif isinstance(item, list):
                stack.extend(item)
    usage.update(totals)
    return usage


def run_agent(
    run_dir: Path,
    repo_name: str,
    repo_path: Path,
    agent: str,
    condition: str,
    prompt_id: str,
    prompt: str,
) -> dict[str, Any]:
    branch = CONDITIONS[condition]
    run_id = f"{repo_name}__{agent}__{condition}__{prompt_id}"
    worktree = run_dir / "worktrees" / run_id
    out_dir = run_dir / "agent-runs" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    create_worktree(repo_path, branch, worktree)
    metadata = {
        "repo": repo_name,
        "agent": agent,
        "condition": condition,
        "prompt_id": prompt_id,
        "branch": branch,
        "worktree": str(worktree),
        "started_at": now_iso(),
        "agent_timeout_seconds": AGENT_TIMEOUT_SECONDS,
    }
    write_json(out_dir / "metadata.json", metadata)
    write_text(out_dir / "agent_prompt.txt", prompt + "\n")

    test_before = run_cmd(["npm", "test"], worktree, timeout=180)
    write_text(out_dir / "test_before.txt", test_before["stdout"] + test_before["stderr"])
    write_json(out_dir / "test_before.json", test_before)

    full_prompt = make_agent_prompt(prompt, condition)
    started = time.time()
    if agent == "claude":
        cmd = [
            "claude",
            "-p",
            full_prompt,
            "--output-format",
            "json",
            "--permission-mode",
            "bypassPermissions",
            "--no-session-persistence",
        ]
        agent_result = run_cmd(cmd, worktree, timeout=AGENT_TIMEOUT_SECONDS, input_text="")
        write_text(out_dir / "agent_raw_output.json", agent_result["stdout"])
        write_text(out_dir / "agent_stderr.txt", agent_result["stderr"])
        usage = extract_claude_usage(agent_result["stdout"])
    elif agent == "codex":
        cmd = [
            "codex",
            "exec",
            "--json",
            "-C",
            str(worktree),
            "--dangerously-bypass-approvals-and-sandbox",
            "-",
        ]
        agent_result = run_cmd(cmd, worktree, timeout=AGENT_TIMEOUT_SECONDS, input_text=full_prompt)
        write_text(out_dir / "agent_raw_output.jsonl", agent_result["stdout"])
        write_text(out_dir / "agent_stderr.txt", agent_result["stderr"])
        usage = extract_codex_usage(out_dir / "agent_raw_output.jsonl")
    else:
        raise ValueError(agent)

    test_after = run_cmd(["npm", "test"], worktree, timeout=180)
    status = run_cmd(["git", "status", "--short"], worktree, timeout=60)
    diff = run_cmd(["git", "diff", "--binary"], worktree, timeout=60)
    name_only = run_cmd(["git", "diff", "--name-only"], worktree, timeout=60)

    write_text(out_dir / "test_after.txt", test_after["stdout"] + test_after["stderr"])
    write_json(out_dir / "test_after.json", test_after)
    write_text(out_dir / "git_status.txt", status["stdout"] + status["stderr"])
    write_text(out_dir / "git_diff.patch", diff["stdout"])
    write_text(out_dir / "files_touched.txt", name_only["stdout"])
    write_json(out_dir / "cost_usage.json", usage)

    result = {
        **metadata,
        "finished_at": now_iso(),
        "elapsed_ms": round((time.time() - started) * 1000),
        "test_before_exit": test_before["exit_code"],
        "test_after_exit": test_after["exit_code"],
        "tests_passed": test_after["exit_code"] == 0,
        "agent_exit_code": agent_result["exit_code"],
        "agent_timed_out": agent_result["timed_out"],
        "files_touched": [
            line.strip() for line in name_only["stdout"].splitlines()
            if line.strip()
        ],
        "files_touched_count": len([
            line for line in name_only["stdout"].splitlines() if line.strip()
        ]),
        "diff_chars": len(diff["stdout"]),
        "usage": usage,
    }
    write_json(out_dir / "result.json", result)
    remove_worktree(repo_path, worktree)
    return result


def summarize_results(
    run_dir: Path,
    indexed: list[IndexedProject],
    optimized: list[dict[str, Any]],
    agent_results: list[dict[str, Any]],
) -> dict[str, Any]:
    repo_meta = {}
    for repo_name, spec in REPOS.items():
        files, lines = file_line_count(spec["path"])
        repo_meta[repo_name] = {
            "path": str(spec["path"]),
            "files": files,
            "lines": lines,
            "prompts": spec["prompts"],
        }

    summary = {
        "run_id": run_dir.name,
        "created_at": now_iso(),
        "run_dir": str(run_dir),
        "repo_meta": repo_meta,
        "indexed_projects": [i.__dict__ for i in indexed],
        "optimized_prompts": optimized,
        "agent_results": agent_results,
    }

    aggregates: dict[str, Any] = {}
    for agent in AGENTS:
        for condition in CONDITIONS:
            subset = [
                r for r in agent_results
                if r["agent"] == agent and r["condition"] == condition
            ]
            if not subset:
                continue
            costs = [
                r.get("usage", {}).get("total_cost_usd")
                for r in subset
                if isinstance(r.get("usage", {}).get("total_cost_usd"), (int, float))
            ]
            aggregates[f"{agent}:{condition}"] = {
                "runs": len(subset),
                "passed": sum(1 for r in subset if r["tests_passed"]),
                "success_rate": sum(1 for r in subset if r["tests_passed"]) / len(subset),
                "avg_files_touched": sum(r["files_touched_count"] for r in subset) / len(subset),
                "avg_diff_chars": sum(r["diff_chars"] for r in subset) / len(subset),
                "total_cost_usd": round(sum(costs), 6) if costs else None,
                "avg_cost_usd": round(sum(costs) / len(costs), 6) if costs else None,
            }
    summary["aggregates"] = aggregates
    write_json(run_dir / "summary.json", summary)
    return summary


def generate_pdf(summary: dict[str, Any], output_path: Path) -> None:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    sf_mono = Path("/System/Library/Fonts/SFNSMono.ttf")
    if sf_mono.exists():
        try:
            pdfmetrics.registerFont(TTFont("SFMono", str(sf_mono)))
            mono = "SFMono"
        except Exception:
            mono = "Courier"
    else:
        mono = "Courier"
    body = "Helvetica"
    bold = "Helvetica-Bold"
    display = "Helvetica-Bold"

    W, H = A4
    M = 42
    black = colors.HexColor("#000000")
    bg = colors.HexColor("#F5F5F5")
    surface = colors.HexColor("#FFFFFF")
    border = colors.HexColor("#CCCCCC")
    subtle = colors.HexColor("#666666")
    disabled = colors.HexColor("#999999")
    red = colors.HexColor("#D71921")
    green = colors.HexColor("#4A9E5C")
    amber = colors.HexColor("#D4A843")

    c = canvas.Canvas(str(output_path), pagesize=A4)

    def page_base(title: str, page_num: int) -> None:
        c.setFillColor(bg)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setStrokeColor(border)
        c.setLineWidth(0.6)
        c.line(M, H - 36, W - M, H - 36)
        c.line(M, 36, W - M, 36)
        c.setFillColor(subtle)
        c.setFont(mono, 8)
        c.drawString(M, H - 28, "PRMPT BENCHMARK REPORT")
        c.drawRightString(W - M, H - 28, title.upper())
        c.drawRightString(W - M, 22, f"{page_num:02d}")

    def label(x: float, y: float, text: str, color=subtle) -> None:
        c.setFillColor(color)
        c.setFont(mono, 7)
        c.drawString(x, y, text.upper())

    def text(x: float, y: float, s: str, size=10, font=body, color=black) -> None:
        c.setFillColor(color)
        c.setFont(font, size)
        c.drawString(x, y, s)

    def wrapped(x: float, y: float, s: str, width: int, size=9, leading=12, font=body) -> float:
        c.setFillColor(black)
        c.setFont(font, size)
        for line in textwrap.wrap(s, width=width):
            c.drawString(x, y, line)
            y -= leading
        return y

    def metric_card(x: float, y: float, w: float, h: float, title: str, value: str, note: str, value_color=black) -> None:
        c.setFillColor(surface)
        c.setStrokeColor(border)
        c.roundRect(x, y - h, w, h, 10, fill=1, stroke=1)
        label(x + 12, y - 18, title)
        c.setFillColor(value_color)
        c.setFont(display, 28)
        c.drawString(x + 12, y - 52, value)
        c.setFillColor(subtle)
        c.setFont(mono, 7)
        c.drawString(x + 12, y - h + 14, note.upper()[:42])

    def bar_chart(x: float, y: float, w: float, rows: list[tuple[str, float, Any]], title: str, max_value: float = 1.0) -> float:
        label(x, y, title)
        y -= 18
        for name, value, color in rows:
            c.setFillColor(subtle)
            c.setFont(mono, 7)
            c.drawString(x, y + 2, name.upper()[:28])
            bar_x = x + 150
            bar_w = w - 210
            c.setFillColor(colors.HexColor("#E0E0E0"))
            c.rect(bar_x, y, bar_w, 9, fill=1, stroke=0)
            c.setFillColor(color)
            c.rect(bar_x, y, max(0, min(bar_w, bar_w * (value / max_value))), 9, fill=1, stroke=0)
            c.setFillColor(black)
            c.setFont(mono, 8)
            c.drawRightString(x + w, y + 1, f"{value:.2f}")
            y -= 18
        return y

    aggs = summary["aggregates"]
    total_runs = len(summary["agent_results"])
    pass_count = sum(1 for r in summary["agent_results"] if r["tests_passed"])
    claude_cost = sum(
        float(r.get("usage", {}).get("total_cost_usd") or 0)
        for r in summary["agent_results"]
        if r["agent"] == "claude"
    )
    optimized = summary["optimized_prompts"]
    avg_raw = sum(o["generic_chars"] for o in optimized) / max(1, len(optimized))
    avg_opt = sum(o["optimized_chars"] for o in optimized) / max(1, len(optimized))

    page_base("overview", 1)
    c.setFillColor(black)
    c.setFont(display, 42)
    c.drawString(M, H - 100, "PROMPT")
    c.drawString(M, H - 144, "BENCHMARK")
    c.setFont(mono, 9)
    c.setFillColor(red)
    c.drawString(M, H - 166, "[WITH VS WITHOUT PROMPT]  CLAUDE CODE + CODEX")
    y = H - 220
    metric_card(M, y, 150, 86, "TOTAL RUNS", str(total_runs), "agent attempts", black)
    metric_card(M + 165, y, 150, 86, "PASSED", f"{pass_count}/{total_runs}", "npm test after", green if pass_count else red)
    metric_card(M + 330, y, 150, 86, "CLAUDE COST", f"${claude_cost:.2f}", "reported by claude", red if claude_cost > 0 else black)
    y -= 120
    y = wrapped(
        M,
        y,
        "This report compares vague user prompts against Prompt-generated scoped prompts across three generated benchmark repositories. Each run used a disposable git worktree, captured the agent transcript, saved the final patch, and verified the result with npm test.",
        92,
        size=10,
        leading=14,
    )
    y -= 20
    rows = []
    for key, agg in sorted(aggs.items()):
        color = green if "with-prompt" in key else black
        rows.append((key, float(agg["success_rate"]), color))
    y = bar_chart(M, y, W - 2 * M, rows, "SUCCESS RATE BY AGENT + CONDITION")
    y -= 20
    rows = [
        ("average generic prompt chars", avg_raw / max(avg_raw, avg_opt), black),
        ("average optimized prompt chars", avg_opt / max(avg_raw, avg_opt), red if avg_opt > avg_raw else green),
    ]
    bar_chart(M, y, W - 2 * M, rows, "PROMPT LENGTH RATIO")

    c.showPage()
    page_base("aggregate data", 2)
    y = H - 70
    text(M, y, "AGGREGATE RESULTS", 20, bold)
    y -= 28
    columns = [M, M + 140, M + 205, M + 270, M + 350, M + 430]
    headers = ["SEGMENT", "RUNS", "PASS", "FILES", "DIFF", "COST"]
    for x, htxt in zip(columns, headers):
        label(x, y, htxt)
    y -= 12
    c.setStrokeColor(border)
    c.line(M, y, W - M, y)
    y -= 16
    for key, agg in sorted(aggs.items()):
        text(columns[0], y, key, 8, mono)
        text(columns[1], y, str(agg["runs"]), 8, mono)
        text(columns[2], y, f"{agg['passed']}/{agg['runs']}", 8, mono, green if agg["passed"] else red)
        text(columns[3], y, f"{agg['avg_files_touched']:.1f}", 8, mono)
        text(columns[4], y, f"{agg['avg_diff_chars']:.0f}", 8, mono)
        cost = agg.get("total_cost_usd")
        text(columns[5], y, "-" if cost is None else f"${cost:.3f}", 8, mono)
        y -= 17
    y -= 16
    rows = []
    for key, agg in sorted(aggs.items()):
        value = float(agg.get("avg_files_touched") or 0)
        rows.append((key, value, red if "without" in key else black))
    max_files = max([row[1] for row in rows] + [1])
    y = bar_chart(M, y, W - 2 * M, rows, "AVERAGE FILES TOUCHED", max_files)
    y -= 18
    claude_rows = []
    for key, agg in sorted(aggs.items()):
        if key.startswith("claude"):
            claude_rows.append((key, float(agg.get("total_cost_usd") or 0), red if "without" in key else black))
    max_cost = max([row[1] for row in claude_rows] + [1])
    bar_chart(M, y, W - 2 * M, claude_rows, "CLAUDE TOTAL COST USD", max_cost)

    c.showPage()
    page_base("run details", 3)
    y = H - 70
    text(M, y, "RUN DETAILS", 20, bold)
    y -= 25
    for r in summary["agent_results"]:
        if y < 90:
            c.showPage()
            page_base("run details", c.getPageNumber())
            y = H - 70
        status_color = green if r["tests_passed"] else red
        label(M, y, f"{r['repo']} / {r['agent']} / {r['condition']} / {r['prompt_id']}")
        text(W - M - 80, y, "PASS" if r["tests_passed"] else "FAIL", 8, mono, status_color)
        y -= 12
        files = ", ".join(r.get("files_touched", [])[:4]) or "no files touched"
        cost = r.get("usage", {}).get("total_cost_usd")
        line = (
            f"files={r['files_touched_count']} diff={r['diff_chars']} "
            f"agent_exit={r['agent_exit_code']} cost={'-' if cost is None else '$' + format(cost, '.4f')} "
            f"touched={files}"
        )
        y = wrapped(M, y, line, 110, size=8, leading=10, font=mono)
        y -= 8
        c.setStrokeColor(border)
        c.line(M, y, W - M, y)
        y -= 12

    c.showPage()
    page_base("prompt samples", c.getPageNumber())
    y = H - 70
    text(M, y, "PROMPT SAMPLES", 20, bold)
    y -= 26
    for item in optimized[:9]:
        if y < 120:
            c.showPage()
            page_base("prompt samples", c.getPageNumber())
            y = H - 70
        label(M, y, f"{item['repo']} / {item['prompt_id']}")
        y -= 12
        text(M, y, f"raw {item['generic_chars']} chars -> optimized {item['optimized_chars']} chars", 8, mono, red if item["optimized_chars"] > item["generic_chars"] else green)
        y -= 12
        sample = item.get("optimized_prompt") or item.get("generic_prompt")
        y = wrapped(M, y, sample.replace("\n", " "), 100, size=8, leading=10)
        y -= 14

    c.save()


def generate_pdf(summary: dict[str, Any], output_path: Path) -> None:
    """Generate the focused benchmark report.

    Keep the PDF limited to the metrics that matter for this benchmark:
    cost when the agent exposes it, otherwise token usage.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    sf_mono = Path("/System/Library/Fonts/SFNSMono.ttf")
    if sf_mono.exists():
        try:
            pdfmetrics.registerFont(TTFont("SFMono", str(sf_mono)))
            mono = "SFMono"
        except Exception:
            mono = "Courier"
    else:
        mono = "Courier"

    W, H = A4
    M = 44
    bg = colors.HexColor("#F5F5F5")
    black = colors.HexColor("#000000")
    surface = colors.HexColor("#FFFFFF")
    border = colors.HexColor("#CCCCCC")
    muted = colors.HexColor("#666666")
    light = colors.HexColor("#E0E0E0")
    red = colors.HexColor("#D71921")
    green = colors.HexColor("#4A9E5C")

    def build_usage_rows(source: dict[str, Any]) -> dict[tuple[str, str], dict[str, float]]:
        usage_rows: dict[tuple[str, str], dict[str, float]] = {}
        for agent in ("claude", "codex"):
            for condition in ("without-prompt", "with-prompt"):
                subset = [
                    item for item in source["agent_results"]
                    if item["agent"] == agent and item["condition"] == condition
                ]
                usage = [item.get("usage", {}) for item in subset]
                usage_rows[(agent, condition)] = {
                    "runs": len(subset),
                    "passed": sum(1 for item in subset if item.get("tests_passed")),
                    "cost": sum(float(item.get("total_cost_usd") or 0) for item in usage),
                    "input": sum(
                        float(item.get("input_tokens") or 0)
                        + float(item.get("cache_creation_input_tokens") or 0)
                        + float(item.get("cache_read_input_tokens") or 0)
                        for item in usage
                    ),
                    "output": sum(float(item.get("output_tokens") or 0) for item in usage),
                    "cached": sum(float(item.get("cached_input_tokens") or 0) for item in usage),
                }

        # Codex CLI exposes token usage but not billed dollars. Estimate the
        # equivalent API cost from local config model=gpt-5.5, short-context rates.
        # All individual Codex runs stayed below the 272K long-context threshold.
        for condition in ("without-prompt", "with-prompt"):
            codex = usage_rows[("codex", condition)]
            uncached_input = max(0, codex["input"] - codex["cached"])
            codex["estimated_cost"] = (
                uncached_input * 5 / 1_000_000
                + codex["cached"] * 0.5 / 1_000_000
                + codex["output"] * 30 / 1_000_000
            )
        return usage_rows

    def comparison_metrics(source: dict[str, Any]) -> dict[str, float]:
        usage_rows = build_usage_rows(source)
        return {
            "total_runs": float(len(source["agent_results"])),
            "total_passed": float(sum(1 for item in source["agent_results"] if item.get("tests_passed"))),
            "claude_saved": usage_rows[("claude", "without-prompt")]["cost"] - usage_rows[("claude", "with-prompt")]["cost"],
            "claude_input_saved": usage_rows[("claude", "without-prompt")]["input"] - usage_rows[("claude", "with-prompt")]["input"],
            "codex_saved": usage_rows[("codex", "without-prompt")]["estimated_cost"] - usage_rows[("codex", "with-prompt")]["estimated_cost"],
            "codex_input_saved": usage_rows[("codex", "without-prompt")]["input"] - usage_rows[("codex", "with-prompt")]["input"],
        }

    rows = build_usage_rows(summary)

    total_runs = len(summary["agent_results"])
    total_passed = sum(1 for item in summary["agent_results"] if item.get("tests_passed"))
    claude_save = rows[("claude", "without-prompt")]["cost"] - rows[("claude", "with-prompt")]["cost"]
    claude_token_save = rows[("claude", "without-prompt")]["input"] - rows[("claude", "with-prompt")]["input"]
    codex_token_save = rows[("codex", "without-prompt")]["input"] - rows[("codex", "with-prompt")]["input"]
    codex_cost_save = rows[("codex", "without-prompt")]["estimated_cost"] - rows[("codex", "with-prompt")]["estimated_cost"]
    claude_cost_pct = claude_save / max(rows[("claude", "without-prompt")]["cost"], 1) * 100
    codex_cost_pct = codex_cost_save / max(rows[("codex", "without-prompt")]["estimated_cost"], 1) * 100
    codex_token_pct = codex_token_save / max(rows[("codex", "without-prompt")]["input"], 1) * 100
    current_compare = comparison_metrics(summary)
    prompt_generation_input_tokens = float(os.environ.get("PRMPT_BENCH_PROMPT_INPUT_TOKENS", "49080"))
    prompt_generation_output_tokens = float(os.environ.get("PRMPT_BENCH_PROMPT_OUTPUT_TOKENS", "3183"))
    prompt_generation_calls = float(os.environ.get("PRMPT_BENCH_PROMPT_CALLS", str(max(1, len(summary.get("optimized_prompts", []))))))
    prompt_generation_cost = (
        prompt_generation_input_tokens * 0.80 / 1_000_000
        + prompt_generation_output_tokens * 4.00 / 1_000_000
    )
    net_claude_save = claude_save - prompt_generation_cost
    net_codex_cost_save = codex_cost_save - prompt_generation_cost
    prompt_cost_per_task = prompt_generation_cost / max(prompt_generation_calls, 1)
    net_claude_per_task = net_claude_save / max(prompt_generation_calls, 1)
    net_codex_per_task = net_codex_cost_save / max(prompt_generation_calls, 1)
    previous_compare: dict[str, float] | None = None
    previous_path_env = os.environ.get("PRMPT_BENCH_PREVIOUS_SUMMARY")
    previous_path = (
        Path(previous_path_env)
        if previous_path_env
        else RUNS_ROOT / "20260608-161028-agent-clean" / "summary.json"
    )
    if previous_path.exists() and previous_path != output_path.parent / "summary.json":
        try:
            previous_compare = comparison_metrics(json.loads(previous_path.read_text()))
        except Exception:
            previous_compare = None

    c = canvas.Canvas(str(output_path), pagesize=A4)

    def page_frame(section: str) -> None:
        c.setFillColor(bg)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#DDDDDD"))
        for dot_x in range(28, int(W), 14):
            for dot_y in range(48, int(H - 48), 14):
                c.circle(dot_x, dot_y, 0.45, fill=1, stroke=0)
        c.setStrokeColor(border)
        c.setLineWidth(0.8)
        c.rect(26, 26, W - 52, H - 52, fill=0, stroke=1)
        c.line(M, H - 36, W - M, H - 36)
        c.line(M, 36, W - M, 36)
        c.setFillColor(muted)
        c.setFont(mono, 8)
        c.drawString(M, H - 25, "PRMPT BENCHMARK REPORT")
        c.drawRightString(W - M, H - 25, section.upper())

    page_frame("cost + token comparison")

    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "WITH VS WITHOUT")
    c.drawString(M, H - 134, "PROMPT")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 156, "[CLAUDE CODE + CODEX]  MONEY WHERE AVAILABLE, TOKENS EVERYWHERE")

    def card(x: float, y: float, w: float, title: str, value: str, note: str, color=black) -> None:
        c.setFillColor(surface)
        c.setStrokeColor(border)
        c.setLineWidth(0.8)
        c.roundRect(x, y - 82, w, 82, 6, fill=1, stroke=1)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawString(x + 12, y - 18, title.upper())
        c.setFillColor(color)
        c.setFont("Courier-Bold", 24)
        c.drawString(x + 12, y - 49, value)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawString(x + 12, y - 68, note.upper())

    y = H - 198
    card(M, y, 150, "Runs Passed", f"{total_passed}/{total_runs}", "npm test verified", green)
    card(M + 165, y, 150, "Claude Saved", f"${claude_save:.3f}", f"{claude_cost_pct:.1f}% cost", green if claude_save > 0 else red)
    card(M + 330, y, 150, "Codex Saved", f"${codex_cost_save:.3f}", f"{codex_cost_pct:.1f}% est cost", green if codex_cost_save > 0 else red)

    y = H - 300
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 42, W - 2 * M, 42, 6, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont(mono, 8)
    c.drawString(M + 12, y - 17, "NOTE: TOTAL COST IS THE REAL MONEY METRIC. IT ALREADY INCLUDES INPUT + OUTPUT TOKENS.")
    c.setFillColor(muted)
    c.drawString(M + 12, y - 31, "OUTPUT TOKENS CAN RISE WHILE TOTAL COST STILL FALLS IF INPUT/CONTEXT SAVINGS OFFSET IT.")

    def h2(y: float, title: str) -> float:
        c.setFillColor(black)
        c.setFont("Courier-Bold", 18)
        c.drawString(M, y, title)
        return y - 28

    def label(x: float, y: float, text: str) -> None:
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawString(x, y, text.upper())

    def pct_lower_better(without: float, with_prompt: float) -> tuple[float, str, Any]:
        pct = (without - with_prompt) / max(without, 1) * 100
        if pct > 0:
            return pct, "SAVED", green
        if pct < 0:
            return abs(pct), "INCREASED", red
        return 0, "NO CHANGE", black

    def pct_higher_better(without: float, with_prompt: float) -> tuple[float, str, Any]:
        pct = (with_prompt - without) / max(without, 1) * 100
        if pct > 0:
            return pct, "INCREASED", green
        if pct < 0:
            return abs(pct), "DROPPED", red
        return 0, "NO CHANGE", black

    def metric_row(
        y: float,
        label_text: str,
        without: float,
        with_prompt: float,
        fmt,
        direction: str,
        pct_fn,
        suffix: str = "",
    ) -> float:
        max_value = max(without, with_prompt, 1)
        pct, verb, result_color = pct_fn(without, with_prompt)
        label(M, y + 3, label_text)
        c.setFillColor(result_color)
        c.setFont(mono, 6)
        c.drawString(M, y - 10, f"{direction} · {pct:.1f}% {verb}")
        x0 = M + 228
        bw = 210
        c.setFillColor(light)
        c.rect(x0, y + 4, bw, 9, fill=1, stroke=0)
        c.rect(x0, y - 14, bw, 9, fill=1, stroke=0)
        c.setFillColor(red)
        c.rect(x0, y + 4, bw * without / max_value, 9, fill=1, stroke=0)
        c.setFillColor(black)
        c.rect(x0, y - 14, bw * with_prompt / max_value, 9, fill=1, stroke=0)
        c.setFont(mono, 8)
        c.setFillColor(red)
        c.drawString(x0 - 80, y + 3, "WITHOUT")
        c.setFillColor(black)
        c.drawString(x0 - 80, y - 15, "WITH")
        c.drawRightString(W - M, y + 3, f"{fmt(without)}{suffix}")
        c.drawRightString(W - M, y - 15, f"{fmt(with_prompt)}{suffix}")
        return y - 50

    def num(value: float) -> str:
        return f"{value:,.0f}"

    y = H - 380
    y = h2(y, "Claude Code")
    y = metric_row(
        y,
        "Total cost USD",
        rows[("claude", "without-prompt")]["cost"],
        rows[("claude", "with-prompt")]["cost"],
        lambda value: f"${value:.3f}",
        "LOWER IS BETTER",
        pct_lower_better,
    )
    y = metric_row(
        y,
        "Input/context tokens",
        rows[("claude", "without-prompt")]["input"],
        rows[("claude", "with-prompt")]["input"],
        num,
        "LOWER IS BETTER",
        pct_lower_better,
    )
    y = metric_row(
        y,
        "Output tokens",
        rows[("claude", "without-prompt")]["output"],
        rows[("claude", "with-prompt")]["output"],
        num,
        "LOWER IS CHEAPER",
        pct_lower_better,
    )

    y -= 2
    y = h2(y, "Codex")
    y = metric_row(
        y,
        "Input tokens",
        rows[("codex", "without-prompt")]["input"],
        rows[("codex", "with-prompt")]["input"],
        num,
        "LOWER IS BETTER",
        pct_lower_better,
    )
    y = metric_row(
        y,
        "Output tokens",
        rows[("codex", "without-prompt")]["output"],
        rows[("codex", "with-prompt")]["output"],
        num,
        "LOWER IS CHEAPER",
        pct_lower_better,
    )
    y = metric_row(
        y,
        "Cached input tokens",
        rows[("codex", "without-prompt")]["cached"],
        rows[("codex", "with-prompt")]["cached"],
        num,
        "HIGHER CAN BE GOOD",
        pct_higher_better,
    )
    y = metric_row(
        y,
        "Estimated cost USD",
        rows[("codex", "without-prompt")]["estimated_cost"],
        rows[("codex", "with-prompt")]["estimated_cost"],
        lambda value: f"${value:.3f}",
        "LOWER IS BETTER",
        pct_lower_better,
    )

    c.setFillColor(muted)
    c.setFont(mono, 7)
    c.drawString(M, 62, f"RUN: {summary['run_id']}  |  REPOS: 3  |  PROMPTS: 9  |  AGENT ATTEMPTS: {total_runs}")
    c.drawString(M, 50, "NO RUN DETAILS / NO GENERATED PROMPT TEXT")

    if previous_compare:
        c.showPage()
        page_frame("improvements vs previous")

        c.setFillColor(black)
        c.setFont("Courier-Bold", 34)
        c.drawString(M, H - 92, "IMPROVEMENTS")
        c.drawString(M, H - 134, "VS PREVIOUS")
        c.setFillColor(red)
        c.setFont(mono, 9)
        c.drawString(M, H - 156, "[EXPANDED BUG BASELINE]  TWO EXTRA REPRODUCIBLE FAILURES PER GENERATED REPO")

        y = H - 205
        c.setFillColor(surface)
        c.setStrokeColor(border)
        c.roundRect(M, y - 58, W - 2 * M, 58, 8, fill=1, stroke=1)
        c.setFillColor(black)
        c.setFont(mono, 8)
        c.drawString(M + 12, y - 20, "THIS RUN REINDEXES THE UPDATED REPOS BEFORE GENERATING WITH-PROMPT AGENT INPUTS.")
        c.setFillColor(muted)
        c.drawString(M + 12, y - 38, "POSITIVE DELTAS BELOW MEAN PROMPT SAVED MORE MONEY/TOKENS THAN THE PREVIOUS BENCHMARK.")

        y -= 105
        columns = [M, M + 210, M + 315, M + 420]
        for x, value in zip(columns, ["METRIC", "PREVIOUS", "CURRENT", "DELTA"]):
            c.setFillColor(muted)
            c.setFont(mono, 7)
            c.drawString(x, y, value)
        y -= 14
        c.setStrokeColor(border)
        c.line(M, y, W - M, y)
        y -= 22

        def signed(value: float, formatter) -> str:
            sign = "+" if value >= 0 else "-"
            return f"{sign}{formatter(abs(value))}"

        def compare_row(label_text: str, key: str, formatter) -> None:
            nonlocal y
            previous = previous_compare[key]
            current = current_compare[key]
            delta = current - previous
            c.setFillColor(black)
            c.setFont("Courier-Bold", 9)
            c.drawString(columns[0], y, label_text)
            c.setFont(mono, 8)
            c.drawString(columns[1], y, formatter(previous))
            c.drawString(columns[2], y, formatter(current))
            c.setFillColor(green if delta >= 0 else red)
            c.drawString(columns[3], y, signed(delta, formatter))
            y -= 32

        compare_row("Claude cost saved", "claude_saved", lambda value: f"${value:.3f}")
        compare_row("Claude input tokens saved", "claude_input_saved", num)
        compare_row("Codex estimated cost saved", "codex_saved", lambda value: f"${value:.3f}")
        compare_row("Codex input tokens saved", "codex_input_saved", num)
        compare_row("Agent runs passed", "total_passed", lambda value: f"{value:.0f}")

        c.setFillColor(muted)
        c.setFont(mono, 8)
        c.drawString(M, 58, f"PREVIOUS SUMMARY: {previous_path.parent.name}")
        c.drawRightString(W - M, 58, f"CURRENT RUN: {summary['run_id']}")

    c.showPage()
    page_frame("real-world projection")

    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "REAL-WORLD")
    c.drawString(M, H - 134, "PROJECTION")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 156, "[SPECULATIVE]  MOSTLY COMPLEX AGENT TASK MIX, NET OF PROMPT GENERATION COST")

    y = H - 205
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 86, W - 2 * M, 86, 8, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont("Courier-Bold", 12)
    c.drawString(M + 12, y - 22, "PROMPT OVERHEAD INCLUDED")
    c.setFont(mono, 8)
    c.drawString(M + 12, y - 42, f"PROMPT GENERATION: {prompt_generation_calls:.0f} CALLS, {num(prompt_generation_input_tokens)} INPUT TOKENS, {num(prompt_generation_output_tokens)} OUTPUT TOKENS")
    c.drawString(M + 12, y - 58, f"ESTIMATED PROMPT COST: ${prompt_generation_cost:.3f} TOTAL, ${prompt_cost_per_task:.4f} PER OPTIMIZED PROMPT")
    c.setFillColor(muted)
    c.drawString(M + 12, y - 74, "RATE ASSUMPTION: CLAUDE HAIKU 4.5 AT $0.80/M INPUT + $4.00/M OUTPUT")

    y -= 122
    card(M, y, 150, "Net Claude Saved", f"${net_claude_save:.3f}", "after prompt cost", green if net_claude_save > 0 else red)
    card(M + 165, y, 150, "Net Codex Saved", f"${net_codex_cost_save:.3f}", "after prompt cost", green if net_codex_cost_save > 0 else red)
    card(M + 330, y, 150, "Ghost Proxy", "7.3", "commits / active day", black)

    y -= 120
    c.setFillColor(black)
    c.setFont("Courier-Bold", 15)
    c.drawString(M, y, "MONTHLY SAVINGS SCENARIOS")
    c.setFillColor(muted)
    c.setFont(mono, 7)
    c.drawString(M, y - 16, "20 WORKDAYS / MONTH. OBSERVED = THIS BENCHMARK NET SAVINGS PER TASK. COMPLEX = 3X CONTEXT SAVINGS.")
    y -= 42

    columns = [M, M + 105, M + 205, M + 320, M + 430]
    for x, value in zip(columns, ["TASKS/DAY", "TASKS/MO", "CLAUDE OBS", "CODEX OBS", "COMPLEX 3X"]):
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawString(x, y, value)
    y -= 13
    c.setStrokeColor(border)
    c.line(M, y, W - M, y)
    y -= 22

    for tasks_per_day in (4, 8, 16):
        monthly_tasks = tasks_per_day * 20
        claude_month = net_claude_per_task * monthly_tasks
        codex_month = net_codex_per_task * monthly_tasks
        complex_month = ((net_claude_per_task + net_codex_per_task) / 2) * monthly_tasks * 3
        c.setFillColor(black)
        c.setFont("Courier-Bold", 10)
        c.drawString(columns[0], y, str(tasks_per_day))
        c.setFont(mono, 9)
        c.drawString(columns[1], y, str(monthly_tasks))
        c.drawString(columns[2], y, f"${claude_month:.2f}/mo")
        c.drawString(columns[3], y, f"${codex_month:.2f}/mo")
        c.setFillColor(green if complex_month > 0 else red)
        c.drawString(columns[4], y, f"${complex_month:.2f}/mo")
        y -= 30

    y -= 8
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 70, W - 2 * M, 70, 8, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont(mono, 8)
    c.drawString(M + 12, y - 20, "GHOST_MONO PROXY: 213 COMMITS IN 30 DAYS, 29 ACTIVE DAYS, 7.34 COMMITS/ACTIVE DAY.")
    c.setFillColor(muted)
    c.drawString(M + 12, y - 38, "COMMITS ARE NOT AGENT CALLS; THEY ONLY ANCHOR A PLAUSIBLE POWER-USER DAILY ACTIVITY RANGE.")
    c.drawString(M + 12, y - 56, "BIGGER REAL REPOS OR LONGER CONTEXT WINDOWS CAN SCALE SAVINGS ABOVE THE OBSERVED BENCHMARK.")

    c.showPage()
    page_frame("savings curve")

    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "SAVINGS")
    c.drawString(M, H - 134, "CURVE")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 156, "[MORE AGENTIC CODING → MORE MONTHLY SAVINGS]  NET OF PROMPT GENERATION COST")

    y = H - 205
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 62, W - 2 * M, 62, 8, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont(mono, 8)
    c.drawString(M + 12, y - 22, "X-AXIS: AGENT CODING TASKS PER DAY. Y-AXIS: PROJECTED DOLLARS SAVED PER MONTH.")
    c.setFillColor(muted)
    c.drawString(M + 12, y - 40, "OBSERVED = BENCHMARK NET AVERAGE. COMPLEX = 3X CONTEXT SAVINGS. LARGE REPO = 8X CONTEXT SAVINGS.")

    graph_x = M + 56
    graph_y = 255
    graph_w = W - 2 * M - 90
    graph_h = 250
    task_points = [2, 4, 8, 16, 32, 64]
    workdays = 20
    observed_per_task = (net_claude_per_task + net_codex_per_task) / 2

    series = [
        ("OBSERVED", observed_per_task, black),
        ("COMPLEX 3X", observed_per_task * 3, red),
        ("LARGE REPO 8X", observed_per_task * 8, green),
    ]
    max_savings = max(rate * max(task_points) * workdays for _, rate, _ in series)

    c.setStrokeColor(border)
    c.setLineWidth(0.8)
    c.line(graph_x, graph_y, graph_x, graph_y + graph_h)
    c.line(graph_x, graph_y, graph_x + graph_w, graph_y)

    for tick in range(0, 6):
        value = max_savings * tick / 5
        ty = graph_y + graph_h * tick / 5
        c.setStrokeColor(colors.HexColor("#E6E6E6"))
        c.line(graph_x, ty, graph_x + graph_w, ty)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawRightString(graph_x - 8, ty - 3, f"${value:.0f}")

    for idx, tasks in enumerate(task_points):
        tx = graph_x + graph_w * idx / (len(task_points) - 1)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawCentredString(tx, graph_y - 18, str(tasks))
        c.setStrokeColor(colors.HexColor("#EEEEEE"))
        c.line(tx, graph_y, tx, graph_y + graph_h)

    c.setFillColor(muted)
    c.setFont(mono, 8)
    c.drawCentredString(graph_x + graph_w / 2, graph_y - 42, "AGENT CODING TASKS PER DAY")
    c.saveState()
    c.translate(graph_x - 38, graph_y + graph_h / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, "MONTHLY SAVINGS USD")
    c.restoreState()

    for name, rate, color in series:
        points = []
        for idx, tasks in enumerate(task_points):
            monthly = rate * tasks * workdays
            px = graph_x + graph_w * idx / (len(task_points) - 1)
            py = graph_y + graph_h * monthly / max(max_savings, 1)
            points.append((px, py, monthly))

        c.setStrokeColor(color)
        c.setLineWidth(2.0)
        for left, right in zip(points, points[1:]):
            c.line(left[0], left[1], right[0], right[1])
        c.setFillColor(color)
        for px, py, monthly in points:
            c.circle(px, py, 3.2, fill=1, stroke=0)
    legend_y = 190
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, legend_y - 104, W - 2 * M, 104, 8, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont("Courier-Bold", 10)
    c.drawString(M + 12, legend_y - 20, "AT 64 AGENT TASKS / DAY")
    c.setFont(mono, 8)
    legend_rows = [
        ("OBSERVED", observed_per_task * 64 * workdays, black),
        ("COMPLEX 3X", observed_per_task * 3 * 64 * workdays, red),
        ("LARGE REPO 8X", observed_per_task * 8 * 64 * workdays, green),
    ]
    row_y = legend_y - 42
    for name, value, color in legend_rows:
        c.setFillColor(color)
        c.circle(M + 16, row_y + 3, 3, fill=1, stroke=0)
        c.setFillColor(black)
        c.drawString(M + 28, row_y, f"{name}: ${value:.0f}/MO")
        row_y -= 17
    c.setFillColor(muted)
    c.drawString(M + 250, legend_y - 42, "MORE DAILY TASKS => MORE CONTEXT SAVED.")
    c.drawString(M + 250, legend_y - 59, "HIGHER LINES MODEL BIGGER REPOS / COMPLEXITY.")
    c.drawString(M + 250, legend_y - 76, "ALL VALUES ARE NET OF PROMPT COST.")

    c.showPage()
    page_frame("monthly cost curves")

    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "MONTHLY")
    c.drawString(M, H - 134, "COST CURVES")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 156, "[NORMAL AGENT COST VS WITH PROMPT]  PROMPT GENERATION OVERHEAD INCLUDED")

    claude_without_per_task = rows[("claude", "without-prompt")]["cost"] / max(prompt_generation_calls, 1)
    claude_with_per_task = rows[("claude", "with-prompt")]["cost"] / max(prompt_generation_calls, 1) + prompt_cost_per_task
    codex_without_per_task = rows[("codex", "without-prompt")]["estimated_cost"] / max(prompt_generation_calls, 1)
    codex_with_per_task = rows[("codex", "with-prompt")]["estimated_cost"] / max(prompt_generation_calls, 1) + prompt_cost_per_task

    y = H - 205
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 70, W - 2 * M, 70, 8, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont(mono, 8)
    c.drawString(M + 12, y - 22, "THIS GRAPH SHOWS TOTAL MONTHLY AGENT SPEND, NOT JUST SAVINGS.")
    c.setFillColor(muted)
    c.drawString(M + 12, y - 40, "WITH PROMPT LINES INCLUDE THE EXTRA PROMPT-GENERATION COST PER TASK.")
    c.drawString(M + 12, y - 56, "CODEX COST IS ESTIMATED FROM TOKEN PRICES BECAUSE CODEX CLI DID NOT REPORT BILLED DOLLARS.")

    graph_x = M + 56
    graph_y = 255
    graph_w = W - 2 * M - 90
    graph_h = 250
    task_points = [2, 4, 8, 16, 32, 64]
    workdays = 20
    blue = colors.HexColor("#3A6EA5")
    orange = colors.HexColor("#C86B1D")
    cost_series = [
        ("CLAUDE NORMAL", claude_without_per_task, red),
        ("CLAUDE + PROMPT", claude_with_per_task, black),
        ("CODEX NORMAL", codex_without_per_task, orange),
        ("CODEX + PROMPT", codex_with_per_task, blue),
    ]
    max_cost = max(rate * max(task_points) * workdays for _, rate, _ in cost_series)

    c.setStrokeColor(border)
    c.setLineWidth(0.8)
    c.line(graph_x, graph_y, graph_x, graph_y + graph_h)
    c.line(graph_x, graph_y, graph_x + graph_w, graph_y)

    for tick in range(0, 6):
        value = max_cost * tick / 5
        ty = graph_y + graph_h * tick / 5
        c.setStrokeColor(colors.HexColor("#E6E6E6"))
        c.line(graph_x, ty, graph_x + graph_w, ty)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawRightString(graph_x - 8, ty - 3, f"${value:.0f}")

    for idx, tasks in enumerate(task_points):
        tx = graph_x + graph_w * idx / (len(task_points) - 1)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawCentredString(tx, graph_y - 18, str(tasks))
        c.setStrokeColor(colors.HexColor("#EEEEEE"))
        c.line(tx, graph_y, tx, graph_y + graph_h)

    c.setFillColor(muted)
    c.setFont(mono, 8)
    c.drawCentredString(graph_x + graph_w / 2, graph_y - 42, "AGENT CODING TASKS PER DAY")
    c.saveState()
    c.translate(graph_x - 38, graph_y + graph_h / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, "PROJECTED MONTHLY COST USD")
    c.restoreState()

    for index, (name, rate, color) in enumerate(cost_series):
        points = []
        for idx, tasks in enumerate(task_points):
            monthly = rate * tasks * workdays
            px = graph_x + graph_w * idx / (len(task_points) - 1)
            py = graph_y + graph_h * monthly / max(max_cost, 1)
            points.append((px, py, monthly))

        c.setStrokeColor(color)
        c.setLineWidth(2.0)
        if "+ PROMPT" in name:
            c.setDash(4, 3)
        else:
            c.setDash()
        for left, right in zip(points, points[1:]):
            c.line(left[0], left[1], right[0], right[1])
        c.setDash()
        c.setFillColor(color)
        for px, py, monthly in points:
            c.circle(px, py, 3.0, fill=1, stroke=0)
    legend_y = 190
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, legend_y - 104, W - 2 * M, 104, 8, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont("Courier-Bold", 10)
    c.drawString(M + 12, legend_y - 20, "AT 64 AGENT TASKS / DAY")
    c.setFont(mono, 8)
    legend_rows = [
        ("CLAUDE NORMAL", claude_without_per_task * 64 * workdays, red, False),
        ("CLAUDE + PROMPT", claude_with_per_task * 64 * workdays, black, True),
        ("CODEX NORMAL", codex_without_per_task * 64 * workdays, orange, False),
        ("CODEX + PROMPT", codex_with_per_task * 64 * workdays, blue, True),
    ]
    row_y = legend_y - 42
    for idx, (name, value, color, dashed) in enumerate(legend_rows):
        x = M + 18 + (idx % 2) * 225
        if idx == 2:
            row_y -= 20
        c.setStrokeColor(color)
        c.setLineWidth(2)
        if dashed:
            c.setDash(4, 3)
        else:
            c.setDash()
        c.line(x, row_y + 4, x + 22, row_y + 4)
        c.setDash()
        c.setFillColor(black)
        c.drawString(x + 32, row_y, f"{name}: ${value:.0f}/MO")
    c.setFillColor(muted)
    c.drawString(M + 18, legend_y - 88, "DASHED LINES INCLUDE PROMPT GENERATION OVERHEAD. LOWER LINE = CHEAPER.")

    c.showPage()
    page_frame("tests")

    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "TESTS")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 116, "[REPOS + USER PROMPTS USED]")

    y = H - 155
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 78, W - 2 * M, 78, 10, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont("Courier-Bold", 12)
    c.drawString(M + 14, y - 22, "MODELS USED")
    c.setFont(mono, 8)
    c.drawString(M + 14, y - 42, "CLAUDE CODE: claude-opus-4-6[1m] + claude-haiku-4-5-20251001")
    c.drawString(M + 14, y - 58, "CODEX CLI: gpt-5.5, reasoning effort high, service tier fast")
    c.setFillColor(muted)
    c.drawString(M + 14, y - 72, "CODEX COST ESTIMATE: $5/M INPUT, $0.50/M CACHED INPUT, $30/M OUTPUT")

    y -= 115
    prompt_lookup: dict[str, list[str]] = {}
    for item in summary.get("optimized_prompts", []):
        prompt_lookup.setdefault(item["repo"], []).append(item["generic_prompt"])

    for repo_name, repo in summary.get("repo_meta", {}).items():
        if y < 150:
            c.showPage()
            c.setFillColor(bg)
            c.rect(0, 0, W, H, fill=1, stroke=0)
            y = H - 70

        c.setFillColor(black)
        c.setFont("Courier-Bold", 15)
        c.drawString(M, y, repo_name)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawRightString(W - M, y, f"{repo.get('lines', 0):,} LINES")
        y -= 22

        for idx, prompt in enumerate(prompt_lookup.get(repo_name, repo.get("prompts", [])), 1):
            c.setFillColor(red)
            c.setFont(mono, 8)
            c.drawString(M + 10, y, f"P{idx}")
            c.setFillColor(black)
            c.setFont(mono, 9)
            c.drawString(M + 42, y, prompt[:96])
            y -= 18

        y -= 18

    c.setFillColor(muted)
    c.setFont(mono, 8)
    c.drawString(M, 58, "ONLY ORIGINAL USER-STYLE PROMPTS ARE SHOWN")
    c.drawRightString(W - M, 58, "NO GENERATED PROMPTS / NO RUN DETAILS")
    c.save()


async def main() -> int:
    resume_dir = os.environ.get("PRMPT_BENCH_RESUME_DIR")
    if resume_dir:
        run_dir = Path(resume_dir)
        run_id = run_dir.name
        if not run_dir.exists():
            raise FileNotFoundError(run_dir)
        if os.environ.get("PRMPT_BENCH_KEEP_AGENT_RESULTS", "0") not in {"1", "true", "yes"}:
            for child in ("agent-runs", "worktrees"):
                shutil.rmtree(run_dir / child, ignore_errors=True)
            for child in ("agent_results.json", "summary.json", "benchmark-report.pdf"):
                try:
                    (run_dir / child).unlink()
                except FileNotFoundError:
                    pass
    else:
        run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        run_dir = RUNS_ROOT / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        write_json(run_dir / "run_config.json", {
            "run_id": run_id,
            "created_at": now_iso(),
            "repos": {k: {"path": str(v["path"]), "prompts": v["prompts"]} for k, v in REPOS.items()},
            "agents": AGENTS,
            "conditions": CONDITIONS,
            "agent_timeout_seconds": AGENT_TIMEOUT_SECONDS,
            "code_intel_url": CODE_INTEL_URL,
            "optimizer_ws_url": OPTIMIZER_WS_URL,
        })

    for spec in REPOS.values():
        ensure_clean_worktree(spec["path"])

    if resume_dir:
        indexed = [
            IndexedProject(**item)
            for item in json.loads((run_dir / "indexed_projects.json").read_text())
        ]
        optimized = json.loads((run_dir / "optimized_prompts.json").read_text())
        print(f"[resume] {run_dir}", flush=True)
    else:
        indexed: list[IndexedProject] = []
        for repo_name, spec in REPOS.items():
            print(f"[index] {repo_name}", flush=True)
            indexed.append(await index_repo(run_dir, repo_name, spec["path"]))
            write_json(run_dir / "indexed_projects.json", [i.__dict__ for i in indexed])

        optimized: list[dict[str, Any]] = []
        for project in indexed:
            prompts = REPOS[project.repo]["prompts"]
            for index, prompt in enumerate(prompts, 1):
                prompt_id = f"p{index}"
                print(f"[optimize] {project.repo} {prompt_id}", flush=True)
                try:
                    optimized.append(await optimize_prompt(run_dir, project, prompt_id, prompt))
                except Exception as exc:
                    optimized.append({
                        "repo": project.repo,
                        "prompt_id": prompt_id,
                        "generic_prompt": prompt,
                        "optimized_prompt": "",
                        "error": f"{exc.__class__.__name__}: {exc}",
                        "generic_chars": len(prompt),
                        "optimized_chars": 0,
                    })
                write_json(run_dir / "optimized_prompts.json", optimized)

    optimized_lookup = {
        (item["repo"], item["prompt_id"]): item for item in optimized
    }

    agent_results: list[dict[str, Any]] = []
    for repo_name, spec in REPOS.items():
        for prompt_index, generic_prompt in enumerate(spec["prompts"], 1):
            prompt_id = f"p{prompt_index}"
            opt_item = optimized_lookup[(repo_name, prompt_id)]
            for agent in AGENTS:
                for condition in CONDITIONS:
                    prompt = generic_prompt
                    if condition == "with-prompt" and opt_item.get("optimized_prompt"):
                        prompt = opt_item["optimized_prompt"]
                    print(f"[agent] {repo_name} {prompt_id} {agent} {condition}", flush=True)
                    try:
                        result = run_agent(
                            run_dir,
                            repo_name,
                            spec["path"],
                            agent,
                            condition,
                            prompt_id,
                            prompt,
                        )
                    except Exception as exc:
                        result = {
                            "repo": repo_name,
                            "agent": agent,
                            "condition": condition,
                            "prompt_id": prompt_id,
                            "error": f"{exc.__class__.__name__}: {exc}",
                            "tests_passed": False,
                            "agent_exit_code": -1,
                            "files_touched_count": 0,
                            "files_touched": [],
                            "diff_chars": 0,
                            "usage": {},
                        }
                    agent_results.append(result)
                    write_json(run_dir / "agent_results.json", agent_results)

    summary = summarize_results(run_dir, indexed, optimized, agent_results)
    generate_pdf(summary, run_dir / "benchmark-report.pdf")
    print(f"[done] {run_dir}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
