import logging
from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

logger = logging.getLogger("code-intel.db")
#
# DEPRECATED (Phase 1 local migration):
# Code-intel chunk/graph runtime no longer uses Supabase. This client remains
# for auth/registry metadata flows and rollback safety only.

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            logger.error(
                "Missing database credentials: SUPABASE_URL=%s, SERVICE_KEY=%s",
                "set" if SUPABASE_URL else "MISSING",
                "set" if SUPABASE_SERVICE_ROLE_KEY else "MISSING",
            )
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        masked_url = SUPABASE_URL[:30] + "..." if len(SUPABASE_URL) > 30 else SUPABASE_URL
        logger.info(f"Supabase client initialized (url={masked_url})")
    return _client
