#!/usr/bin/env python3
"""Compiles a firmware repo and records the result for the simulator panel.

  build/compile.py              builds the repo picked in the panel (or the repos.json default)
  build/compile.py Smartwatch   builds a repo cloned next to watch-sim, by name
  build/compile.py path/to/repo builds any firmware repo

The Compile button, the VS Code build task (Ctrl+Shift+B) and the terminal all come
through here, so they share one lock (two builds never run at once) and one result
file, .build/status.json. The panel watches that file: it restarts the watch after a
good build and lists the errors after a failed one. Compiler output is passed through
unchanged so VS Code's gcc problem matcher can read it.
"""
import fcntl
import json
import os
import re
import subprocess
import sys
import time

SIM_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(SIM_DIR)
WORK = os.path.join(SIM_DIR, ".build")
STATUS = os.path.join(WORK, "status.json")
SELECTED = os.path.join(WORK, "selected-repo")

# file:line:col: error: message   (clang, which emcc runs, prints gcc-style diagnostics)
DIAG = re.compile(r"^(?P<file>[^\s:][^:]*):(?P<line>\d+):(?P<col>\d+): (?P<sev>fatal error|error|warning): (?P<msg>.*)$")
# wasm-ld: error: undefined symbol: foo   (linker errors have no line number)
TOOL_DIAG = re.compile(r"^(?P<file>wasm-ld): (?P<sev>error|warning): (?P<msg>.*)$")


def default_repo():
    try:
        with open(SELECTED) as f:
            name = f.read().strip()
        if name and os.path.isdir(os.path.join(ROOT, name)):
            return name
    except OSError:
        pass
    out = subprocess.run([sys.executable, os.path.join(SIM_DIR, "tools", "repos.py"), "default"],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def resolve(arg):
    """A repo name means the folder next to watch-sim; anything else is a path."""
    if os.sep not in arg and os.path.isdir(os.path.join(ROOT, arg)):
        return os.path.join(ROOT, arg)
    return os.path.abspath(arg)


def read_status():
    try:
        with open(STATUS) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"id": 0}


def write_status(status):
    # Write then rename, so the server never reads a half-written file
    tmp = STATUS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(status, f)
    os.replace(tmp, STATUS)


def parse(output):
    diags = []
    for line in output.splitlines():
        m = DIAG.match(line) or TOOL_DIAG.match(line)
        if not m:
            continue
        d = m.groupdict()
        diags.append({
            "file": d["file"],
            "line": int(d.get("line") or 0),
            "col": int(d.get("col") or 0),
            "severity": "warning" if d["sev"] == "warning" else "error",
            "message": d["msg"].replace("CMakeFiles/watch.dir", ""),   # object paths -> source paths
        })
    return diags


def main():
    fw_dir = resolve(sys.argv[1] if len(sys.argv) > 1 else default_repo())
    repo = os.path.basename(fw_dir)
    os.makedirs(WORK, exist_ok=True)

    with open(os.path.join(WORK, "compile.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)   # waits here if another build is running

        last = read_status()
        write_status({**last, "state": "building", "repo": repo, "started": time.time()})

        started = time.time()
        proc = subprocess.Popen([os.path.join(SIM_DIR, "build", "build.sh"), fw_dir],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        lines = []
        for line in proc.stdout:
            sys.stdout.write(line)   # live output for the terminal / problem matcher
            sys.stdout.flush()
            lines.append(line)
        code = proc.wait()
        output = "".join(lines)

        write_status({
            "id": last.get("id", 0) + 1,
            "state": "ok" if code == 0 else "failed",
            "repo": repo,
            "started": started,
            "finished": time.time(),
            "diagnostics": parse(output),
            "output": output[-20000:],   # the tail is where the errors are
        })
    sys.exit(code)


if __name__ == "__main__":
    main()
