"""
Keep web pages away from the local API.

The service has no login, so a page open in the user's browser must not be
able to call it on 127.0.0.1. Browsers send an Origin header on cross-origin
requests and on every WebSocket handshake; the desktop app talks to us from
Node.js (axios, fetch, ws), which sends none. So: requests without an Origin,
or from this service's own origin (the graph visualizer page), go through;
any other origin is rejected unless listed in ALLOWED_ORIGINS.
"""

from __future__ import annotations

import os


def _allowed_origins_from_env() -> set[str]:
    raw = os.environ.get("ALLOWED_ORIGINS", "")
    return {o.strip().rstrip("/") for o in raw.split(",") if o.strip() and o.strip() != "*"}


class BrowserOriginGuard:
    def __init__(self, app, allowed_origins: set[str] | None = None) -> None:
        self.app = app
        self.allowed = allowed_origins if allowed_origins is not None else _allowed_origins_from_env()

    def _is_allowed(self, scope) -> bool:
        headers = dict(scope.get("headers") or [])
        origin = headers.get(b"origin", b"").decode("latin-1").strip().rstrip("/")
        if not origin:
            return True
        host = headers.get(b"host", b"").decode("latin-1").strip()
        if host and origin in (f"http://{host}", f"https://{host}"):
            return True
        return origin in self.allowed

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] in ("http", "websocket") and not self._is_allowed(scope):
            if scope["type"] == "http":
                body = b'{"detail":"Requests from web pages are not allowed"}'
                await send({
                    "type": "http.response.start",
                    "status": 403,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                })
                await send({"type": "http.response.body", "body": body})
            else:
                await receive()  # websocket.connect
                await send({"type": "websocket.close", "code": 1008})
            return
        await self.app(scope, receive, send)
