# Benchmark Repositories

Three generated JavaScript workspaces live under `mcp-shi/test-repo/`. They are intentionally buggy and used only for local Prompt/MCP benchmarks.

| Repo | ~size | Test command | Bug themes |
|------|------:|--------------|------------|
| `test-repo/orbit-crm-generated` | 9 MB | `npm test` | Auth, workspace access, lead lists, import reconciliation |
| `test-repo/atlas-commerce-generated` | 9 MB | `npm test` | Checkout, inventory, cart totals, coupons |
| `test-repo/nova-support-generated` | 9 MB | `npm test` | Ticket routing, SLA deadlines, imported ticket lists |

Each repo is a small Node ESM app (`package.json` + `src/` + `test/`). There is no `node_modules` in git; agents install deps in disposable clones during runs.

## Required git branches

The harness clones isolated worktrees with:

- `without-prompt` — raw vague user prompt condition
- `with-prompt` — optimized prompt condition

In this bundle, both branches point at the same snapshot commit. The behavioral difference comes from the prompt the agent receives, not from different source trees.

## User prompts per repo

These are the vague prompts wired in `benchmark-runs/run_benchmark.py`:

**orbit-crm-generated**

1. auth isnt working and some leads are acting weird, fix it and run the tests
2. workspace access is buggy and imported customer lists are weird, look into it
3. the crm is buggy around login and lead lists, run the test suite and fix it

**atlas-commerce-generated**

1. items arent loading in checkout and inventory is buggy, fix it and run tests
2. cart totals and product reservation lists are broken, look into it
3. the commerce flow is buggy when coupons or missing items happen, fix it

**nova-support-generated**

1. support ticket routing is buggy and sla deadlines are weird, fix it
2. the support lists are buggy for imported tickets, run tests and look into it
3. the support page behavior is buggy around tickets and deadlines, fix it

## First-time git setup

Source files are committed. Nested `.git/` directories are gitignored and recreated locally:

```bash
./mcp-shi/scripts/setup_benchmark_repo_git.sh
```

Run this once after cloning `prmptf`, or whenever a repo's `.git/` is missing.

## Layout

```text
mcp-shi/
  test-repo/
    orbit-crm-generated/
      package.json
      src/
      test/
    atlas-commerce-generated/
      package.json
      src/
      test/
    nova-support-generated/
      package.json
      src/
      test/
```

## Override repo location

By default the harness reads repos from `mcp-shi/test-repo/`. To use another folder:

```bash
export PRMPT_TEST_REPOS_ROOT="/path/to/folder-containing-generated-repos"
```

That folder must contain the three repo directories with the branch names above.
