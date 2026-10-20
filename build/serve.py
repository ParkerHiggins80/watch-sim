#!/usr/bin/env python3
"""Serves dist/ at http://localhost:8080 (PORT env var to change).

Any static web server can host dist/. This one adds no-cache headers so a reload
after a rebuild always picks up the new watch.wasm instead of a cached copy, and a
small API the panel uses to compile. The panel hides its compile controls when the
API is missing, so dist/ still works on a plain static server.

  GET  /api/status       last build result (.build/status.json) plus server state
  GET  /api/repos        firmware repos from repos.json that are cloned, and the selected one
  POST /api/build        start a build of the selected repo
  POST /api/select       {"repo": name}  pick the repo to build (Ctrl+Shift+B follows it too)
  POST /api/autocompile  {"enabled": bool}  rebuild when a firmware source file is saved
"""
import fcntl
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import time

SIM_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(SIM_DIR)
DIST = os.path.join(SIM_DIR, "dist")
WORK = os.path.join(SIM_DIR, ".build")
sys.path.insert(0, os.path.join(SIM_DIR, "build"))
import compile as builder  # noqa: E402  (build/compile.py)

# Folders auto compile watches in the firmware repo, and which files count
WATCH_DIRS = ("ui", "app", "hal")
WATCH_EXTS = (".c", ".h")


def cloned_repos():
    with open(os.path.join(SIM_DIR, "repos.json")) as f:
        repos = json.load(f)["repos"]
    return [r["name"] for r in repos if os.path.isfile(os.path.join(ROOT, r["name"], "prj.conf"))]


def builder_alive():
    """True if some compile.py (from any source) holds the build lock."""
    try:
        with open(os.path.join(WORK, "compile.lock"), "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(lock, fcntl.LOCK_UN)
            return False
    except BlockingIOError:
        return True


class Builds:
    """Runs compile.py in the background. A request that arrives mid-build queues one more."""

    def __init__(self):
        self.cond = threading.Condition()
        self.pending = False
        self.autocompile = False   # off by default, per the spec
        threading.Thread(target=self._worker, daemon=True).start()
        threading.Thread(target=self._watcher, daemon=True).start()

    def request(self):
        with self.cond:
            self.pending = True
            self.cond.notify()

    def _worker(self):
        while True:
            with self.cond:
                while not self.pending:
                    self.cond.wait()
                self.pending = False
            subprocess.run([sys.executable, os.path.join(SIM_DIR, "build", "compile.py")],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _snapshot(self):
        fw = os.path.join(ROOT, builder.default_repo())
        files = {}
        for top in [os.path.join(fw, d) for d in WATCH_DIRS]:
            for dirpath, _, names in os.walk(top):
                for n in names:
                    if n.endswith(WATCH_EXTS):
                        p = os.path.join(dirpath, n)
                        try:
                            files[p] = os.stat(p).st_mtime_ns
                        except OSError:
                            pass
        prj = os.path.join(fw, "prj.conf")
        if os.path.exists(prj):
            files[prj] = os.stat(prj).st_mtime_ns
        return files

    def _watcher(self):
        # Polling works the same in Codespaces and on a Mac, with no extra packages
        last = self._snapshot()
        while True:
            time.sleep(0.5)
            now = self._snapshot()
            if now != last and self.autocompile:
                self.request()
            last = now


BUILDS = None


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/status"):   # the panel polls this every second
            super().log_message(fmt, *args)

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return {}

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/status":
            status = builder.read_status()
            if status.get("state") == "building" and not builder_alive():
                status["state"] = "failed"   # the build was killed before it finished
                status["output"] = "Build was interrupted.\n"
                status["diagnostics"] = []
            status["autocompile"] = BUILDS.autocompile
            status["queued"] = BUILDS.pending
            self.send_json(status)
        elif path == "/api/repos":
            self.send_json({"repos": cloned_repos(), "selected": builder.default_repo()})
        else:
            super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self.read_json()
        if path == "/api/build":
            BUILDS.request()
            self.send_json({"ok": True})
        elif path == "/api/select":
            repo = body.get("repo")
            if repo not in cloned_repos():
                return self.send_json({"error": f"{repo} is not cloned"}, 400)
            os.makedirs(WORK, exist_ok=True)
            with open(builder.SELECTED, "w") as f:
                f.write(repo)
            BUILDS.request()
            self.send_json({"ok": True})
        elif path == "/api/autocompile":
            BUILDS.autocompile = bool(body.get("enabled"))
            self.send_json({"ok": True})
        else:
            self.send_error(404)


if __name__ == "__main__":
    os.makedirs(DIST, exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    BUILDS = Builds()
    port = int(os.environ.get("PORT", "8080"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=DIST))
    print(f"Serving {DIST} at http://localhost:{port}")
    server.serve_forever()
