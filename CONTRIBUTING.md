# Contributing to PRMPT

## First-time Setup

### Requirements

- Node.js 20+
- Python 3.11+
- Git

### Steps

**1. Clone and enter the repo**

```bash
git clone https://github.com/Rac-exe/Prompt.git
cd Prompt
```

**2. Set up environment variables**

```bash
cp .env.example .env
```

Open `.env` and fill in:
- `OPENROUTER_API_KEY` — get one at [openrouter.ai](https://openrouter.ai/keys)
- `OPENAI_API_KEY` — used by code-intel for embeddings

Then set up the code-intel service env:

```bash
cp code-intelligence-service/.env.example code-intelligence-service/.env
```

Fill in the same keys inside `code-intelligence-service/.env` (it has its own copy).

**3. Install code-intelligence-service**

```bash
# Windows
npm run code-intel:install

# macOS / Linux
npm run code-intel:install:mac
```

**4. Install the CLI**

```bash
npm run cli:install
```

**5. Start the code-intel service**

```bash
# Windows
npm run code-intel:dev

# macOS / Linux
npm run code-intel:dev:mac
```

Keep this running in a terminal. It needs to be live for the CLI to retrieve files.

**6. Run the CLI**

```bash
cd prmpt-cli
npx prmpt --prompt "fix the failing test in utils.js" --cwd /path/to/some/repo
```

---

## Project Structure

| Folder | What to know |
|---|---|
| `code-intelligence-service/` | The retrieval brain. FastAPI on port 8002. Don't simplify the retrieval pipeline. |
| `prmpt-cli/src/` | CLI agent. `index.ts` = entry point. `prmpt-extension.ts` = retrieval tool. |
| `prmpt-cli/harness/` | Benchmark scripts. See `prmpt-cli/README.md` for how to run. |
| `legacy/` | Old Electron desktop app. Archived. Don't edit. Read if you need reference. |
| `.cursor/rules/prmpt.md` | Agent rules — read this to understand what agents should and shouldn't do. |

---

## Things to Know

- **No code goes to the cloud.** All indexing and retrieval runs on localhost.
- **Auth is bypassed in dev.** `PRMPT_ALLOW_DEV_CLI_AUTH=1` in `.env` lets the CLI hit code-intel without a Supabase session.
- **The benchmark runs on a separate machine.** See `prmpt-cli/README.md` for Nihal's setup.
- **`legacy/` is not dead code.** It's the old product, fully working, just archived. Git history is intact.

---

## Key Contacts

- Prabhat — architecture, retrieval pipeline, CLI design
- Nihal — benchmark runs, external testing
