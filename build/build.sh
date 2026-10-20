#!/usr/bin/env bash
# Compile the firmware's ui/ with LVGL into dist/ (static HTML + JS + WASM).
#   build/build.sh                 builds ../Smartwatch
#   build/build.sh path/to/repo    builds another firmware repo
set -euo pipefail

SIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FW_DIR="$(cd "${1:-$SIM_DIR/../Smartwatch}" && pwd)"

# Find Emscripten: already on PATH, or in $EMSDK, or in ~/emsdk
if ! command -v emcc >/dev/null; then
  for d in "${EMSDK:-}" "$HOME/emsdk"; do
    if [ -n "$d" ] && [ -f "$d/emsdk_env.sh" ]; then
      source "$d/emsdk_env.sh" >/dev/null 2>&1
      break
    fi
  done
fi
command -v emcc >/dev/null || { echo "error: Emscripten (emcc) not found. See README.md." >&2; exit 1; }

if [ ! -f "$SIM_DIR/third_party/lvgl/lvgl.h" ]; then
  git -C "$SIM_DIR" submodule update --init
fi

WORK="$SIM_DIR/.build"
emcmake cmake -S "$SIM_DIR/build" -B "$WORK" -DFW_DIR="$FW_DIR" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$WORK" -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
echo "Built $FW_DIR -> $SIM_DIR/dist"
