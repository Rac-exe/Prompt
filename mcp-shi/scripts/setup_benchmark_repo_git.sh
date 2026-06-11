#!/usr/bin/env bash
# Recreate clean git metadata for bundled benchmark repos.
# Source trees are committed in mcp-shi/test-repo/; .git/ is local-only (gitignored).
set -euo pipefail

MCP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_REPOS="$MCP_ROOT/test-repo"
REPOS=(orbit-crm-generated atlas-commerce-generated nova-support-generated)

mkdir -p "$TEST_REPOS"

for repo in "${REPOS[@]}"; do
  dir="$TEST_REPOS/$repo"
  if [[ ! -d "$dir" ]]; then
    echo "missing repo directory: $dir" >&2
    exit 1
  fi

  if [[ -d "$dir/.git" ]]; then
    if git -C "$dir" rev-parse --verify without-prompt >/dev/null 2>&1 \
      && git -C "$dir" rev-parse --verify with-prompt >/dev/null 2>&1; then
      echo "$repo: git already initialized"
      continue
    fi
    echo "$repo: incomplete git metadata, reinitializing"
    rm -rf "$dir/.git"
  fi

  (
    cd "$dir"
    git init -q
    git add .
    git commit -q -m "Benchmark workspace snapshot"
    git branch -M main
    git branch without-prompt
    git branch with-prompt
  )
  echo "$repo: initialized (branches: main, without-prompt, with-prompt)"
done

echo "Benchmark repo git setup complete."
