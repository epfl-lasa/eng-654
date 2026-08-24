#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8000}"
cd "$SCRIPT_DIR"
echo "ENG-654 lecture template"
echo "Serving: $SCRIPT_DIR"
echo "Open: http://localhost:$PORT"
echo "Press Ctrl+C to stop."
python3 -m http.server "$PORT"
