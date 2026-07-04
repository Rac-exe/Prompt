"""
JWT authentication for hosted Python service endpoints.

Every protected endpoint calls require_auth() (HTTP) or require_ws_auth()
(WebSocket). Both verify the Supabase-issued access token and return the
decoded payload containing the user UUID as `sub`.

Supports both ES256 (new Supabase default, verified via JWKS) and HS256
(legacy, verified via SUPABASE_JWT_SECRET). ES256 is tried first.
"""

import logging
import os
import socket
import uuid
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

logger = logging.getLogger("prmpt.auth")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
_APP_ENV = os.environ.get("APP_ENV", "development")

_AUTH_ENABLED = bool(SUPABASE_URL or SUPABASE_JWT_SECRET)
_IS_PRODUCTION = _APP_ENV.lower() == "production"
_ALLOW_DEV_CLI_AUTH = (
    not _IS_PRODUCTION
    and os.environ.get("PRMPT_ALLOW_DEV_CLI_AUTH", "1").lower()
    not in {"0", "false", "no", "off"}
)
_DEV_AUTH_TOKEN = os.environ.get("PRMPT_DEV_AUTH_TOKEN", "dev-cli-token")
_DEV_USER_ID = os.environ.get("PRMPT_DEV_USER_ID") or str(uuid.uuid5(
    uuid.NAMESPACE_DNS,
    f"prmpt-dev-{socket.gethostname()}",
))

if not _AUTH_ENABLED:
    if _IS_PRODUCTION:
        logger.critical(
            "[Auth] FATAL: Neither SUPABASE_URL nor SUPABASE_JWT_SECRET is set in "
            "production. Set SUPABASE_URL (and optionally SUPABASE_JWT_SECRET) from "
            "your Supabase dashboard."
        )
        raise SystemExit(1)
    logger.warning(
        "[Auth] SUPABASE_URL/SUPABASE_JWT_SECRET not set — endpoint auth is DISABLED. "
        "Only acceptable in development."
    )
elif _ALLOW_DEV_CLI_AUTH:
    logger.warning(
        "[Auth] Development CLI auth fallback is ENABLED. Missing bearer tokens "
        "or Bearer %s will use dev user ID: %s",
        _DEV_AUTH_TOKEN,
        _DEV_USER_ID,
    )

# JWKS client for ES256 verification (new Supabase default)
_jwks_client: PyJWKClient | None = None
if SUPABASE_URL:
    _JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    _jwks_client = PyJWKClient(_JWKS_URL, cache_keys=True)
    logger.info(f"[Auth] JWKS client initialized: {_JWKS_URL}")

security = HTTPBearer(auto_error=False)


def _dev_payload() -> dict:
    return {"sub": _DEV_USER_ID, "role": "authenticated", "dev_cli": True}


def _is_dev_cli_token(token: str | None) -> bool:
    return bool(_ALLOW_DEV_CLI_AUTH and token and token == _DEV_AUTH_TOKEN)


def _decode_token(token: str) -> dict:
    """
    Verify and decode a Supabase JWT.
    Tries ES256 via JWKS first (new Supabase), falls back to HS256 (legacy).
    Raises HTTPException on failure.
    """
    # --- ES256 via JWKS (new Supabase default) ---
    if _jwks_client:
        try:
            signing_key = _jwks_client.get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
                options={"verify_exp": True},
            )
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidAudienceError:
            raise HTTPException(status_code=401, detail="Invalid token audience")
        except jwt.InvalidTokenError as e:
            raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
        except Exception as e:
            # JWKS fetch failed or key not found — fall through to HS256
            logger.warning(f"[Auth] JWKS verification failed, trying HS256 fallback: {e}")

    # --- HS256 legacy fallback ---
    if SUPABASE_JWT_SECRET:
        try:
            return jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                options={"verify_exp": True},
            )
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidAudienceError:
            raise HTTPException(status_code=401, detail="Invalid token audience")
        except jwt.InvalidTokenError as e:
            raise HTTPException(status_code=401, detail=f"Invalid token: {e}")

    raise HTTPException(status_code=401, detail="Token verification failed — no valid verification method configured")


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    """
    FastAPI dependency for HTTP endpoints.
    Returns the decoded JWT payload dict (contains `sub` = user UUID).
    Passes through with a stub payload when auth is disabled in dev.
    """
    if not _AUTH_ENABLED:
        return _dev_payload()

    if not credentials or not credentials.credentials:
        if _ALLOW_DEV_CLI_AUTH:
            return _dev_payload()
        raise HTTPException(status_code=401, detail="Authorization header missing")

    if _is_dev_cli_token(credentials.credentials):
        return _dev_payload()

    return _decode_token(credentials.credentials)


async def require_ws_auth(websocket: WebSocket) -> dict:
    """
    WebSocket auth — reads token from query param `?token=<access_token>`.
    Closes the socket with code 4001 on failure.
    Returns decoded payload on success.
    """
    if not _AUTH_ENABLED:
        return _dev_payload()

    token = websocket.query_params.get("token", "")
    if not token:
        if _ALLOW_DEV_CLI_AUTH:
            return _dev_payload()
        await websocket.close(code=4001, reason="Missing auth token")
        raise WebSocketDisconnect(code=4001)

    if _is_dev_cli_token(token):
        return _dev_payload()

    try:
        return _decode_token(token)
    except HTTPException as e:
        await websocket.close(code=4001, reason=e.detail)
        raise WebSocketDisconnect(code=4001)
