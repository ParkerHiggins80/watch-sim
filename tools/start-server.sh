#!/usr/bin/env bash
# Starts the simulator web server in the background (postAttachCommand in devcontainer.json).
# It runs once VS Code is connected, so Codespaces sees port 8080 appear and opens the
# simulator in a Simple Browser pane (onAutoForward: openPreview). Don't move this to
# postStartCommand or add 8080 to forwardPorts: the port is then opened before VS Code
# is attached, or forwarded statically, and the pane never opens.
SIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$SIM_DIR/.build"
if ! (exec 3<>/dev/tcp/127.0.0.1/8080) 2>/dev/null; then
  nohup setsid python3 "$SIM_DIR/build/serve.py" >"$SIM_DIR/.build/server.log" 2>&1 &
fi
