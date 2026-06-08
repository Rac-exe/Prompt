"""
JWT authentication — mirrors the pattern from the optimizer service.
Supports ES256 via JWKS (new Supabase default) and HS256 fallback.
"""

import logging
import os
import socket
import uuid
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

from app.config import SUPABASE_URL, SUPABASE_JWT_SECRET, APP_ENV

logger = logging.getLogger("code-intel.auth")

_AUTH_ENABLED = bool(SUPABASE_URL or SUPABASE_JWT_SECRET)
_IS_PRODUCTION = APP_ENV.lower() == "production"

# Development CLI smoke tests often run against the local service without a
# browser Supabase session. Keep production strict, but allow local tools to use
# a stable dev identity when APP_ENV is not production.
_ALLOW_DEV_CLI_AUTH = (
    not _IS_PRODUCTION
    and os.environ.get("PRMPT_ALLOW_DEV_CLI_AUTH", "1").lower()
    not in {"0", "false", "no", "off"}
)
_DEV_AUTH_TOKEN = os.environ.get("PRMPT_DEV_AUTH_TOKEN", "dev-cli-token")

# Stable per-machine dev UUID so local SQLite projects survive service restarts
# while still avoiding collisions across different developer machines.
_DEV_USER_ID = os.environ.get("PRMPT_DEV_USER_ID") or str(uuid.uuid5(
    uuid.NAMESPACE_DNS,
    f"prmpt-dev-{socket.gethostname()}",
))

if not _AUTH_ENABLED:
    if _IS_PRODUCTION:
        logger.critical(
            "[Auth] FATAL: Neither SUPABASE_URL nor SUPABASE_JWT_SECRET is set in production."
        )
        raise SystemExit(1)
    logger.warning(
        "[Auth] Auth is DISABLED — only acceptable in development. "
        "Dev user ID: %s",
        _DEV_USER_ID,
    )
elif _ALLOW_DEV_CLI_AUTH:
    logger.warning(
        "[Auth] Development CLI auth fallback is ENABLED. Missing bearer tokens "
        "or Bearer %s will use dev user ID: %s",
        _DEV_AUTH_TOKEN,
        _DEV_USER_ID,
    )

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
            logger.warning(f"[Auth] JWKS verification failed, trying HS256: {e}")

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

    raise HTTPException(status_code=401, detail="Token verification failed")


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> dict:
    if not _AUTH_ENABLED:
        logger.debug("Auth bypassed (disabled in dev mode), returning stable dev UUID")
        return _dev_payload()

    if not credentials or not credentials.credentials:
        if _ALLOW_DEV_CLI_AUTH:
            logger.debug("Auth bypassed for dev CLI request, returning stable dev UUID")
            return _dev_payload()
        logger.warning("Request rejected: missing Authorization header")
        raise HTTPException(status_code=401, detail="Authorization header missing")

    if _is_dev_cli_token(credentials.credentials):
        logger.debug("Auth bypassed for dev CLI bearer token, returning stable dev UUID")
        return _dev_payload()

    payload = _decode_token(credentials.credentials)
    logger.debug(f"Auth ok: user={payload.get('sub')}, role={payload.get('role')}")
    return payload
