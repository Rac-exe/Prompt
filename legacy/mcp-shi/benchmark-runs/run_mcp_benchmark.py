from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import shutil
import sys
import textwrap
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MCP_ROOT = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ.get("PRMPT_BENCH_ROOT", MCP_ROOT)).expanduser().resolve()
RUNS_ROOT = Path(os.environ.get("PRMPT_BENCH_RUNS_ROOT", ROOT / "benchmark-runs")).expanduser().resolve()
BASE_SCRIPT = Path(os.environ.get("PRMPT_BASE_BENCH_SCRIPT", Path(__file__).resolve().parent / "run_benchmark.py")).expanduser().resolve()
MCP_SERVER = Path(os.environ.get("PRMPT_MCP_SERVER", Path(__file__).resolve().parent / "prompt_mcp_server.py")).expanduser().resolve()

spec = importlib.util.spec_from_file_location("base_bench", BASE_SCRIPT)
base = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = base
spec.loader.exec_module(base)

REPOS = base.REPOS
AGENTS = ["claude", "codex"]
CONDITIONS = {
    "without-mcp": "without-prompt",
    "with-mcp": "with-prompt",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(errors="ignore").splitlines():
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    return rows


def make_agent_prompt(base_prompt: str, condition: str, prompt_id: str, repo_name: str) -> str:
    mcp_instruction = ""
    if condition == "with-mcp":
        mcp_instruction = f"""
        Call `mcp__prompt__prmpt_optimize_task` first with task=<bug report> and prompt_id={prompt_id}.
        Treat the returned JSON as the final authoritative route. Do not second-guess it, do not plan alternate
        investigations, and do not Glob/Grep or broadly cross-check the repo. Run tests, read the JSON primary files,
        patch those files, and rerun tests. Search elsewhere only if a failing stack trace explicitly names another file.
        """

    return textwrap.dedent(f"""
    {base_prompt}

    Repository under test: {repo_name}
    Benchmark condition: {condition}.
    {mcp_instruction}

    You are in a disposable benchmark clone. Fix the issue in this repository.
    Run `npm test` before editing to discover the concrete failures.
    Re-run `npm test` after editing and stop when the suite passes.
    Do not commit changes.
    Do not add comments that mention benchmarks, hidden bugs, seeded bugs, MCP, Prompt, or this evaluation.
    Keep the fix minimal and production-like.
    """).strip()


def write_mcp_configs(worktree: Path, out_dir: Path, context_file: Path, call_log: Path) -> Path:
    claude_config = out_dir / "claude-mcp.json"
    trace_log = out_dir / "prompt-mcp-trace.jsonl"
    env = {
        "PRMPT_CONTEXT_FILE": str(context_file),
        "PRMPT_MCP_CALL_LOG": str(call_log),
        "PRMPT_MCP_TRACE_LOG": str(trace_log),
    }
    write_json(claude_config, {
        "mcpServers": {
            "prompt": {
                "command": sys.executable,
                "args": [str(MCP_SERVER)],
                "env": env,
            }
        }
    })

    codex_dir = worktree / ".codex"
    codex_dir.mkdir(parents=True, exist_ok=True)
    codex_config = textwrap.dedent(f"""
    [mcp_servers.prompt]
    command = "{sys.executable}"
    args = ["{MCP_SERVER}"]
    enabled = true

    [mcp_servers.prompt.env]
    PRMPT_CONTEXT_FILE = "{context_file}"
    PRMPT_MCP_CALL_LOG = "{call_log}"
    PRMPT_MCP_TRACE_LOG = "{trace_log}"
    """).strip() + "\n"
    write_text(codex_dir / "config.toml", codex_config)
    return claude_config


def run_agent(
    run_dir: Path,
    repo_name: str,
    repo_path: Path,
    agent: str,
    condition: str,
    prompt_id: str,
    prompt: str,
    optimized_for_repo: list[dict[str, Any]],
) -> dict[str, Any]:
    branch = CONDITIONS[condition]
    run_id = f"{repo_name}__{agent}__{condition}__{prompt_id}"
    worktree = run_dir / "worktrees" / run_id
    out_dir = run_dir / "agent-runs" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    base.create_worktree(repo_path, branch, worktree)
    metadata = {
        "repo": repo_name,
        "agent": agent,
        "condition": condition,
        "prompt_id": prompt_id,
        "branch": branch,
        "worktree": str(worktree),
        "started_at": now_iso(),
        "agent_timeout_seconds": base.AGENT_TIMEOUT_SECONDS,
    }
    write_json(out_dir / "metadata.json", metadata)

    context_file = out_dir / "prompt-mcp-context.json"
    call_log = out_dir / "prompt-mcp-calls.jsonl"
    write_json(context_file, {
        "repo": repo_name,
        "prompt_id": prompt_id,
        "optimized_prompts": optimized_for_repo,
    })
    claude_mcp_config = write_mcp_configs(worktree, out_dir, context_file, call_log)

    test_before = base.run_cmd(["npm", "test"], worktree, timeout=180)
    write_text(out_dir / "test_before.txt", test_before["stdout"] + test_before["stderr"])
    write_json(out_dir / "test_before.json", test_before)

    full_prompt = make_agent_prompt(prompt, condition, prompt_id, repo_name)
    write_text(out_dir / "agent_prompt.txt", full_prompt + "\n")

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
        if condition == "with-mcp":
            cmd.extend([
                "--mcp-config",
                str(claude_mcp_config),
                "--strict-mcp-config",
            ])
        agent_result = base.run_cmd(cmd, worktree, timeout=base.AGENT_TIMEOUT_SECONDS, input_text="")
        write_text(out_dir / "agent_raw_output.json", agent_result["stdout"])
        write_text(out_dir / "agent_stderr.txt", agent_result["stderr"])
        usage = base.extract_claude_usage(agent_result["stdout"])
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
        agent_result = base.run_cmd(cmd, worktree, timeout=base.AGENT_TIMEOUT_SECONDS, input_text=full_prompt)
        write_text(out_dir / "agent_raw_output.jsonl", agent_result["stdout"])
        write_text(out_dir / "agent_stderr.txt", agent_result["stderr"])
        usage = base.extract_codex_usage(out_dir / "agent_raw_output.jsonl")
    else:
        raise ValueError(agent)

    if worktree.exists():
        test_after = base.run_cmd(["npm", "test"], worktree, timeout=180)
        status = base.run_cmd(["git", "status", "--short"], worktree, timeout=60)
        diff = base.run_cmd(["git", "diff", "--binary"], worktree, timeout=60)
        name_only = base.run_cmd(["git", "diff", "--name-only"], worktree, timeout=60)
    else:
        missing = f"Worktree missing after agent run: {worktree}\n"
        test_after = {"exit_code": -1, "stdout": "", "stderr": missing, "timed_out": False}
        status = {"stdout": "", "stderr": missing}
        diff = {"stdout": "", "stderr": missing}
        name_only = {"stdout": "", "stderr": missing}
    mcp_calls = read_jsonl(call_log)

    write_text(out_dir / "test_after.txt", test_after["stdout"] + test_after["stderr"])
    write_json(out_dir / "test_after.json", test_after)
    write_text(out_dir / "git_status.txt", status["stdout"] + status["stderr"])
    write_text(out_dir / "git_diff.patch", diff["stdout"])
    write_text(out_dir / "files_touched.txt", name_only["stdout"])
    write_json(out_dir / "cost_usage.json", usage)
    write_json(out_dir / "mcp_calls.json", mcp_calls)

    result = {
        **metadata,
        "finished_at": now_iso(),
        "elapsed_ms": round((time.time() - started) * 1000),
        "test_before_exit": test_before["exit_code"],
        "test_after_exit": test_after["exit_code"],
        "tests_passed": test_after["exit_code"] == 0,
        "agent_exit_code": agent_result["exit_code"],
        "agent_timed_out": agent_result["timed_out"],
        "files_touched": [line.strip() for line in name_only["stdout"].splitlines() if line.strip()],
        "files_touched_count": len([line for line in name_only["stdout"].splitlines() if line.strip()]),
        "diff_chars": len(diff["stdout"]),
        "usage": usage,
        "mcp_call_count": len(mcp_calls),
        "mcp_tools": sorted({row.get("tool") for row in mcp_calls if row.get("tool")}),
    }
    write_json(out_dir / "result.json", result)
    shutil.rmtree(worktree, ignore_errors=True)
    return result


def summarize_results(
    run_dir: Path,
    indexed: list[Any],
    optimized: list[dict[str, Any]],
    agent_results: list[dict[str, Any]],
) -> dict[str, Any]:
    repo_meta = {}
    for repo_name, spec in REPOS.items():
        files, lines = base.file_line_count(spec["path"])
        repo_meta[repo_name] = {"path": str(spec["path"]), "files": files, "lines": lines, "prompts": spec["prompts"]}

    summary = {
        "run_id": run_dir.name,
        "created_at": now_iso(),
        "run_dir": str(run_dir),
        "repo_meta": repo_meta,
        "indexed_projects": [i.__dict__ for i in indexed],
        "optimized_prompts": optimized,
        "agent_results": agent_results,
        "conditions": CONDITIONS,
        "mcp_server": str(MCP_SERVER),
    }
    write_json(run_dir / "summary.json", summary)
    return summary


def usage_rows(summary: dict[str, Any]) -> dict[tuple[str, str], dict[str, float]]:
    rows: dict[tuple[str, str], dict[str, float]] = {}
    for agent in AGENTS:
        for condition in CONDITIONS:
            subset = [item for item in summary["agent_results"] if item["agent"] == agent and item["condition"] == condition]
            usage = [item.get("usage", {}) for item in subset]
            rows[(agent, condition)] = {
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
                "mcp_calls": sum(float(item.get("mcp_call_count") or 0) for item in subset),
            }
    for condition in CONDITIONS:
        codex = rows[("codex", condition)]
        uncached_input = max(0, codex["input"] - codex["cached"])
        codex["estimated_cost"] = (
            uncached_input * 5 / 1_000_000
            + codex["cached"] * 0.5 / 1_000_000
            + codex["output"] * 30 / 1_000_000
        )
    return rows


def generate_pdf(summary: dict[str, Any], output_path: Path) -> None:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    sf_mono = Path("/System/Library/Fonts/SFNSMono.ttf")
    mono = "Courier"
    if sf_mono.exists():
        try:
            pdfmetrics.registerFont(TTFont("SFMono", str(sf_mono)))
            mono = "SFMono"
        except Exception:
            pass

    W, H = A4
    M = 44
    bg = colors.HexColor("#F5F5F5")
    surface = colors.HexColor("#FFFFFF")
    border = colors.HexColor("#CCCCCC")
    black = colors.HexColor("#000000")
    muted = colors.HexColor("#666666")
    red = colors.HexColor("#D71921")
    green = colors.HexColor("#4A9E5C")
    orange = colors.HexColor("#C86B1D")
    blue = colors.HexColor("#3A6EA5")

    rows = usage_rows(summary)
    total_runs = len(summary["agent_results"])
    total_passed = sum(1 for item in summary["agent_results"] if item.get("tests_passed"))
    claude_saved = rows[("claude", "without-mcp")]["cost"] - rows[("claude", "with-mcp")]["cost"]
    codex_saved = rows[("codex", "without-mcp")]["estimated_cost"] - rows[("codex", "with-mcp")]["estimated_cost"]
    prompt_generation_input_tokens = float(os.environ.get("PRMPT_MCP_PROMPT_INPUT_TOKENS", "48962"))
    prompt_generation_output_tokens = float(os.environ.get("PRMPT_MCP_PROMPT_OUTPUT_TOKENS", "2461"))
    prompt_generation_cost = (
        prompt_generation_input_tokens * 0.80 / 1_000_000
        + prompt_generation_output_tokens * 4.00 / 1_000_000
    )
    net_claude_saved = claude_saved - prompt_generation_cost
    net_codex_saved = codex_saved - prompt_generation_cost
    total_mcp_calls = rows[("claude", "with-mcp")]["mcp_calls"] + rows[("codex", "with-mcp")]["mcp_calls"]

    c = canvas.Canvas(str(output_path), pagesize=A4)

    def frame(section: str) -> None:
        c.setFillColor(bg)
        c.rect(0, 0, W, H, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#DDDDDD"))
        for dot_x in range(28, int(W), 14):
            for dot_y in range(48, int(H - 48), 14):
                c.circle(dot_x, dot_y, 0.45, fill=1, stroke=0)
        c.setStrokeColor(border)
        c.rect(26, 26, W - 52, H - 52, fill=0, stroke=1)
        c.line(M, H - 36, W - M, H - 36)
        c.line(M, 36, W - M, 36)
        c.setFillColor(muted)
        c.setFont(mono, 8)
        c.drawString(M, H - 25, "PRMPT MCP BENCHMARK REPORT")
        c.drawRightString(W - M, H - 25, section.upper())

    def card(x: float, y: float, w: float, title: str, value: str, note: str, color=black) -> None:
        c.setFillColor(surface)
        c.setStrokeColor(border)
        c.roundRect(x, y - 82, w, 82, 6, fill=1, stroke=1)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawString(x + 12, y - 18, title.upper())
        c.setFillColor(color)
        c.setFont("Courier-Bold", 23)
        c.drawString(x + 12, y - 49, value)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawString(x + 12, y - 68, note.upper())

    def fmt_num(value: float) -> str:
        return f"{value:,.0f}"

    def metric(y: float, label: str, without: float, with_mcp: float, formatter, lower=True) -> float:
        max_v = max(without, with_mcp, 1)
        delta = without - with_mcp if lower else with_mcp - without
        pct = delta / max(without, 1) * 100
        color = green if delta > 0 else red
        c.setFillColor(black)
        c.setFont("Courier-Bold", 10)
        c.drawString(M, y, label)
        c.setFillColor(color)
        c.setFont(mono, 7)
        c.drawString(M, y - 13, f"{abs(pct):.1f}% {'SAVED' if delta > 0 else 'INCREASED'}")
        x0 = M + 220
        bw = 205
        c.setFillColor(colors.HexColor("#E0E0E0"))
        c.rect(x0, y + 2, bw, 9, fill=1, stroke=0)
        c.rect(x0, y - 16, bw, 9, fill=1, stroke=0)
        c.setFillColor(red)
        c.rect(x0, y + 2, bw * without / max_v, 9, fill=1, stroke=0)
        c.setFillColor(black)
        c.rect(x0, y - 16, bw * with_mcp / max_v, 9, fill=1, stroke=0)
        c.setFont(mono, 8)
        c.setFillColor(red)
        c.drawString(x0 - 82, y + 1, "WITHOUT")
        c.setFillColor(black)
        c.drawString(x0 - 82, y - 17, "WITH MCP")
        c.drawRightString(W - M, y + 1, formatter(without))
        c.drawRightString(W - M, y - 17, formatter(with_mcp))
        return y - 52

    frame("cost + token comparison")
    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "MCP VS")
    c.drawString(M, H - 134, "NO MCP")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 156, "[CLAUDE CODE + CODEX]  REAL PROMPT MCP SERVER CONNECTED")
    y = H - 198
    card(M, y, 150, "Runs Passed", f"{total_passed}/{total_runs}", "npm test verified", green if total_passed == total_runs else red)
    card(M + 165, y, 150, "Claude Net", f"${net_claude_saved:.3f}", "after prompt cost", green if net_claude_saved > 0 else red)
    card(M + 330, y, 150, "Codex Net", f"${net_codex_saved:.3f}", "est after prompt", green if net_codex_saved > 0 else red)
    y = H - 325
    y = metric(y, "Claude agent cost USD", rows[("claude", "without-mcp")]["cost"], rows[("claude", "with-mcp")]["cost"], lambda v: f"${v:.3f}")
    y = metric(y, "Claude input/context tokens", rows[("claude", "without-mcp")]["input"], rows[("claude", "with-mcp")]["input"], fmt_num)
    y = metric(y, "Codex estimated cost USD", rows[("codex", "without-mcp")]["estimated_cost"], rows[("codex", "with-mcp")]["estimated_cost"], lambda v: f"${v:.3f}")
    y = metric(y, "Codex input tokens", rows[("codex", "without-mcp")]["input"], rows[("codex", "with-mcp")]["input"], fmt_num)
    c.setFillColor(surface)
    c.setStrokeColor(border)
    c.roundRect(M, y - 52, W - 2 * M, 52, 6, fill=1, stroke=1)
    c.setFillColor(black)
    c.setFont(mono, 8)
    c.drawString(M + 12, y - 18, f"PROMPT GENERATION OVERHEAD: ${prompt_generation_cost:.3f}  ({fmt_num(prompt_generation_input_tokens)} IN / {fmt_num(prompt_generation_output_tokens)} OUT TOKENS)")
    c.setFillColor(muted)
    c.drawString(M + 12, y - 35, f"MCP TOOL CALLS VERIFIED: {fmt_num(total_mcp_calls)} WITH-MCP CALLS, 0 WITHOUT-MCP CALLS.")
    c.setFillColor(muted)
    c.setFont(mono, 7)
    c.drawString(M, 62, f"RUN: {summary['run_id']}  |  REPOS: 3  |  PROMPTS: 9  |  AGENT ATTEMPTS: {total_runs}")
    c.drawString(M, 50, "WITH-MCP USES A REAL STDIO MCP SERVER; WITHOUT-MCP HAS NO MCP CONFIG")

    c.showPage()
    frame("mcp setup")
    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "MCP")
    c.drawString(M, H - 134, "SETUP")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 156, "[WHAT THE AGENTS COULD CALL]")
    y = H - 205
    for title, body, color in [
        ("prmpt_optimize_task", "Returns a scoped task prompt with exact files/functions and test-first instructions.", red),
        ("prmpt_retrieve_context", "Returns only the relevant file/function pointers for the task.", black),
        ("prmpt_get_test_plan", "Returns the minimal npm-test-first workflow.", blue),
    ]:
        c.setFillColor(surface)
        c.setStrokeColor(border)
        c.roundRect(M, y - 74, W - 2 * M, 74, 8, fill=1, stroke=1)
        c.setFillColor(color)
        c.setFont("Courier-Bold", 13)
        c.drawString(M + 14, y - 24, title)
        c.setFillColor(black)
        c.setFont(mono, 9)
        c.drawString(M + 14, y - 48, body)
        y -= 92
    c.setFillColor(muted)
    c.setFont(mono, 8)
    c.drawString(M, 58, "CLAUDE USED --MCP-CONFIG + --STRICT-MCP-CONFIG. CODEX USED PROJECT .CODEX/CONFIG.TOML.")

    c.showPage()
    frame("tests")
    c.setFillColor(black)
    c.setFont("Courier-Bold", 34)
    c.drawString(M, H - 92, "TESTS")
    c.setFillColor(red)
    c.setFont(mono, 9)
    c.drawString(M, H - 116, "[REPOS + USER PROMPTS USED]")
    y = H - 160
    for repo_name, meta in summary["repo_meta"].items():
        c.setFillColor(black)
        c.setFont("Courier-Bold", 15)
        c.drawString(M, y, repo_name)
        c.setFillColor(muted)
        c.setFont(mono, 7)
        c.drawRightString(W - M, y, f"{meta['lines']:,} LINES")
        y -= 22
        for idx, prompt in enumerate(meta["prompts"], 1):
            c.setFillColor(red)
            c.setFont(mono, 8)
            c.drawString(M + 10, y, f"P{idx}")
            c.setFillColor(black)
            c.setFont(mono, 9)
            c.drawString(M + 42, y, prompt[:96])
            y -= 18
        y -= 16
    c.save()


async def main() -> int:
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S-mcp")
    run_dir = RUNS_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    write_json(run_dir / "run_config.json", {
        "run_id": run_id,
        "created_at": now_iso(),
        "repos": {k: {"path": str(v["path"]), "prompts": v["prompts"]} for k, v in REPOS.items()},
        "agents": AGENTS,
        "conditions": CONDITIONS,
        "mcp_server": str(MCP_SERVER),
        "agent_timeout_seconds": base.AGENT_TIMEOUT_SECONDS,
    })

    for spec in REPOS.values():
        base.ensure_clean_worktree(spec["path"])

    indexed = []
    for repo_name, spec in REPOS.items():
        print(f"[index] {repo_name}", flush=True)
        indexed.append(await base.index_repo(run_dir, repo_name, spec["path"]))
        write_json(run_dir / "indexed_projects.json", [i.__dict__ for i in indexed])

    optimized: list[dict[str, Any]] = []
    for project in indexed:
        for index, prompt in enumerate(REPOS[project.repo]["prompts"], 1):
            prompt_id = f"p{index}"
            print(f"[optimize] {project.repo} {prompt_id}", flush=True)
            try:
                optimized.append(await base.optimize_prompt(run_dir, project, prompt_id, prompt))
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

    optimized_by_repo: dict[str, list[dict[str, Any]]] = {}
    optimized_lookup: dict[tuple[str, str], dict[str, Any]] = {}
    for item in optimized:
        optimized_by_repo.setdefault(item["repo"], []).append(item)
        optimized_lookup[(item["repo"], item["prompt_id"])] = item

    agent_results: list[dict[str, Any]] = []
    for repo_name, spec in REPOS.items():
        for prompt_index, generic_prompt in enumerate(spec["prompts"], 1):
            prompt_id = f"p{prompt_index}"
            for agent in AGENTS:
                for condition in CONDITIONS:
                    print(f"[agent] {repo_name} {prompt_id} {agent} {condition}", flush=True)
                    try:
                        result = run_agent(
                            run_dir,
                            repo_name,
                            spec["path"],
                            agent,
                            condition,
                            prompt_id,
                            generic_prompt,
                            optimized_by_repo.get(repo_name, []),
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
                            "mcp_call_count": 0,
                            "mcp_tools": [],
                        }
                    agent_results.append(result)
                    write_json(run_dir / "agent_results.json", agent_results)

    summary = summarize_results(run_dir, indexed, optimized, agent_results)
    generate_pdf(summary, run_dir / "mcp-benchmark-report.pdf")
    print(f"[done] {run_dir}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
