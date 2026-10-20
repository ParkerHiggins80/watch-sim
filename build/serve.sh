#!/usr/bin/env bash
# Serve dist/ on http://localhost:8080 (any static web server works; this is just the simplest)
set -euo pipefail
SIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 -m http.server "${PORT:-8080}" --bind 127.0.0.1 --directory "$SIM_DIR/dist"
