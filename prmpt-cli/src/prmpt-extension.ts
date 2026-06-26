/**
 * PRMPT retrieval surface for the Pi-based CLI agent.
 *
 * Exposes a single live tool, `prmpt_retrieve`, that the agent calls on demand
 * to locate the exact files/line-ranges relevant to a task. It queries the
 * existing code-intelligence service (POST /api/context) so retrieval is LIVE,
 * not a frozen pre-baked list: when the first answer misses, the agent simply
 * calls the tool again with a refined query. Every call is appended to
 * PRMPT_RETRIEVE_LOG so the harness can count "retrieval retries".
 *
 * This is the core of the pivot: PRMPT stops being an MCP bolted onto another
 * agent and becomes the agent's own primary way to find code.
 */

import { appendFileSync } from "node:fs";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export interface PrmptRetrieveConfig {
  /** Base URL of the code-intel API, e.g. http://127.0.0.1:8002/api */
  codeIntelUrl: string;
  /** Project id for the indexed repo under test. */
  projectId: string;
  /** Code-intel SQLite root (passed back as the X-Prmpt-Code-Intel-Root header). */
  codeIntelRoot: string;
  /** Dev bearer token accepted by the service in non-production. */
  authToken: string;
  /** Optional JSONL path; one line is written per retrieval call. */
  retrieveLog?: string;
  /** Max probable locations to request per call. */
  limit: number;
  /** Truncate each returned code body to this many chars (keeps context lean). */
  maxBodyChars: number;
}

interface ProbableLocation {
  file_path: string;
  start_line: number;
  end_line: number;
  name?: string;
  signature?: string | null;
  language?: string;
  semantic_summary?: string | null;
  summary_purpose?: string | null;
  code_body?: string | null;
  confidence_score?: number;
  probable_issue?: string | null;
}

interface ContextResponse {
  probable_locations?: ProbableLocation[];
  related_locations?: ProbableLocation[];
  intent?: string;
  concepts?: string[];
  project_summary?: string | null;
}

/** Running tally of retrieval calls for the current process (read by index.ts). */
export const retrievalState = {
  calls: 0,
  /** Distinct file paths the tool has surfaced, for precision/recall scoring. */
  files: new Set<string>(),
};

function logCall(cfg: PrmptRetrieveConfig, record: object): void {
  if (!cfg.retrieveLog) return;
  try {
    appendFileSync(cfg.retrieveLog, JSON.stringify(record) + "\n", "utf-8");
  } catch {
    /* logging is best-effort; never fail a run because the log is unwritable */
  }
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... [truncated ${text.length - max} chars]`;
}

function formatLocations(locs: ProbableLocation[], cfg: PrmptRetrieveConfig): string {
  if (locs.length === 0) {
    return "No probable locations found for that query. Refine the query with concrete symbols, file hints, or the failing behavior and call prmpt_retrieve again.";
  }
  const blocks = locs.map((loc, i) => {
    const header = `${i + 1}. ${loc.file_path}:${loc.start_line}-${loc.end_line}` +
      (loc.name ? `  [${loc.name}]` : "");
    const why = loc.probable_issue || loc.semantic_summary || loc.summary_purpose || "";
    const body = truncate(loc.code_body, cfg.maxBodyChars);
    return [
      header,
      why ? `   why: ${why}` : "",
      body ? "```\n" + body + "\n```" : "",
    ].filter(Boolean).join("\n");
  });
  return blocks.join("\n\n");
}

/**
 * Build the `prmpt_retrieve` tool bound to a specific indexed project.
 */
export function createPrmptRetrieveTool(cfg: PrmptRetrieveConfig) {
  return defineTool({
    name: "prmpt_retrieve",
    label: "PRMPT Retrieve",
    description:
      "Locate the exact files and line ranges relevant to a coding task using PRMPT's " +
      "semantic+graph code index. Returns ranked probable locations with code bodies. " +
      "Call this FIRST instead of grepping or scanning the repo. If the result misses, " +
      "call again with a more specific query (concrete symbol names, the failing test, " +
      "or the observed behavior).",
    promptSnippet:
      "prmpt_retrieve(query): semantic code search — returns probable files/lines with code.",
    parameters: Type.Object({
      query: Type.String({
        description:
          "Natural-language description of what you need to find — a bug, a behavior, " +
          "a symbol, or a feature area. Be specific for better routing.",
        minLength: 1,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const query = params.query;
      const url = `${cfg.codeIntelUrl.replace(/\/$/, "")}/context`;
      const started = Date.now();
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.authToken}`,
            "X-Prmpt-Code-Intel-Root": cfg.codeIntelRoot,
          },
          body: JSON.stringify({
            project_id: cfg.projectId,
            query,
            mode: "bug",
            limit: cfg.limit,
          }),
        });

        retrievalState.calls += 1;

        if (!resp.ok) {
          const detail = await resp.text().catch(() => "");
          logCall(cfg, {
            ts: new Date().toISOString(), query, ok: false,
            status: resp.status, detail: detail.slice(0, 300),
            ms: Date.now() - started,
          });
          return {
            content: [{
              type: "text" as const,
              text: `prmpt_retrieve failed (HTTP ${resp.status}). The index may still be building or the query was rejected. You may retry with a different query or fall back to reading files directly.`,
            }],
            details: { location_count: 0, files: [] as string[] },
          };
        }

        const data = (await resp.json()) as ContextResponse;
        const locs = data.probable_locations ?? [];
        for (const loc of locs) retrievalState.files.add(loc.file_path);

        logCall(cfg, {
          ts: new Date().toISOString(),
          query,
          ok: true,
          intent: data.intent ?? null,
          concepts: data.concepts ?? [],
          files: locs.map((l) => l.file_path),
          location_count: locs.length,
          ms: Date.now() - started,
        });

        const summary = data.project_summary
          ? `Project: ${truncate(data.project_summary, 400)}\n\n`
          : "";
        const text = summary + formatLocations(locs, cfg);

        return {
          content: [{ type: "text" as const, text }],
          details: { location_count: locs.length, files: locs.map((l) => l.file_path) },
        };
      } catch (err) {
        retrievalState.calls += 1;
        logCall(cfg, {
          ts: new Date().toISOString(), query, ok: false,
          error: String(err), ms: Date.now() - started,
        });
        return {
          content: [{
            type: "text" as const,
            text: `prmpt_retrieve error: ${String(err)}. The code-intel service may be down. Fall back to reading files directly if needed.`,
          }],
          details: { location_count: 0, files: [] as string[] },
        };
      }
    },
  });
}

/**
 * The PRMPT policy preamble, injected as a virtual context file (AGENTS.md
 * style) so it shapes every turn without clobbering Pi's default system prompt.
 * This is the "use retrieval first" discipline that makes the token savings real.
 */
export function buildPrmptPreamble(): string {
  return [
    "# PRMPT retrieval policy",
    "",
    "You have a `prmpt_retrieve` tool backed by a semantic + call-graph index of this repo.",
    "",
    "- ALWAYS call `prmpt_retrieve` first to locate relevant code. Do NOT scan the repo",
    "  with broad `bash` greps or directory walks — that wastes context and tokens.",
    "- The tool returns ranked files with line ranges and code bodies. Read only what it",
    "  points to, make the fix, and run the test command.",
    "- If the first result does not contain the cause, call `prmpt_retrieve` again with a",
    "  more specific query (name the failing symbol, the test, or the exact behavior).",
    "  Re-querying is expected and cheap; broad manual exploration is not.",
    "- Only read files outside the retrieved set if a failing stack trace explicitly",
    "  names another file.",
  ].join("\n");
}
