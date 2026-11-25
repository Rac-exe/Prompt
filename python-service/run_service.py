"""Entry point used by the desktop app (and by the bundled executable).

Runs the FastAPI app with uvicorn on 127.0.0.1. Equivalent to:
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
"""
import argparse
import os
import sys
import threading
import time

import uvicorn


def _exit_when_parent_dies(parent_pid: int) -> None:
    """Stop this service if the desktop app that started it goes away
    (crash, Task Manager), so no orphaned server keeps the port busy."""
    if sys.platform == "win32":
        import ctypes

        SYNCHRONIZE = 0x00100000
        handle = ctypes.windll.kernel32.OpenProcess(SYNCHRONIZE, False, parent_pid)
        if not handle:
            return
        ctypes.windll.kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)  # INFINITE
        os._exit(0)
    while True:
        try:
            os.kill(parent_pid, 0)
        except OSError:
            os._exit(0)
        time.sleep(2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()

    parent = os.environ.get("PRMPT_PARENT_PID")
    if parent and parent.isdigit():
        threading.Thread(target=_exit_when_parent_dies, args=(int(parent),), daemon=True).start()

    from app.main import app  # imported here so --help works without heavy imports

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
