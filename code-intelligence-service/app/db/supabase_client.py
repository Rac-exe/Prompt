import logging
from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

logger = logging.getLogger("code-intel.db")

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
        logger.info("[DB] Supabase client initialized")
    return _client
