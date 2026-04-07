"""
Fetch file contents from GitHub for code retrieval at query time.
Raw code is fetched on demand, never stored in cloud.
"""

import base64
import logging
from typing import Optional
import httpx

logger = logging.getLogger("code-intel.fetcher")

GITHUB_API_BASE = "https://api.github.com"


async def fetch_file_lines(
    owner: str,
    repo: str,
    file_path: str,
    branch: str,
    start_line: int,
    end_line: int,
    github_token: Optional[str] = None,
) -> Optional[str]:
    """
    Fetch specific lines from a file on GitHub.
    Returns the code content or None on failure.
    """
    headers = {"Accept": "application/vnd.github.v3+json"}
    if github_token:
        headers["Authorization"] = f"token {github_token}"

    url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/contents/{file_path}?ref={branch}"

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, headers=headers)

        if resp.status_code != 200:
            logger.warning(f"GitHub contents API returned {resp.status_code} for {file_path}")
            return None

        data = resp.json()
        content_b64 = data.get("content", "")
        content = base64.b64decode(content_b64).decode("utf-8", errors="replace")
        lines = content.splitlines()

        start_idx = max(0, start_line - 1)
        end_idx = min(len(lines), end_line)
        return "\n".join(lines[start_idx:end_idx])

    except Exception as e:
        logger.error(f"Failed to fetch {file_path}: {e}")
        return None
