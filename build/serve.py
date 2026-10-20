#!/usr/bin/env python3
"""Serves dist/ at http://localhost:8080 (PORT env var to change).

Any static web server can host dist/. This one adds no-cache headers so a reload
after a rebuild always picks up the new watch.wasm instead of a cached copy.
"""
import functools
import http.server
import os

DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    os.makedirs(DIST, exist_ok=True)
    port = int(os.environ.get("PORT", "8080"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=DIST))
    print(f"Serving {DIST} at http://localhost:{port}")
    server.serve_forever()
