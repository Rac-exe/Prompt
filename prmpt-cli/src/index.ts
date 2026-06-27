#!/usr/bin/env node
/**
 * prmpt — PRMPT as a standalone CLI coding agent (Pi SDK + Claude Sonnet 4.6).
 *
 * Headless, single-shot:
 *   prmpt -p "<task>" --cwd <repo>
 *
 * It runs the Pi agent loop with PRMPT's live `prmpt_retrieve` tool available
 * (and a policy preamble telling the model to use it first), then prints a
 * machine-readable usage JSON line to stdout as the LAST line. All agent chatter
 * goes to stderr so stdout stays parseable for the benchmark harness.
 *
 * Environment:
 *   ANTHROPIC_API_KEY        required (the base model credential)
 *   PRMPT_CODE_INTEL_URL     default http://127.0.0.1:8002/api
 *   PRMPT_PROJECT_ID         required for retrieval — the indexed project id
 *   PRMPT_CODE_INTEL_ROOT    required for retrieval — the SQLite store root
 *   PRMPT_DEV_AUTH_TOKEN     default "dev-cli-token"
 *   PRMPT_RETRIEVE_LOG       optional JSONL path (one line per retrieval call)
 *   PRMPT_USAGE_OUT          optional path to write the usage JSON
 *   PRMPT_RETRIEVE_LIMIT     default 8
 *   PRMPT_MODEL              default "anthropic/claude-sonnet-4.6"
 *   PRMPT_PROVIDER           default "openrouter"
 *   OPENROUTER_API_KEY       required when provider=openrouter (the base model credential)
 *   PRMPT_THINKING           default "off"
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  createAgentSession,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  createPrmptRetrieveTool,
  buildPrmptPreamble,
  retrievalState,
} from "./prmpt-extension.js";

interface Args {
  prompt: string;
  cwd: string;
  model: string;
  provider: string;
  thinking: string;
}

function parseArgs(argv: string[]): Args {
  let prompt = "";
  let promptFile = "";
  let cwd = process.cwd();
  let model = process.env.PRMPT_MODEL || "anthropic/claude-sonnet-4.6";
  let provider = process.env.PRMPT_PROVIDER || "openrouter";
  let thinking = process.env.PRMPT_THINKING || "off";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--prompt") prompt = argv[++i] ?? "";
    else if (a === "--prompt-file") promptFile = argv[++i] ?? "";
    else if (a === "--cwd") cwd = argv[++i] ?? cwd;
    else if (a === "--model") model = argv[++i] ?? model;
    else if (a === "--provider") provider = argv[++i] ?? provider;
    else if (a === "--thinking") thinking = argv[++i] ?? thinking;
  }
  if (!prompt && promptFile) prompt = readFileSync(promptFile, "utf-8");
  if (!prompt) {
    process.stderr.write("prmpt: missing -p/--prompt (or --prompt-file)\n");
    process.exit(2);
  }
  return { prompt, cwd, model, provider, thinking };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const codeIntelUrl = process.env.PRMPT_CODE_INTEL_URL || "http://127.0.0.1:8002/api";
  const projectId = process.env.PRMPT_PROJECT_ID || "";
  const codeIntelRoot = process.env.PRMPT_CODE_INTEL_ROOT || "";
  const authToken = process.env.PRMPT_DEV_AUTH_TOKEN || "dev-cli-token";
  const retrieveLog = process.env.PRMPT_RETRIEVE_LOG || undefined;
  const usageOut = process.env.PRMPT_USAGE_OUT || undefined;
  const limit = Number(process.env.PRMPT_RETRIEVE_LIMIT || "8");
  const retrieveVariant = process.env.PRMPT_RETRIEVE_VARIANT || "prmpt_cli_fast";

  const authStorage = AuthStorage.create();
  const envApiKey =
    args.provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : args.provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : args.provider === "openai"
          ? process.env.OPENAI_API_KEY
          : args.provider === "google"
            ? process.env.GOOGLE_API_KEY
            : undefined;
  if (envApiKey) {
    authStorage.setRuntimeApiKey(args.provider, envApiKey);
  }
  const modelRegistry = ModelRegistry.create(authStorage);
  const maxTokens = Number(process.env.PRMPT_MAX_TOKENS || "4096");
  const openRouterBaseUrl =
    process.env.PRMPT_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  if (args.provider === "openrouter") {
    const builtInModel = modelRegistry.find(args.provider, args.model) as any;
    modelRegistry.registerProvider("openrouter", {
      baseUrl: openRouterBaseUrl,
      apiKey: envApiKey,
      models: builtInModel
        ? [
            {
              id: builtInModel.id,
              name: builtInModel.name || builtInModel.id,
              api: builtInModel.api,
              baseUrl: openRouterBaseUrl,
              reasoning: builtInModel.reasoning,
              thinkingLevelMap: builtInModel.thinkingLevelMap,
              input: builtInModel.input,
              cost: builtInModel.cost,
              contextWindow: builtInModel.contextWindow,
              maxTokens:
                Number.isFinite(maxTokens) && maxTokens > 0
                  ? Math.min(builtInModel.maxTokens ?? maxTokens, maxTokens)
                  : builtInModel.maxTokens,
              headers: builtInModel.headers,
              compat: builtInModel.compat,
            },
          ]
        : undefined,
    });
  }
  const model = modelRegistry.find(args.provider, args.model);
  if (!model) {
    process.stderr.write(
      `prmpt: model not found: ${args.provider}/${args.model}. ` +
        `Check the id and that ANTHROPIC_API_KEY is set.\n`,
    );
    process.exit(3);
  }
  if (Number.isFinite(maxTokens) && maxTokens > 0) {
    (model as any).maxTokens = Math.min((model as any).maxTokens ?? maxTokens, maxTokens);
  }

  const retrieveTool = createPrmptRetrieveTool({
    codeIntelUrl,
    projectId,
    codeIntelRoot,
    authToken,
    retrieveLog,
    limit,
    maxBodyChars: 1600,
    variant: retrieveVariant,
  });

  // Inject the PRMPT policy as a virtual context file so it shapes every turn
  // without clobbering Pi's default system prompt.
  const preamble = buildPrmptPreamble();
  const loader = new DefaultResourceLoader({
    cwd: args.cwd,
    agentDir: getAgentDir(),
    agentsFilesOverride: (current) => ({
      agentsFiles: [
        ...current.agentsFiles,
        { path: "/virtual/PRMPT.md", content: preamble },
      ],
    }),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: args.cwd,
    model,
    thinkingLevel: args.thinking as never,
    authStorage,
    modelRegistry,
    resourceLoader: loader,
    tools: ["read", "bash", "edit", "write", "prmpt_retrieve"],
    customTools: [retrieveTool],
    sessionManager: SessionManager.inMemory(args.cwd),
  });
  const agent = (session as any).agent;
  const previousOnPayload = agent?.onPayload;
  if (agent && args.provider === "openrouter" && Number.isFinite(maxTokens) && maxTokens > 0) {
    agent.onPayload = async (payload: any, payloadModel: any) => {
      const next = previousOnPayload
        ? await previousOnPayload(payload, payloadModel)
        : payload;
      return {
        ...next,
        max_tokens: maxTokens,
        max_completion_tokens: undefined,
      };
    };
  }

  // Stream agent output to stderr; keep stdout clean for the usage JSON.
  session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stderr.write(event.assistantMessageEvent.delta);
    }
  });

  const t0 = Date.now();
  let runError: string | null = null;
  try {
    await session.prompt(args.prompt);
  } catch (err) {
    runError = String(err);
    process.stderr.write(`\nprmpt: run error: ${runError}\n`);
  }
  const elapsedMs = Date.now() - t0;

  const assistantError = session.state.messages.find(
    (msg: any) => msg.role === "assistant" && msg.stopReason === "error",
  ) as any;
  if (assistantError && runError === null) {
    runError = assistantError.errorMessage || "assistant stopped with error";
    process.stderr.write(`\nprmpt: run error: ${runError}\n`);
  }

  const stats = session.getSessionStats();
  const usage = {
    ok: runError === null,
    error: runError,
    model: `${args.provider}/${args.model}`,
    input_tokens: stats.tokens.input,
    output_tokens: stats.tokens.output,
    cache_read_tokens: stats.tokens.cacheRead,
    cache_write_tokens: stats.tokens.cacheWrite,
    total_tokens: stats.tokens.total,
    cost_usd: stats.cost,
    tool_calls: stats.toolCalls,
    retrieval_calls: retrievalState.calls,
    retrieval_files: Array.from(retrievalState.files),
    assistant_messages: stats.assistantMessages,
    context_tokens: stats.contextUsage?.tokens ?? null,
    context_window: stats.contextUsage?.contextWindow ?? null,
    elapsed_ms: elapsedMs,
  };

  if (usageOut) {
    try {
      writeFileSync(usageOut, JSON.stringify(usage, null, 2), "utf-8");
    } catch (err) {
      process.stderr.write(`\nprmpt: could not write usage to ${usageOut}: ${String(err)}\n`);
    }
  }

  session.dispose();
  // Final line on stdout: the parseable usage record.
  process.stdout.write("\n" + JSON.stringify(usage) + "\n");
  process.exit(runError === null ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`prmpt: fatal: ${String(err)}\n`);
  process.exit(1);
});
