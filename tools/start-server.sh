#!/usr/bin/env bash
# Starts the simulator web server in the background (postStartCommand in devcontainer.json).
# Codespaces sees port 8080 open and shows the simulator in a VS Code Simple Browser pane.
SIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$SIM_DIR/.build"
if ! (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then
  nohup setsid python3 "$SIM_DIR/build/serve.py" >"$SIM_DIR/.build/server.log" 2>&1 &
fi
