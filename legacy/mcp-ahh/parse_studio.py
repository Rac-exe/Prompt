"""
parse_studio.py — assigns each Studio LLM call to its benchmark run,
computes per-run token & cost totals, and prints JSON for the Canvas.
"""
from __future__ import annotations
import json

# ── Benchmark run schedule ─────────────────────────────────────────────────
# Start: 2026-06-18 16:27:29 local (UTC+5:30)
# Wall-clock seconds per run (in order)
RUNS = [
    ("orbit-p1", "raw",  695.8),
    ("orbit-p1", "mcp",  145.1),
    ("orbit-p2", "raw",  537.9),
    ("orbit-p2", "mcp",  214.5),
    ("orbit-p3", "raw",  248.9),
    ("orbit-p3", "mcp",  174.1),
    ("atlas-p1", "raw",  209.4),
    ("atlas-p1", "mcp",   70.6),
    ("atlas-p2", "raw",  478.6),
    ("atlas-p2", "mcp",  128.9),
    ("atlas-p3", "raw",  282.4),
    ("atlas-p3", "mcp",  139.9),
    ("nova-p1",  "raw",   83.7),
    ("nova-p1",  "mcp",  215.2),
    ("nova-p2",  "raw",  387.6),
    ("nova-p2",  "mcp",  163.5),
    ("nova-p3",  "raw",  292.2),
    ("nova-p3",  "mcp",  282.2),
]

BASE_SEC = 16*3600 + 27*60 + 29   # 16:27:29 in seconds from midnight

def build_windows():
    windows = []
    t = BASE_SEC
    for task, variant, dur in RUNS:
        windows.append((task, variant, t, t + dur + 30))  # +30s buffer
        t += dur
    return windows

WINDOWS = build_windows()

def ts_to_sec(ts: str) -> int:
    """'4:28:15 PM' -> seconds from midnight"""
    time_part, ampm = ts.rsplit(" ", 1)
    h, m, s = map(int, time_part.split(":"))
    if ampm == "PM" and h != 12:
        h += 12
    if ampm == "AM" and h == 12:
        h = 0
    return h*3600 + m*60 + s

def assign_run(sec: int) -> int | None:
    for i, (task, variant, t0, t1) in enumerate(WINDOWS):
        if t0 <= sec <= t1:
            return i
    return None

# ── Studio rows (all pages, newest-first as pasted) ────────────────────────
# Format: (timestamp_str, cost_usd, input_tok, output_tok, mode)
RAW_ROWS = [
    # ── Page 1 ──────────────────────────────────────────────────────────────
    ("Jun 18, 4:43:30 PM", 0.000500,  5245,  195, "custom-agent"),
    ("Jun 18, 4:43:25 PM", 0.000600,  4689,  369, "custom-agent"),
    ("Jun 18, 4:43:20 PM", 0.000600,  4179,  409, "custom-agent"),
    ("Jun 18, 4:43:15 PM", 0.000400,  3839,   97, "custom-agent"),
    ("Jun 18, 4:43:11 PM", 0.000400,  3328,  262, "custom-agent"),
    ("Jun 18, 4:43:01 PM", 0.000300,  2978,  235, "custom-agent"),
    ("Jun 18, 4:42:57 PM", 0.015700, 38549,  595, "custom-agent"),
    ("Jun 18, 4:42:44 PM", 0.000400,  3717,  276, "custom-agent"),
    ("Jun 18, 4:42:40 PM", 0.000400,  3357,  183, "custom-agent"),
    ("Jun 18, 4:42:36 PM", 0.000300,  2965,  186, "custom-agent"),
    ("Jun 18, 4:42:31 PM", 0.003700, 15166,  304, "agent"),
    ("Jun 18, 4:41:34 PM", 0.001900, 26378, 1193, "agent"),
    ("Jun 18, 4:41:19 PM", 0.002300, 24495,  635, "agent"),
    ("Jun 18, 4:41:08 PM", 0.000600, 20915,  433, "agent"),
    ("Jun 18, 4:40:59 PM", 0.000400, 20740,  250, "agent"),
    ("Jun 18, 4:40:51 PM", 0.000800, 20539,  615, "agent"),
    ("Jun 18, 4:40:42 PM", 0.000600, 20195,  427, "agent"),
    ("Jun 18, 4:40:35 PM", 0.001800, 20031,  395, "agent"),
    ("Jun 18, 4:40:15 PM", 0.000900, 16900,  631, "agent"),
    ("Jun 18, 4:40:06 PM", 0.000700, 16240,  386, "agent"),
    ("Jun 18, 4:39:57 PM", 0.004000, 15630,  478, "agent"),
    ("Jun 18, 4:38:53 PM", 0.001400, 27675, 1295, "agent"),
    ("Jun 18, 4:38:32 PM", 0.000500, 27368,  246, "agent"),
    ("Jun 18, 4:38:22 PM", 0.000900, 26935,  553, "agent"),
    ("Jun 18, 4:38:10 PM", 0.000900, 26367,  633, "agent"),
    ("Jun 18, 4:37:59 PM", 0.000600, 25982,  239, "agent"),
    ("Jun 18, 4:37:50 PM", 0.003200, 25341, 3307, "agent"),
    ("Jun 18, 4:37:07 PM", 0.003400, 24944, 3577, "agent"),
    ("Jun 18, 4:36:26 PM", 0.004400, 24547, 3554, "agent"),
    ("Jun 18, 4:35:39 PM", 0.003600, 21984,  581, "agent"),
    ("Jun 18, 4:35:31 PM", 0.012500, 41077, 2320, "custom-agent"),
    ("Jun 18, 4:35:03 PM", 0.001000, 17174,  210, "custom-agent"),
    ("Jun 18, 4:34:47 PM", 0.000700, 15573,  183, "custom-agent"),
    ("Jun 18, 4:34:43 PM", 0.000600, 14775,  361, "custom-agent"),
    ("Jun 18, 4:34:37 PM", 0.000500, 14265,  325, "custom-agent"),
    ("Jun 18, 4:34:31 PM", 0.000500, 13747,  337, "custom-agent"),
    ("Jun 18, 4:34:14 PM", 0.000800, 13240,  413, "custom-agent"),
    ("Jun 18, 4:34:04 PM", 0.000700, 12303,  414, "custom-agent"),
    ("Jun 18, 4:33:51 PM", 0.000900, 11608,  515, "custom-agent"),
    ("Jun 18, 4:33:43 PM", 0.001300, 10429,  566, "custom-agent"),
    ("Jun 18, 4:33:36 PM", 0.001300,  8751,  764, "custom-agent"),
    ("Jun 18, 4:33:26 PM", 0.000800,  7536,  698, "custom-agent"),
    ("Jun 18, 4:33:18 PM", 0.001000,  7135,  487, "custom-agent"),
    ("Jun 18, 4:33:09 PM", 0.001400,  5818,  766, "custom-agent"),
    ("Jun 18, 4:32:56 PM", 0.000900,  4212,  818, "custom-agent"),
    ("Jun 18, 4:32:39 PM", 0.000500,  3746,  340, "custom-agent"),
    ("Jun 18, 4:32:25 PM", 0.000300,  3398,  142, "custom-agent"),
    ("Jun 18, 4:32:18 PM", 0.000300,  3003,  203, "custom-agent"),
    ("Jun 18, 4:32:08 PM", 0.005300, 83572, 3539, "custom-agent"),
    ("Jun 18, 4:31:24 PM", 0.000500, 79281,  115, "custom-agent"),
    ("Jun 18, 4:31:18 PM", 0.000500, 79109,  143, "custom-agent"),
    ("Jun 18, 4:31:11 PM", 0.013100, 78875,  221, "custom-agent"),
    ("Jun 18, 4:31:03 PM", 0.000500, 49688,  203, "custom-agent"),
    ("Jun 18, 4:30:55 PM", 0.000600, 49437,  173, "custom-agent"),
    ("Jun 18, 4:30:50 PM", 0.000600, 49095,  299, "custom-agent"),
    ("Jun 18, 4:30:42 PM", 0.000600, 48801,  261, "custom-agent"),
    ("Jun 18, 4:30:33 PM", 0.002800, 48482,  265, "custom-agent"),
    ("Jun 18, 4:30:24 PM", 0.001000, 43061,  449, "custom-agent"),
    ("Jun 18, 4:30:12 PM", 0.009200, 42338,  594, "custom-agent"),
    ("Jun 18, 4:29:59 PM", 0.007700, 22569,  451, "custom-agent"),
    ("Jun 18, 4:29:51 PM", 0.000800,  5857,  532, "custom-agent"),
    ("Jun 18, 4:29:44 PM", 0.000600,  5127,  465, "custom-agent"),
    ("Jun 18, 4:29:37 PM", 0.000500,  4781,  105, "custom-agent"),
    ("Jun 18, 4:29:31 PM", 0.000500,  4043,  281, "custom-agent"),
    ("Jun 18, 4:29:20 PM", 0.000500,  3458,  366, "custom-agent"),
    ("Jun 18, 4:29:14 PM", 0.000300,  2996,  206, "custom-agent"),
    ("Jun 18, 4:29:07 PM", 0.001400, 39246, 1179, "custom-agent"),
    ("Jun 18, 4:28:52 PM", 0.015600, 38663,  322, "custom-agent"),
    ("Jun 18, 4:28:41 PM", 0.000500,  3574,  330, "custom-agent"),
    ("Jun 18, 4:28:34 PM", 0.000200,  3272,   60, "custom-agent"),
    ("Jun 18, 4:28:28 PM", 0.000400,  3130,  312, "custom-agent"),
    ("Jun 18, 4:28:23 PM", 0.000200,  2981,  102, "custom-agent"),
    ("Jun 18, 4:28:15 PM", 0.003700, 15157,  384, "agent"),
    # pre-benchmark demo rows (skip)
    ("Jun 18, 4:07:11 PM", 0.000500, 16774,  285, "agent"),  # skip
    ("Jun 18, 4:07:03 PM", 0.000600, 16276,  279, "agent"),  # skip
    # ── Page 2 ──────────────────────────────────────────────────────────────
    ("Jun 18, 5:05:07 PM", 0.001400, 22763, 1064, "agent"),
    ("Jun 18, 5:04:51 PM", 0.000300, 21835,  132, "agent"),
    ("Jun 18, 5:04:46 PM", 0.000400, 21638,  141, "agent"),
    ("Jun 18, 5:04:40 PM", 0.000800, 21143,  433, "agent"),
    ("Jun 18, 5:04:34 PM", 0.001900, 20557, 1993, "agent"),
    ("Jun 18, 5:04:12 PM", 0.001700, 20345,  761, "agent"),
    ("Jun 18, 5:04:00 PM", 0.002300, 18231,  918, "agent"),
    ("Jun 18, 5:03:49 PM", 0.006500, 39768, 2967, "custom-agent"),
    ("Jun 18, 5:03:14 PM", 0.009600, 31042,  249, "custom-agent"),
    ("Jun 18, 5:03:07 PM", 0.001100,  9496,  371, "custom-agent"),
    ("Jun 18, 5:03:00 PM", 0.002300,  7651,  426, "custom-agent"),
    ("Jun 18, 5:02:46 PM", 0.000300,  3431,  139, "custom-agent"),
    ("Jun 18, 5:02:41 PM", 0.000300,  3002,  253, "custom-agent"),
    ("Jun 18, 5:02:34 PM", 0.003500, 15157,  143, "agent"),
    ("Jun 18, 5:01:43 PM", 0.000600, 24946,  375, "agent"),
    ("Jun 18, 5:01:30 PM", 0.000900, 24467,  696, "agent"),
    ("Jun 18, 5:01:18 PM", 0.003100, 23996, 1458, "agent"),
    ("Jun 18, 5:00:59 PM", 0.001400, 20217,  224, "agent"),
    ("Jun 18, 5:00:49 PM", 0.000800, 17704,  613, "agent"),
    ("Jun 18, 5:00:37 PM", 0.000700, 17208,  383, "agent"),
    ("Jun 18, 5:00:27 PM", 0.000600, 16627,  319, "agent"),
    ("Jun 18, 5:00:17 PM", 0.000700, 16321,  353, "agent"),
    ("Jun 18, 5:00:09 PM", 0.000500, 15738,  243, "agent"),
    ("Jun 18, 4:59:50 PM", 0.003800, 15468,  375, "agent"),
    ("Jun 18, 4:58:29 PM", 0.003200, 24709, 3281, "agent"),
    ("Jun 18, 4:57:53 PM", 0.003800, 24353, 2242, "agent"),
    ("Jun 18, 4:57:28 PM", 0.000600, 20542,  320, "agent"),
    ("Jun 18, 4:57:22 PM", 0.002000, 20030, 1596, "agent"),
    ("Jun 18, 4:56:51 PM", 0.001200, 18873,  411, "agent"),
    ("Jun 18, 4:56:46 PM", 0.000700, 17308,  291, "agent"),
    ("Jun 18, 4:56:39 PM", 0.000800, 16556,  527, "agent"),
    ("Jun 18, 4:56:32 PM", 0.000400, 16102,  276, "agent"),
    ("Jun 18, 4:56:27 PM", 0.000600, 15938,  165, "agent"),
    ("Jun 18, 4:56:23 PM", 0.001200,  8995,  874, "custom-agent"),
    ("Jun 18, 4:56:03 PM", 0.000400,  8107,  306, "custom-agent"),
    ("Jun 18, 4:55:58 PM", 0.000300,  7974,  114, "custom-agent"),
    ("Jun 18, 4:55:54 PM", 0.000400,  7631,  177, "custom-agent"),
    ("Jun 18, 4:55:51 PM", 0.000400,  7281,  198, "custom-agent"),
    ("Jun 18, 4:55:44 PM", 0.000500,  6792,  316, "custom-agent"),
    ("Jun 18, 4:55:37 PM", 0.001500,  6344,  307, "custom-agent"),
    ("Jun 18, 4:55:33 PM", 0.000400,  3595,  243, "custom-agent"),
    ("Jun 18, 4:55:18 PM", 0.000200,  3248,  137, "custom-agent"),
    ("Jun 18, 4:55:15 PM", 0.000200,  2992,  123, "custom-agent"),
    ("Jun 18, 4:55:12 PM", 0.003600, 15164,  186, "agent"),
    ("Jun 18, 4:54:23 PM", 0.002400, 28080, 2557, "agent"),
    ("Jun 18, 4:53:51 PM", 0.001800, 27859, 1765, "agent"),
    ("Jun 18, 4:53:30 PM", 0.002200, 27429,  435, "agent"),
    ("Jun 18, 4:53:21 PM", 0.003400, 23635, 2615, "agent"),
    ("Jun 18, 4:52:51 PM", 0.001000, 21306,  643, "agent"),
    ("Jun 18, 4:52:43 PM", 0.001500, 20641,  659, "agent"),
    ("Jun 18, 4:52:25 PM", 0.000600, 18878,  352, "agent"),
    ("Jun 18, 4:51:57 PM", 0.001700, 18316,  620, "agent"),
    ("Jun 18, 4:51:46 PM", 0.000400, 15804,  204, "agent"),
    ("Jun 18, 4:51:42 PM", 0.004000, 15608,  483, "agent"),
    ("Jun 18, 4:50:29 PM", 0.000500, 24030,  216, "agent"),
    ("Jun 18, 4:50:22 PM", 0.000700, 23683,  301, "agent"),
    ("Jun 18, 4:50:16 PM", 0.001000, 23094,  856, "agent"),
    ("Jun 18, 4:49:57 PM", 0.000500, 22765,  222, "agent"),
    ("Jun 18, 4:49:50 PM", 0.001100, 22375,  849, "agent"),
    ("Jun 18, 4:49:38 PM", 0.001300, 21869, 1203, "agent"),
    ("Jun 18, 4:49:21 PM", 0.002800, 21505, 2923, "agent"),
    ("Jun 18, 4:48:48 PM", 0.003000, 21025, 2574, "agent"),
    ("Jun 18, 4:48:15 PM", 0.002500, 19578,  570, "agent"),
    ("Jun 18, 4:48:06 PM", 0.001900, 38753, 1753, "custom-agent"),
    ("Jun 18, 4:47:44 PM", 0.000700, 38169,  414, "custom-agent"),
    ("Jun 18, 4:47:34 PM", 0.004400, 37747,  256, "custom-agent"),
    ("Jun 18, 4:47:27 PM", 0.000300, 28503,  135, "custom-agent"),
    ("Jun 18, 4:47:21 PM", 0.000300, 28226,  106, "custom-agent"),
    ("Jun 18, 4:47:14 PM", 0.001000, 27970,  562, "custom-agent"),
    ("Jun 18, 4:47:04 PM", 0.000700, 27078,  330, "custom-agent"),
    ("Jun 18, 4:46:56 PM", 0.002500, 26417,  391, "custom-agent"),
    ("Jun 18, 4:46:49 PM", 0.003800, 21646,  256, "custom-agent"),
    ("Jun 18, 4:46:40 PM", 0.000800, 13470,  184, "custom-agent"),
    ("Jun 18, 4:46:33 PM", 0.002000, 12130,  228, "custom-agent"),
    ("Jun 18, 4:46:26 PM", 0.000500,  8131,  109, "custom-agent"),
    ("Jun 18, 4:46:22 PM", 0.000400,  7257,  225, "custom-agent"),
    ("Jun 18, 4:46:17 PM", 0.000300,  6853,  179, "custom-agent"),
    ("Jun 18, 4:46:13 PM", 0.000300,  6593,  205, "custom-agent"),
    ("Jun 18, 4:46:08 PM", 0.000400,  6283,  207, "custom-agent"),
    ("Jun 18, 4:46:02 PM", 0.000500,  5879,  260, "custom-agent"),
    ("Jun 18, 4:45:57 PM", 0.000600,  5341,  304, "custom-agent"),
    ("Jun 18, 4:45:50 PM", 0.000300,  4758,  257, "custom-agent"),
    ("Jun 18, 4:45:44 PM", 0.000200,  4497,  152, "custom-agent"),
    ("Jun 18, 4:45:40 PM", 0.000300,  4239,  135, "custom-agent"),
    ("Jun 18, 4:45:37 PM", 0.000300,  3811,  129, "custom-agent"),
    ("Jun 18, 4:45:32 PM", 0.000500,  3542,  251, "custom-agent"),
    ("Jun 18, 4:45:27 PM", 0.000300,  2976,  268, "custom-agent"),
    ("Jun 18, 4:45:20 PM", 0.002800, 80318, 2628, "custom-agent"),
    ("Jun 18, 4:44:48 PM", 0.000900, 79794,  411, "custom-agent"),
    ("Jun 18, 4:44:40 PM", 0.005400, 79398,  303, "custom-agent"),
    ("Jun 18, 4:44:34 PM", 0.001800, 68210,  189, "custom-agent"),
    ("Jun 18, 4:44:27 PM", 0.002000, 65019,  198, "custom-agent"),
    ("Jun 18, 4:44:21 PM", 0.005600, 61380,  275, "custom-agent"),
    ("Jun 18, 4:44:14 PM", 0.002200, 49590,  323, "custom-agent"),
    ("Jun 18, 4:44:08 PM", 0.000700, 45574,  282, "custom-agent"),
    ("Jun 18, 4:44:00 PM", 0.005000, 44902,  350, "custom-agent"),
    ("Jun 18, 4:43:55 PM", 0.000500, 34344,  201, "custom-agent"),
    ("Jun 18, 4:43:50 PM", 0.001800, 33930,  264, "custom-agent"),
    ("Jun 18, 4:43:43 PM", 0.011200, 30506,  397, "custom-agent"),
    ("Jun 18, 4:43:35 PM", 0.000400,  5447,  382, "custom-agent"),
    # ── Page 3 ──────────────────────────────────────────────────────────────
    ("Jun 18, 5:22:51 PM", 0.000400, 16662,  208, "agent"),
    ("Jun 18, 5:22:47 PM", 0.000500, 16399,  227, "agent"),
    ("Jun 18, 5:22:43 PM", 0.000400, 16036,  120, "agent"),
    ("Jun 18, 5:22:39 PM", 0.003800, 15546,  376, "agent"),
    ("Jun 18, 5:21:43 PM", 0.000400, 23335,  155, "agent"),
    ("Jun 18, 5:21:38 PM", 0.000500, 22800,  185, "agent"),
    ("Jun 18, 5:21:33 PM", 0.000700, 22399,  447, "agent"),
    ("Jun 18, 5:21:27 PM", 0.001300, 21974,  960, "agent"),
    ("Jun 18, 5:21:13 PM", 0.000300, 21038,  124, "agent"),
    ("Jun 18, 5:21:10 PM", 0.000600, 20821,  158, "agent"),
    ("Jun 18, 5:21:05 PM", 0.001700, 20021, 1660, "agent"),
    ("Jun 18, 5:20:46 PM", 0.003000, 19693, 2563, "agent"),
    ("Jun 18, 5:20:17 PM", 0.002000, 18211,  571, "agent"),
    ("Jun 18, 5:20:09 PM", 0.004400, 99387, 3062, "custom-agent"),
    ("Jun 18, 5:19:33 PM", 0.027800, 96260,  282, "custom-agent"),
    ("Jun 18, 5:19:22 PM", 0.002200, 33155,  557, "custom-agent"),
    ("Jun 18, 5:19:14 PM", 0.000500, 29573,  326, "custom-agent"),
    ("Jun 18, 5:19:04 PM", 0.000600, 29376,  216, "custom-agent"),
    ("Jun 18, 5:18:55 PM", 0.008000, 28874,  399, "custom-agent"),
    ("Jun 18, 5:18:49 PM", 0.001800, 11189,  818, "custom-agent"),
    ("Jun 18, 5:18:40 PM", 0.001500,  8679,  670, "custom-agent"),
    ("Jun 18, 5:18:33 PM", 0.000600,  6769,  558, "custom-agent"),
    ("Jun 18, 5:18:27 PM", 0.000500,  6287,  351, "custom-agent"),
    ("Jun 18, 5:18:22 PM", 0.000700,  5831,  326, "custom-agent"),
    ("Jun 18, 5:18:17 PM", 0.001000,  4947,  599, "custom-agent"),
    ("Jun 18, 5:18:10 PM", 0.000900,  3917,  786, "custom-agent"),
    ("Jun 18, 5:18:02 PM", 0.000400,  3532,  253, "custom-agent"),
    ("Jun 18, 5:17:57 PM", 0.000200,  3186,  108, "custom-agent"),
    ("Jun 18, 5:17:54 PM", 0.000200,  3015,  100, "custom-agent"),
    ("Jun 18, 5:17:48 PM", 0.003500, 15155,  166, "agent"),
    ("Jun 18, 5:16:59 PM", 0.000500, 27347,  274, "agent"),
    ("Jun 18, 5:16:54 PM", 0.000600, 26920,  434, "agent"),
    ("Jun 18, 5:16:45 PM", 0.000700, 26680,  493, "agent"),
    ("Jun 18, 5:16:38 PM", 0.003500, 26265,  624, "agent"),
    ("Jun 18, 5:16:28 PM", 0.001800, 19687,  730, "agent"),
    ("Jun 18, 5:16:18 PM", 0.000500, 17172,  236, "agent"),
    ("Jun 18, 5:16:13 PM", 0.000500, 16792,  276, "agent"),
    ("Jun 18, 5:16:08 PM", 0.000800, 16399,  407, "agent"),
    ("Jun 18, 5:15:51 PM", 0.000600, 15677,  444, "agent"),
    ("Jun 18, 5:15:41 PM", 0.003900, 15583,  471, "agent"),
    ("Jun 18, 5:14:37 PM", 0.000900, 26032,  497, "agent"),
    ("Jun 18, 5:14:28 PM", 0.000400, 25092,  122, "agent"),
    ("Jun 18, 5:14:24 PM", 0.000600, 24691,  259, "agent"),
    ("Jun 18, 5:14:20 PM", 0.000700, 24192,  490, "agent"),
    ("Jun 18, 5:14:11 PM", 0.000600, 23791,  265, "agent"),
    ("Jun 18, 5:14:04 PM", 0.001500, 23169, 1237, "agent"),
    ("Jun 18, 5:13:49 PM", 0.002800, 22599, 1558, "agent"),
    ("Jun 18, 5:13:28 PM", 0.001500, 19737,  665, "agent"),
    ("Jun 18, 5:13:18 PM", 0.002000, 17822,  805, "agent"),
    ("Jun 18, 5:13:09 PM", 0.001100, 62841,  710, "custom-agent"),
    ("Jun 18, 5:12:56 PM", 0.000900, 62134,  305, "custom-agent"),
    ("Jun 18, 5:12:47 PM", 0.018100, 61366,  368, "custom-agent"),
    ("Jun 18, 5:12:34 PM", 0.005000, 20852,  220, "custom-agent"),
    ("Jun 18, 5:12:27 PM", 0.000400,  9831,  248, "custom-agent"),
    ("Jun 18, 5:12:19 PM", 0.000700,  9460,  529, "custom-agent"),
    ("Jun 18, 5:12:10 PM", 0.000400,  9148,  390, "custom-agent"),
    ("Jun 18, 5:12:01 PM", 0.000600,  9012,  115, "custom-agent"),
    ("Jun 18, 5:11:56 PM", 0.000700,  7903,  321, "custom-agent"),
    ("Jun 18, 5:11:46 PM", 0.000500,  7089,  382, "custom-agent"),
    ("Jun 18, 5:11:38 PM", 0.000600,  6684,  440, "custom-agent"),
    ("Jun 18, 5:11:29 PM", 0.000700,  6210,  415, "custom-agent"),
    ("Jun 18, 5:11:18 PM", 0.000600,  5671,  373, "custom-agent"),
    ("Jun 18, 5:11:09 PM", 0.000500,  5048,  435, "custom-agent"),
    ("Jun 18, 5:11:00 PM", 0.000800,  4754,  570, "custom-agent"),
    ("Jun 18, 5:10:51 PM", 0.000600,  4146,  412, "custom-agent"),
    ("Jun 18, 5:10:44 PM", 0.000200,  3795,  115, "custom-agent"),
    ("Jun 18, 5:10:40 PM", 0.000400,  3479,  236, "custom-agent"),
    ("Jun 18, 5:10:36 PM", 0.000400,  2993,  306, "custom-agent"),
    ("Jun 18, 5:10:26 PM", 0.001500, 17235, 1329, "custom-agent"),
    ("Jun 18, 5:10:10 PM", 0.000700, 16865,  232, "custom-agent"),
    ("Jun 18, 5:10:04 PM", 0.002400, 16038,  330, "custom-agent"),
    ("Jun 18, 5:09:57 PM", 0.000900, 11145,  701, "custom-agent"),
    ("Jun 18, 5:09:47 PM", 0.000700, 10442,  412, "custom-agent"),
    ("Jun 18, 5:09:39 PM", 0.000600,  9761,  472, "custom-agent"),
    ("Jun 18, 5:09:32 PM", 0.000600,  9316,  363, "custom-agent"),
    ("Jun 18, 5:09:26 PM", 0.000500,  8773,  269, "custom-agent"),
    ("Jun 18, 5:09:22 PM", 0.000800,  8139,  517, "custom-agent"),
    ("Jun 18, 5:09:15 PM", 0.000600,  7243,  292, "custom-agent"),
    ("Jun 18, 5:09:07 PM", 0.000500,  6666,  293, "custom-agent"),
    ("Jun 18, 5:09:02 PM", 0.000800,  6204,  528, "custom-agent"),
    ("Jun 18, 5:08:55 PM", 0.000500,  5570,  378, "custom-agent"),
    ("Jun 18, 5:08:46 PM", 0.000700,  5163,  408, "custom-agent"),
    ("Jun 18, 5:08:40 PM", 0.000600,  4521,  478, "custom-agent"),
    ("Jun 18, 5:08:34 PM", 0.000400,  4151,  273, "custom-agent"),
    ("Jun 18, 5:08:30 PM", 0.000500,  3718,  339, "custom-agent"),
    ("Jun 18, 5:08:24 PM", 0.000200,  3372,  137, "custom-agent"),
    ("Jun 18, 5:08:20 PM", 0.000200,  3207,  109, "custom-agent"),
    ("Jun 18, 5:08:11 PM", 0.000300,  2992,  261, "custom-agent"),
    ("Jun 18, 5:08:06 PM", 0.001900, 18901,  932, "custom-agent"),
    ("Jun 18, 5:07:49 PM", 0.006000, 16744,  292, "custom-agent"),
    ("Jun 18, 5:07:43 PM", 0.000800,  3788,  665, "custom-agent"),
    ("Jun 18, 5:07:35 PM", 0.000300,  3433,  160, "custom-agent"),
    ("Jun 18, 5:07:32 PM", 0.000300,  2990,  195, "custom-agent"),
    ("Jun 18, 5:07:26 PM", 0.003700, 15157,  365, "agent"),
    ("Jun 18, 5:06:38 PM", 0.000500, 17058,  284, "agent"),
    ("Jun 18, 5:06:32 PM", 0.000300, 16709,  171, "agent"),
    ("Jun 18, 5:06:28 PM", 0.000700, 16532,  247, "agent"),
    ("Jun 18, 5:06:11 PM", 0.004300, 15645,  839, "agent"),
    ("Jun 18, 5:05:15 PM", 0.000400, 23716,  147, "agent"),
    ("Jun 18, 5:05:11 PM", 0.000400, 23205,  118, "agent"),
    # ── Page 4 ──────────────────────────────────────────────────────────────
    ("Jun 18, 5:43:57 PM", 0.000700, 21267,  429, "agent"),
    ("Jun 18, 5:43:51 PM", 0.000700, 20924,  238, "agent"),
    ("Jun 18, 5:43:43 PM", 0.001000, 20059,  145, "agent"),
    ("Jun 18, 5:43:40 PM", 0.001700, 18385, 1236, "agent"),
    ("Jun 18, 5:43:27 PM", 0.001400, 17211,  477, "agent"),
    ("Jun 18, 5:43:19 PM", 0.027000, 98077, 2168, "custom-agent"),
    ("Jun 18, 5:42:47 PM", 0.009700, 40736,  465, "custom-agent"),
    ("Jun 18, 5:42:37 PM", 0.004300, 19622,  497, "custom-agent"),
    ("Jun 18, 5:42:29 PM", 0.001000, 10786,  542, "custom-agent"),
    ("Jun 18, 5:42:22 PM", 0.000800,  9820,  295, "custom-agent"),
    ("Jun 18, 5:42:18 PM", 0.000900,  8696,  399, "custom-agent"),
    ("Jun 18, 5:42:12 PM", 0.000900,  7388,  563, "custom-agent"),
    ("Jun 18, 5:42:06 PM", 0.000500,  6649,  385, "custom-agent"),
    ("Jun 18, 5:42:01 PM", 0.000400,  6394,  221, "custom-agent"),
    ("Jun 18, 5:41:56 PM", 0.000800,  5911,  391, "custom-agent"),
    ("Jun 18, 5:41:50 PM", 0.000500,  4758,  389, "custom-agent"),
    ("Jun 18, 5:41:44 PM", 0.000500,  4242,  347, "custom-agent"),
    ("Jun 18, 5:41:40 PM", 0.000500,  3864,  292, "custom-agent"),
    ("Jun 18, 5:41:25 PM", 0.000400,  3463,  237, "custom-agent"),
    ("Jun 18, 5:41:20 PM", 0.000200,  3123,   97, "custom-agent"),
    ("Jun 18, 5:41:17 PM", 0.000200,  3010,   68, "custom-agent"),
    ("Jun 18, 5:41:13 PM", 0.003500, 15164,  164, "agent"),
    ("Jun 18, 5:39:16 PM", 0.000500, 29662,  251, "agent"),
    ("Jun 18, 5:39:05 PM", 0.000400, 29336,  163, "agent"),
    ("Jun 18, 5:39:00 PM", 0.000800, 28943,  139, "agent"),
    ("Jun 18, 5:38:54 PM", 0.002300, 27683, 1529, "agent"),
    ("Jun 18, 5:38:38 PM", 0.001000, 25833,  544, "agent"),
    ("Jun 18, 5:38:30 PM", 0.004000, 24969,  366, "agent"),
    ("Jun 18, 5:38:24 PM", 0.000500, 16700,  239, "agent"),
    ("Jun 18, 5:38:19 PM", 0.000600, 16171,  322, "agent"),
    ("Jun 18, 5:38:12 PM", 0.000500, 15863,  255, "agent"),
    ("Jun 18, 5:37:54 PM", 0.003800, 15413,  309, "agent"),
    ("Jun 18, 5:36:01 PM", 0.000500, 24461,  291, "agent"),
    ("Jun 18, 5:35:56 PM", 0.000500, 24168,  163, "agent"),
    ("Jun 18, 5:35:51 PM", 0.000800, 23588,  603, "agent"),
    ("Jun 18, 5:35:44 PM", 0.000500, 23295,  202, "agent"),
    ("Jun 18, 5:35:39 PM", 0.000900, 22804,  725, "agent"),
    ("Jun 18, 5:35:30 PM", 0.000900, 22495,  417, "agent"),
    ("Jun 18, 5:35:23 PM", 0.000900, 21524,  317, "agent"),
    ("Jun 18, 5:35:18 PM", 0.001600, 20386,  420, "agent"),
    ("Jun 18, 5:35:02 PM", 0.001500, 17844,  211, "agent"),
    ("Jun 18, 5:34:54 PM", 0.005800, 59245, 2598, "custom-agent"),
    ("Jun 18, 5:34:24 PM", 0.003600, 51766,  400, "custom-agent"),
    ("Jun 18, 5:34:17 PM", 0.001200, 44703,  246, "custom-agent"),
    ("Jun 18, 5:34:11 PM", 0.001000, 42862,  225, "custom-agent"),
    ("Jun 18, 5:34:06 PM", 0.000400, 41263,  207, "custom-agent"),
    ("Jun 18, 5:34:01 PM", 0.000600, 40991,  232, "custom-agent"),
    ("Jun 18, 5:33:56 PM", 0.000700, 40417,  115, "custom-agent"),
    ("Jun 18, 5:33:52 PM", 0.000500, 39398,  198, "custom-agent"),
    ("Jun 18, 5:33:46 PM", 0.000500, 39070,  248, "custom-agent"),
    ("Jun 18, 5:33:39 PM", 0.000500, 38550,  377, "custom-agent"),
    ("Jun 18, 5:33:32 PM", 0.000600, 38241,  106, "custom-agent"),
    ("Jun 18, 5:33:28 PM", 0.001100, 37482,  401, "custom-agent"),
    ("Jun 18, 5:33:21 PM", 0.000800, 35920,  322, "custom-agent"),
    ("Jun 18, 5:33:16 PM", 0.000900, 35146,  319, "custom-agent"),
    ("Jun 18, 5:33:10 PM", 0.000600, 34001,  361, "custom-agent"),
    ("Jun 18, 5:33:05 PM", 0.000600, 33657,  271, "custom-agent"),
    ("Jun 18, 5:32:57 PM", 0.000700, 32968,  255, "custom-agent"),
    ("Jun 18, 5:32:50 PM", 0.000600, 32173,  307, "custom-agent"),
    ("Jun 18, 5:32:09 PM", 0.000600, 31796,  290, "custom-agent"),
    ("Jun 18, 5:31:55 PM", 0.000900, 31396,  332, "custom-agent"),
    ("Jun 18, 5:31:48 PM", 0.000900, 30280,  413, "custom-agent"),
    ("Jun 18, 5:31:41 PM", 0.000700, 29422,  458, "custom-agent"),
    ("Jun 18, 5:31:33 PM", 0.000500, 29007,  202, "custom-agent"),
    ("Jun 18, 5:31:21 PM", 0.000500, 28569,  281, "custom-agent"),
    ("Jun 18, 5:31:16 PM", 0.000400, 28234,  259, "custom-agent"),
    ("Jun 18, 5:31:11 PM", 0.010500, 27941,  240, "custom-agent"),
    ("Jun 18, 5:31:02 PM", 0.000600,  4367,  314, "custom-agent"),
    ("Jun 18, 5:30:51 PM", 0.000600,  3648,  462, "custom-agent"),
    ("Jun 18, 5:30:45 PM", 0.000300,  3303,  134, "custom-agent"),
    ("Jun 18, 5:30:42 PM", 0.000200,  3006,  143, "custom-agent"),
    ("Jun 18, 5:30:37 PM", 0.003600, 15156,  186, "agent"),
    ("Jun 18, 5:29:37 PM", 0.001000, 23291,  596, "agent"),
    ("Jun 18, 5:29:30 PM", 0.000900, 22442,  674, "agent"),
    ("Jun 18, 5:29:22 PM", 0.001100, 21910,  887, "agent"),
    ("Jun 18, 5:29:10 PM", 0.001600, 21623,  451, "agent"),
    ("Jun 18, 5:29:02 PM", 0.001500, 19192, 1296, "agent"),
    ("Jun 18, 5:28:47 PM", 0.001700, 18433, 1174, "agent"),
    ("Jun 18, 5:28:33 PM", 0.000900, 17277,  429, "agent"),
    ("Jun 18, 5:28:27 PM", 0.001000, 38056,  748, "custom-agent"),
    ("Jun 18, 5:28:17 PM", 0.002700, 37668,  318, "custom-agent"),
    ("Jun 18, 5:28:11 PM", 0.001100, 32505,  408, "custom-agent"),
    ("Jun 18, 5:28:05 PM", 0.012100, 31357,  435, "custom-agent"),
    ("Jun 18, 5:27:56 PM", 0.000800,  4369,  440, "custom-agent"),
    ("Jun 18, 5:27:51 PM", 0.000500,  3481,  346, "custom-agent"),
    ("Jun 18, 5:27:40 PM", 0.000300,  2983,  245, "custom-agent"),
    ("Jun 18, 5:27:35 PM", 0.000400, 16418,  155, "agent"),
    ("Jun 18, 5:27:30 PM", 0.000600, 15898,  386, "agent"),
    ("Jun 18, 5:27:08 PM", 0.003900, 15539,  448, "agent"),
    ("Jun 18, 5:25:40 PM", 0.011800, 29448,  661, "custom-agent"),
    ("Jun 18, 5:25:30 PM", 0.000500,  3824,  349, "custom-agent"),
    ("Jun 18, 5:25:24 PM", 0.000500,  3533,  201, "custom-agent"),
    ("Jun 18, 5:25:20 PM", 0.000400,  3050,  291, "custom-agent"),
    ("Jun 18, 5:25:14 PM", 0.003600, 15154,  233, "agent"),
    ("Jun 18, 5:24:07 PM", 0.001500, 24748, 1526, "agent"),
    ("Jun 18, 5:23:49 PM", 0.001100, 24463,  976, "agent"),
    ("Jun 18, 5:23:36 PM", 0.002600, 24035, 1289, "agent"),
    ("Jun 18, 5:23:21 PM", 0.002000, 20989, 1601, "agent"),
    ("Jun 18, 5:23:02 PM", 0.000900, 19862,  330, "agent"),
    ("Jun 18, 5:22:57 PM", 0.001400, 18900,  343, "agent"),
]

def ts_to_sec_from_str(ts_full: str) -> int:
    # "Jun 18, 4:28:15 PM" -> extract "4:28:15 PM"
    time_str = ts_full.split(", ", 1)[1]
    return ts_to_sec(time_str)

def main():
    # Build per-run accumulators
    run_data = []
    for task, variant, dur in RUNS:
        run_data.append({
            "task": task,
            "variant": variant,
            "wall_s": dur,
            "cost": 0.0,
            "input_tok": 0,
            "output_tok": 0,
            "calls": 0,
        })

    unassigned = []
    pre_benchmark = []

    for ts_str, cost, inp, out, mode in RAW_ROWS:
        sec = ts_to_sec_from_str(ts_str)
        if sec < BASE_SEC:
            pre_benchmark.append((ts_str, cost, inp, out))
            continue
        idx = assign_run(sec)
        if idx is None:
            unassigned.append((ts_str, cost, inp, out))
            continue
        run_data[idx]["cost"]      += cost
        run_data[idx]["input_tok"] += inp
        run_data[idx]["output_tok"] += out
        run_data[idx]["calls"]     += 1

    # Print summary table
    print(f"\n{'Task':<12} {'Var':<5} {'Wall':>7} {'Cost':>8} {'InTok':>9} {'OutTok':>8} {'Calls':>6}")
    print("-" * 65)
    for r in run_data:
        print(f"{r['task']:<12} {r['variant']:<5} {r['wall_s']:>7.1f}s "
              f"${r['cost']:>7.4f} {r['input_tok']:>9,} {r['output_tok']:>8,} {r['calls']:>6}")

    print(f"\nUnassigned rows: {len(unassigned)}")
    for u in unassigned:
        print(f"  {u}")

    # Compute pairs
    tasks_order = ["orbit-p1","orbit-p2","orbit-p3","atlas-p1","atlas-p2","atlas-p3","nova-p1","nova-p2","nova-p3"]
    pairs = []
    for task in tasks_order:
        raw  = next(r for r in run_data if r["task"]==task and r["variant"]=="raw")
        mcp  = next(r for r in run_data if r["task"]==task and r["variant"]=="mcp")
        speedup = (raw["wall_s"] - mcp["wall_s"]) / raw["wall_s"] * 100
        cost_save = (raw["cost"] - mcp["cost"]) / raw["cost"] * 100 if raw["cost"] > 0 else 0
        pairs.append({
            "task": task,
            "raw_wall": raw["wall_s"],
            "mcp_wall": mcp["wall_s"],
            "speedup_pct": round(speedup, 1),
            "raw_cost": round(raw["cost"], 4),
            "mcp_cost": round(mcp["cost"], 4),
            "cost_save_pct": round(cost_save, 1),
            "raw_input_tok": raw["input_tok"],
            "mcp_input_tok": mcp["input_tok"],
            "raw_output_tok": raw["output_tok"],
            "mcp_output_tok": mcp["output_tok"],
            "raw_calls": raw["calls"],
            "mcp_calls": mcp["calls"],
        })

    print("\n\n=== CANVAS DATA (copy this) ===")
    print(json.dumps(pairs, indent=2))

    # Totals
    total_raw_cost = sum(p["raw_cost"] for p in pairs)
    total_mcp_cost = sum(p["mcp_cost"] for p in pairs)
    total_raw_wall = sum(p["raw_wall"] for p in pairs)
    total_mcp_wall = sum(p["mcp_wall"] for p in pairs)
    print(f"\nTotal RAW cost: ${total_raw_cost:.4f}")
    print(f"Total MCP cost: ${total_mcp_cost:.4f}")
    print(f"Total cost saving: ${total_raw_cost - total_mcp_cost:.4f} ({(total_raw_cost-total_mcp_cost)/total_raw_cost*100:.1f}%)")
    print(f"Total RAW time: {total_raw_wall:.1f}s")
    print(f"Total MCP time: {total_mcp_wall:.1f}s")
    print(f"Total time saving: {total_raw_wall - total_mcp_wall:.1f}s ({(total_raw_wall-total_mcp_wall)/total_raw_wall*100:.1f}%)")

if __name__ == "__main__":
    main()
