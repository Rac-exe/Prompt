"""
Local single-user identity.

The service listens on localhost and the desktop app is its only client, so
there is no login: every request runs as the same local user. Browser pages
are kept out by the origin check in main.py.
"""

LOCAL_USER_ID = "00000000-0000-0000-0000-000000000000"


async def require_auth() -> dict:
    return {"sub": LOCAL_USER_ID, "role": "authenticated"}
