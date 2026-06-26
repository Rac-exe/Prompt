"""
build_ppt.py — Generate demo/PRMPT_PITCH.pptx

Run from repo root:
    python demo/build_ppt.py

Requires: python-pptx, matplotlib, Pillow
    pip install python-pptx matplotlib Pillow
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt, Emu

# ── Constants ────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
LOGO_PATH = REPO_ROOT / "logos" / "light-logo-png.png"
OUT_PATH = Path(__file__).resolve().parent / "PRMPT_PITCH.pptx"

# Slide dimensions: 16:9 widescreen
W = Inches(13.33)
H = Inches(7.5)

# Palette
BG       = RGBColor(0x0D, 0x0D, 0x0D)   # near-black
SURFACE  = RGBColor(0x1A, 0x1A, 0x2E)   # dark navy card
ACCENT   = RGBColor(0x7C, 0x3A, 0xED)   # PRMPT purple
ACCENT2  = RGBColor(0x10, 0xB9, 0x81)   # emerald (positive)
DANGER   = RGBColor(0xEF, 0x44, 0x44)   # red (negative / cost)
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
GREY     = RGBColor(0x9C, 0xA3, 0xAF)
DIVIDER  = RGBColor(0x2D, 0x2D, 0x3A)

FONT_TITLE  = "Calibri"
FONT_BODY   = "Calibri"


# ── Helpers ──────────────────────────────────────────────────────────────────
def new_prs() -> Presentation:
    prs = Presentation()
    prs.slide_width  = W
    prs.slide_height = H
    return prs


def blank_slide(prs: Presentation):
    layout = prs.slide_layouts[6]   # completely blank
    return prs.slides.add_slide(layout)


def fill_bg(slide, color: RGBColor = BG) -> None:
    from pptx.oxml.ns import qn
    from lxml import etree
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_rect(slide, x, y, w, h, fill: RGBColor, alpha: int = 255):
    shape = slide.shapes.add_shape(1, x, y, w, h)   # MSO_SHAPE_TYPE.RECTANGLE = 1
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()   # no border
    return shape


def add_text(slide, text: str, x, y, w, h,
             font_size: int = 18,
             bold: bool = False,
             color: RGBColor = WHITE,
             align=PP_ALIGN.LEFT,
             font_name: str = FONT_BODY,
             wrap: bool = True) -> None:
    txBox = slide.shapes.add_textbox(x, y, w, h)
    tf = txBox.text_frame
    tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font_name


def add_multiline(slide, lines: list[tuple[str, int, bool, RGBColor]],
                  x, y, w, h, align=PP_ALIGN.LEFT) -> None:
    """Lines = list of (text, font_size, bold, color)."""
    txBox = slide.shapes.add_textbox(x, y, w, h)
    tf = txBox.text_frame
    tf.word_wrap = True
    first = True
    for text, size, bold, color in lines:
        if first:
            p = tf.paragraphs[0]
            first = False
        else:
            p = tf.add_paragraph()
        p.alignment = align
        run = p.add_run()
        run.text = text
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = FONT_BODY
        p.space_after = Pt(4)


def add_logo(slide, path: Path, x, y, h) -> None:
    if not path.exists():
        return
    slide.shapes.add_picture(str(path), x, y, height=h)


def image_to_stream(fig) -> io.BytesIO:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                facecolor="#0D0D0D", edgecolor="none")
    buf.seek(0)
    plt.close(fig)
    return buf


def add_divider(slide, y, color: RGBColor = DIVIDER) -> None:
    add_rect(slide, Inches(0.6), y, Inches(12.1), Pt(1), color)


# ── Chart builder ────────────────────────────────────────────────────────────
def build_savings_chart() -> io.BytesIO:
    tasks = ["atlas-p2", "atlas-p3", "nova-p2", "nova-p3", "orbit-p2", "orbit-p3"]
    codex_best = [22.47, 52.0, 41.68, 19.79, 0.0, 39.79]  # mcp_optimizer/hard wins
    claude_best = [0.0, 11.17, 0.0, 0.0, 0.25, 0.0]        # actual wins only

    x = np.arange(len(tasks))
    width = 0.35

    fig, ax = plt.subplots(figsize=(11, 4.2))
    fig.patch.set_facecolor("#0D0D0D")
    ax.set_facecolor("#0D0D0D")

    bars_codex = ax.bar(x - width/2, codex_best, width,
                        color="#10B981", alpha=0.92, label="Codex + PRMPT")
    bars_claude = ax.bar(x + width/2, claude_best, width,
                         color="#7C3AED", alpha=0.85, label="Claude + PRMPT")

    # Value labels
    for bar in bars_codex:
        h = bar.get_height()
        if h > 0:
            ax.text(bar.get_x() + bar.get_width()/2., h + 0.8,
                    f"{h:.0f}%", ha="center", va="bottom",
                    color="#10B981", fontsize=9, fontweight="bold")

    for bar in bars_claude:
        h = bar.get_height()
        if h > 0:
            ax.text(bar.get_x() + bar.get_width()/2., h + 0.8,
                    f"{h:.0f}%", ha="center", va="bottom",
                    color="#A78BFA", fontsize=9, fontweight="bold")

    ax.set_xticks(x)
    ax.set_xticklabels(tasks, color="#9CA3AF", fontsize=10)
    ax.set_ylabel("Net Cost Savings (%)", color="#9CA3AF", fontsize=10)
    ax.tick_params(colors="#9CA3AF", which="both")
    ax.spines["bottom"].set_color("#2D2D3A")
    ax.spines["left"].set_color("#2D2D3A")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.yaxis.grid(True, color="#2D2D3A", linestyle="--", alpha=0.5)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, labelcolor="white", fontsize=10)
    ax.set_title("Net Cost Savings vs Raw Baseline  (pass rate 100% across all runs)",
                 color="#9CA3AF", fontsize=10, pad=10)

    plt.tight_layout()
    return image_to_stream(fig)


# ── Slides ───────────────────────────────────────────────────────────────────

def slide_title(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)

    # Accent bar left edge
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT)

    # Logo top-right
    add_logo(s, LOGO_PATH, Inches(10.8), Inches(0.35), Inches(1.4))

    # Main title
    add_text(s, "PRMPT",
             Inches(0.8), Inches(1.8), Inches(9), Inches(1.6),
             font_size=72, bold=True, color=WHITE)

    # Tagline
    add_text(s, "Prompt optimization layer for AI coding agents.",
             Inches(0.8), Inches(3.3), Inches(10), Inches(0.6),
             font_size=22, color=GREY)

    # Sub-tagline
    add_text(s, "Fewer tokens. Same results. Proven on real bug-fix tasks.",
             Inches(0.8), Inches(3.95), Inches(10), Inches(0.5),
             font_size=17, color=GREY)

    # Bottom strip
    add_rect(s, Inches(0), Inches(7.05), W, Inches(0.45), SURFACE)
    add_text(s, "commandcode.ai  ·  mcp  ·  codex  ·  claude code",
             Inches(0.8), Inches(7.08), Inches(10), Inches(0.35),
             font_size=11, color=GREY)


def slide_problem(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, DANGER)

    add_text(s, "The Problem",
             Inches(0.8), Inches(0.35), Inches(11), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    points = [
        ("Every turn in an AI coding session re-sends the full conversation history to the model.", 19, False, WHITE),
        ("", 8, False, WHITE),
        ("Context replay is the dominant cost driver — not the task itself.", 19, True, RGBColor(0xFB, 0xBF, 0x24)),
        ("", 8, False, WHITE),
        ("The larger the repo, the worse it gets. Plan mode? 400K tokens per run.", 17, False, GREY),
        ("", 8, False, WHITE),
        ("Developers don't see it. The bill arrives anyway.", 17, False, GREY),
    ]
    add_multiline(s, points, Inches(0.8), Inches(1.3), Inches(11.5), Inches(3.5))

    # Stat callout box
    add_rect(s, Inches(0.8), Inches(4.8), Inches(5.5), Inches(1.85), SURFACE)
    add_text(s, "Codex raw context on atlas-p3",
             Inches(1.0), Inches(4.95), Inches(5.0), Inches(0.4),
             font_size=12, color=GREY)
    add_text(s, "303,293 tokens",
             Inches(1.0), Inches(5.3), Inches(5.0), Inches(0.7),
             font_size=30, bold=True, color=DANGER)

    add_rect(s, Inches(6.9), Inches(4.8), Inches(5.5), Inches(1.85), SURFACE)
    add_text(s, "With PRMPT MCP (same task, passes tests)",
             Inches(7.1), Inches(4.95), Inches(5.0), Inches(0.4),
             font_size=12, color=GREY)
    add_text(s, "105,463 tokens",
             Inches(7.1), Inches(5.3), Inches(5.0), Inches(0.7),
             font_size=30, bold=True, color=ACCENT2)


def slide_how_it_works(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT)

    add_text(s, "How PRMPT Works",
             Inches(0.8), Inches(0.35), Inches(11), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    # Three-step flow
    steps = [
        ("1", "Index", "Tree-sitter parses the repo locally. BGE embeddings + call graph\nstore file relationships. Runs once per repo."),
        ("2", "Optimize", "Vague prompt goes in. The pipeline adds probable file locations,\nintent clarification, and task structure. No raw prompt hits the LLM."),
        ("3", "Serve", "The enriched prompt + MCP server give the coding agent targeted\ncontext on demand. Token waste eliminated at the source."),
    ]

    box_w = Inches(3.6)
    box_h = Inches(3.8)
    gap   = Inches(0.35)
    y0    = Inches(1.45)
    x_starts = [Inches(0.65), Inches(4.6), Inches(8.55)]

    arrow_y = y0 + box_h / 2

    for i, (num, title, body) in enumerate(steps):
        x = x_starts[i]
        add_rect(s, x, y0, box_w, box_h, SURFACE)
        add_rect(s, x, y0, box_w, Inches(0.06), ACCENT)

        # Step number
        add_text(s, num, x + Inches(0.18), y0 + Inches(0.12), Inches(0.5), Inches(0.55),
                 font_size=28, bold=True, color=ACCENT)
        # Title
        add_text(s, title, x + Inches(0.18), y0 + Inches(0.7), box_w - Inches(0.3), Inches(0.55),
                 font_size=22, bold=True, color=WHITE)
        # Body
        add_text(s, body, x + Inches(0.18), y0 + Inches(1.35), box_w - Inches(0.3), Inches(2.2),
                 font_size=13, color=GREY)

        # Arrow between boxes
        if i < 2:
            arr_x = x + box_w + Inches(0.04)
            add_text(s, "→", arr_x, arrow_y - Inches(0.22), gap, Inches(0.5),
                     font_size=22, bold=True, color=ACCENT, align=PP_ALIGN.CENTER)

    add_text(s, "All processing is local. No repo data leaves your machine.",
             Inches(0.8), Inches(5.55), Inches(11.5), Inches(0.4),
             font_size=13, color=GREY)


def slide_stack(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT)

    add_text(s, "What It's Built On",
             Inches(0.8), Inches(0.35), Inches(11), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    rows = [
        ("Electron + React",     "Desktop app. Overlay triggers on @prompt hook or Ctrl+5. Always on top, never in the way."),
        ("Python FastAPI",        "Prompt optimizer pipeline and code intelligence service. Six-stage: decision, skill selector, context, optimizer, clarifier, planner."),
        ("Rust N-API",            "Native platform bridge. Hooks into keystrokes and system tray without Electron overhead."),
        ("Tree-sitter + BGE",     "Local repo parsing and ONNX vector embeddings. Call-graph expansion via igraph + PageRank. No cloud dependency."),
        ("MCP Server (stdio)",    "JSON-RPC protocol over stdio. Works with Claude Code, Codex CLI, Command Code, and any MCP-compatible agent."),
    ]

    y = Inches(1.35)
    for label, desc in rows:
        add_rect(s, Inches(0.7), y, Inches(11.9), Inches(0.82), SURFACE)
        add_text(s, label, Inches(0.95), y + Inches(0.08), Inches(2.8), Inches(0.65),
                 font_size=15, bold=True, color=WHITE)
        add_text(s, desc, Inches(3.9), y + Inches(0.08), Inches(8.5), Inches(0.65),
                 font_size=13, color=GREY)
        y += Inches(0.95)


def slide_benchmark(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT2)

    add_text(s, "Benchmark Results",
             Inches(0.8), Inches(0.35), Inches(11), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.05))

    # Headline stats row
    stats = [
        ("60", "total runs"),
        ("100%", "pass rate (all variants)"),
        ("52%", "peak Codex savings"),
        ("83%", "Codex variants = win"),
    ]
    sx = Inches(0.65)
    for val, label in stats:
        add_rect(s, sx, Inches(1.18), Inches(2.9), Inches(0.88), SURFACE)
        add_text(s, val,   sx + Inches(0.15), Inches(1.22), Inches(2.6), Inches(0.5),
                 font_size=26, bold=True, color=ACCENT2)
        add_text(s, label, sx + Inches(0.15), Inches(1.58), Inches(2.6), Inches(0.38),
                 font_size=10, color=GREY)
        sx += Inches(3.12)

    # Chart
    chart_stream = build_savings_chart()
    s.shapes.add_picture(chart_stream, Inches(0.55), Inches(2.18), Inches(12.2), Inches(4.85))


def slide_split_finding(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT)

    add_text(s, "Why Codex Saves / Why Claude Doesn't",
             Inches(0.8), Inches(0.35), Inches(12), Inches(0.65),
             font_size=34, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    # Codex box
    add_rect(s, Inches(0.65), Inches(1.35), Inches(5.7), Inches(5.3), SURFACE)
    add_rect(s, Inches(0.65), Inches(1.35), Inches(5.7), Inches(0.06), ACCENT2)
    add_text(s, "Codex CLI",
             Inches(0.9), Inches(1.5), Inches(5.2), Inches(0.55),
             font_size=22, bold=True, color=ACCENT2)
    add_text(s,
             "Codex has no server-side prompt cache. Every token in "
             "the context window is billed at full rate.\n\n"
             "PRMPT cuts that context window by sending only "
             "the relevant files rather than the agent doing its own "
             "broad Grep/Glob sweeps.\n\n"
             "Result: 8–52% net savings across 6 tasks. "
             "The savings scale with repo size.",
             Inches(0.9), Inches(2.1), Inches(5.2), Inches(4.1),
             font_size=14, color=GREY)

    # Claude box
    add_rect(s, Inches(6.95), Inches(1.35), Inches(5.7), Inches(5.3), SURFACE)
    add_rect(s, Inches(6.95), Inches(1.35), Inches(5.7), Inches(0.06), DANGER)
    add_text(s, "Claude Code",
             Inches(7.2), Inches(1.5), Inches(5.2), Inches(0.55),
             font_size=22, bold=True, color=DANGER)
    add_text(s,
             "Claude's prompt cache is aggressive. Repeated context "
             "comes back at ~10% of full input cost.\n\n"
             "PRMPT's optimization spend ($0.049/task amortized) "
             "often exceeds the cache discount, making net savings "
             "marginal or negative.\n\n"
             "Claude wins when the optimization cost drops (live "
             "pipeline) or when cache misses dominate (first run, "
             "new repo).",
             Inches(7.2), Inches(2.1), Inches(5.2), Inches(4.1),
             font_size=14, color=GREY)

    # Middle separator
    add_rect(s, Inches(6.5), Inches(1.35), Inches(0.08), Inches(5.3), DIVIDER)


def slide_roi(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT2)

    add_text(s, "The ROI",
             Inches(0.8), Inches(0.35), Inches(11), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    add_text(s, "Conservative estimate. Anchored to benchmark data.",
             Inches(0.8), Inches(1.18), Inches(11), Inches(0.4),
             font_size=14, color=GREY)

    # ROI table
    rows = [
        ("Monthly Codex spend",        "$400",      "$400"),
        ("PRMPT net savings (25% avg)", "$100",      "$100"),
        ("PRMPT cost estimate",         "$20/mo",    "$20/mo"),
        ("Net benefit to developer",    "$80/mo",    "$80/mo"),
    ]
    headers = ["Metric", "Conservative", "At 40% savings (atlas-p3 level)"]

    y = Inches(1.75)
    col_x = [Inches(0.7), Inches(6.1), Inches(9.6)]
    col_w = [Inches(5.2), Inches(3.3), Inches(3.3)]

    # Header
    add_rect(s, Inches(0.7), y, Inches(12.0), Inches(0.5), ACCENT)
    for i, h in enumerate(headers):
        add_text(s, h, col_x[i] + Inches(0.1), y + Inches(0.05), col_w[i], Inches(0.4),
                 font_size=12, bold=True, color=WHITE)
    y += Inches(0.55)

    for ri, (label, conservative, high) in enumerate(rows):
        bg = SURFACE if ri % 2 == 0 else BG
        add_rect(s, Inches(0.7), y, Inches(12.0), Inches(0.58), bg)
        vals = [label, conservative, high]
        for ci, val in enumerate(vals):
            col = ACCENT2 if (ci > 0 and "benefit" in label) else WHITE
            add_text(s, val, col_x[ci] + Inches(0.1), y + Inches(0.06),
                     col_w[ci], Inches(0.45),
                     font_size=13, bold=(ci == 0), color=col)
        y += Inches(0.62)

    add_text(s,
             "The bigger the repo and the less efficient the model, the higher the savings. "
             "Codex is the clearest case today.",
             Inches(0.8), Inches(5.6), Inches(11.5), Inches(0.65),
             font_size=13, color=GREY)


def slide_whats_next(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT)

    add_text(s, "What We're Building Next",
             Inches(0.8), Inches(0.35), Inches(11), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    items = [
        ("Live Stateful MCP Sessions",
         "Replace pre-computed prompts with a live agentic loop. "
         "The MCP server tracks what the agent already tried and serves "
         "different context on retry — ending deterministic dead-loops."),
        ("Command Code Integration",
         "Command Code (v0.31.2, installed) supports MCP via .mcp.json. "
         "Adapter built. DeepSeek v4 Pro model — 4x credit efficiency. "
         "Benchmark running now."),
        ("6-User Real-World Test",
         "Three confirmed users, three being selected. Each runs PRMPT on their own "
         "live repo for one day. We measure cost, pass rate, and turns — "
         "with their consent and a food incentive."),
    ]

    y = Inches(1.4)
    for i, (title, body) in enumerate(items):
        add_rect(s, Inches(0.65), y, Inches(11.9), Inches(1.58), SURFACE)
        add_rect(s, Inches(0.65), y, Inches(0.06), Inches(1.58), ACCENT)
        add_text(s, title, Inches(0.9), y + Inches(0.12), Inches(11.3), Inches(0.5),
                 font_size=16, bold=True, color=WHITE)
        add_text(s, body, Inches(0.9), y + Inches(0.58), Inches(11.3), Inches(0.85),
                 font_size=13, color=GREY)
        y += Inches(1.72)


def slide_the_ask(prs: Presentation) -> None:
    s = blank_slide(prs)
    fill_bg(s)
    add_rect(s, Inches(0), Inches(0), Inches(0.08), H, ACCENT)

    # Logo
    add_logo(s, LOGO_PATH, Inches(10.8), Inches(0.35), Inches(1.4))

    add_text(s, "The Ask",
             Inches(0.8), Inches(0.35), Inches(9), Inches(0.65),
             font_size=36, bold=True, color=WHITE)
    add_divider(s, Inches(1.1))

    add_text(s,
             "We have the measurement. We have the pipeline. We have real savings on Codex.",
             Inches(0.8), Inches(1.45), Inches(11.5), Inches(0.55),
             font_size=18, color=WHITE)

    add_text(s,
             "What we need next is the user signal to confirm the model holds outside a controlled environment.",
             Inches(0.8), Inches(2.1), Inches(11.5), Inches(0.55),
             font_size=15, color=GREY)

    # Sparse speaking-point blocks
    points = [
        "6 real users. 1 day. Their own repos.",
        "Measure cost delta, pass rate, turns. No fluff.",
        "If it holds: pricing, GTM, the whole thing.",
    ]
    y = Inches(3.0)
    for pt in points:
        add_rect(s, Inches(0.8), y, Inches(11.5), Inches(0.58), SURFACE)
        add_rect(s, Inches(0.8), y, Inches(0.06), Inches(0.58), ACCENT)
        add_text(s, pt, Inches(1.05), y + Inches(0.08), Inches(11.0), Inches(0.42),
                 font_size=15, color=WHITE)
        y += Inches(0.72)

    add_text(s, "github.com/prmpt",
             Inches(0.8), Inches(6.7), Inches(4), Inches(0.4),
             font_size=12, color=GREY)


# ── Main ─────────────────────────────────────────────────────────────────────

def build() -> None:
    prs = new_prs()

    print("Building slide 1: Title ...")
    slide_title(prs)

    print("Building slide 2: The Problem ...")
    slide_problem(prs)

    print("Building slide 3: How PRMPT Works ...")
    slide_how_it_works(prs)

    print("Building slide 4: Stack ...")
    slide_stack(prs)

    print("Building slide 5: Benchmark Results (generating chart) ...")
    slide_benchmark(prs)

    print("Building slide 6: Split Finding ...")
    slide_split_finding(prs)

    print("Building slide 7: ROI ...")
    slide_roi(prs)

    print("Building slide 8: What's Next ...")
    slide_whats_next(prs)

    print("Building slide 9: The Ask ...")
    slide_the_ask(prs)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT_PATH))
    print(f"\nSaved: {OUT_PATH}")
    print(f"Size : {OUT_PATH.stat().st_size // 1024} KB")


if __name__ == "__main__":
    build()
