"""
Local preview server for the site that disables browser caching, so a plain
reload always shows the latest edits (python -m http.server lets browsers
reuse stale CSS/JS without asking).

  python3 perf/serve.py [PORT]   # default 4000, serves the repo root
"""
from __future__ import annotations

import http.server
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4000
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(NoCacheHandler, directory=str(ROOT)))
    print(f"serving {ROOT} at http://127.0.0.1:{port}/", flush=True)
    srv.serve_forever()
