"""
JWT authentication — mirrors the pattern from the optimizer service.
Supports ES256 via JWKS (new Supabase default) and HS256 fallback.
"""

import logging
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

from app.config import SUPABASE_URL, SUPABASE_JWT_SECRET, APP_ENV

logger = logging.getLogger("code-intel.auth")

_AUTH_ENABLED = bool(SUPABASE_URL or SUPABASE_JWT_SECRET)

if not _AUTH_ENABLED:
    if APP_ENV == "production":
        logger.critical(
            "[Auth] FATAL: Neither SUPABASE_URL nor SUPABASE_JWT_SECRET is set in production."
        )
        raise SystemExit(1)
    logger.warning("[Auth] Auth is DISABLED — only acceptable in development.")

_jwks_client: PyJWKClient | None = None
if SUPABASE_URL:
    _JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    _jwks_client = PyJWKClient(_JWKS_URL, cache_keys=True)
    logger.info(f"[Auth] JWKS client initialized: {_JWKS_URL}")

security = HTTPBearer(auto_error=False)


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
        return {"sub": "dev-user", "role": "authenticated"}

    if not credentials or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Authorization header missing")

    return _decode_token(credentials.credentials)
