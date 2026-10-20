#!/usr/bin/env bash
# Runs once when the Codespace is created (postCreateCommand in devcontainer.json).
# Clones the firmware repos next to watch-sim, sets up VS Code for the /workspaces
# folder, and does a first build so the simulator has something to show.
set -uo pipefail

SIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(dirname "$SIM_DIR")"

echo "== Cloning firmware repos from repos.json"
python3 "$SIM_DIR/tools/repos.py" list | while read -r name github; do
  if [ -d "$ROOT/$name/.git" ]; then
    echo "$name: already cloned"
  else
    # The Codespace's token can read and write these repos because devcontainer.json
    # asks for that permission (you approve it when creating the Codespace).
    git clone "https://github.com/$github.git" "$ROOT/$name" || echo "warning: could not clone $github"
  fi
done

if ! python3 "$SIM_DIR/tools/repos.py" check-devcontainer; then
  echo "warning: devcontainer.json doesn't request write access for every repo in repos.json."
  echo "         Run tools/repos.py sync-devcontainer, commit, and rebuild the Codespace."
fi

echo "== Fetching LVGL"
git -C "$SIM_DIR" submodule update --init

# VS Code opens /workspaces (both repos side by side). Its settings live in
# watch-sim/vscode/ so they are versioned; link them into place.
if [ ! -e "$ROOT/.vscode" ]; then
  ln -s "$SIM_DIR/vscode" "$ROOT/.vscode"
fi

echo "== First build"
python3 "$SIM_DIR/build/compile.py" || echo "warning: first build failed; fix the errors and press Compile (or Ctrl+Shift+B)"
