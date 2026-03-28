"""
JWT authentication for hosted Python service endpoints.

Every protected endpoint calls require_auth() (HTTP) or require_ws_auth()
(WebSocket). Both verify the Supabase-issued access token and return the
decoded payload containing the user UUID as `sub`.

If SUPABASE_JWT_SECRET is not set (local dev without the secret), all
endpoints pass through with a warning. Set it in production — it is the
"JWT Secret" from Supabase dashboard → Project Settings → API.
"""

import logging
import jwt
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

# Import here to avoid circular imports with main.py
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from pipeline_v2.config import SUPABASE_JWT_SECRET

logger = logging.getLogger("prmpt.auth")

_AUTH_ENABLED = bool(SUPABASE_JWT_SECRET)

if not _AUTH_ENABLED:
    logger.warning(
        "[Auth] SUPABASE_JWT_SECRET is not set — endpoint authentication is DISABLED. "
        "Set this in production to secure the API."
    )

security = HTTPBearer(auto_error=False)


def _decode_token(token: str) -> dict:
    """Verify and decode a Supabase JWT. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_exp": True},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """
    FastAPI dependency for HTTP endpoints.
    Returns the decoded JWT payload dict (contains `sub` = user UUID).
    Passes through with a stub payload when auth is disabled in dev.
    """
    if not _AUTH_ENABLED:
        return {"sub": "dev-user", "role": "authenticated"}

    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Authorization header missing")

    return _decode_token(credentials.credentials)


async def require_ws_auth(websocket: WebSocket) -> dict:
    """
    WebSocket auth — reads token from query param `?token=<access_token>`.
    Closes the socket with code 4001 on failure.
    Returns decoded payload on success.
    """
    if not _AUTH_ENABLED:
        return {"sub": "dev-user", "role": "authenticated"}

    token = websocket.query_params.get("token", "")
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        raise WebSocketDisconnect(code=4001)

    try:
        return _decode_token(token)
    except HTTPException as e:
        await websocket.close(code=4001, reason=e.detail)
        raise WebSocketDisconnect(code=4001)
