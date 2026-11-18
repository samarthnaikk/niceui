#!/usr/bin/env bash
# Open OpenChamber on a folder, the way `opencode` opens a session there.
#
#   openc                 -> current folder
#   openc ~/code/app      -> that folder
#   openc --stop          -> stop the server started by this command
#
# The folder is passed as ?dir=..., which the app adds as a project and selects.
set -euo pipefail

ROOT="${OPENCHAMBER_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${OPENCHAMBER_PORT:-5180}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}"
LOG="$STATE_DIR/openc.log"
mkdir -p "$STATE_DIR"

# Node 24 is what the web package declares; fnm keeps it out of a login shell's PATH.
NODE24="$HOME/.local/share/fnm/node-versions/v24.22.3/installation/bin"
if [[ -d "$NODE24" ]]; then
  export PATH="$NODE24:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "openc: bun is not on PATH" >&2
  exit 1
fi

running() {
  curl -sf -o /dev/null "http://localhost:$PORT/api/info" 2>/dev/null
}

if [[ "${1:-}" == "--stop" ]]; then
  cd "$ROOT"
  exec bun packages/web/bin/cli.js stop --port "$PORT"
fi

DIR="${1:-$PWD}"
if [[ ! -d "$DIR" ]]; then
  echo "openc: not a directory: $DIR" >&2
  exit 1
fi
DIR="$(cd "$DIR" && pwd)"

if [[ ! -f "$ROOT/packages/web/dist/index.html" || ! -f "$ROOT/packages/web/build/server/index.js" ]]; then
  echo "openc: build missing or incomplete. Run: cd $ROOT && bun run build:web" >&2
  exit 1
fi

if ! running; then
  echo "openc: starting on port $PORT (log: $LOG)"
  # `serve` daemonizes itself and returns once the daemon reports ready; backgrounding it here stops that.
  ( cd "$ROOT" && bun packages/web/bin/cli.js serve --port "$PORT" >"$LOG" 2>&1 ) || true
  for _ in $(seq 1 120); do
    if running; then break; fi
    sleep 0.5
  done
fi

if ! running; then
  echo "openc: server did not start on port $PORT. Log: $LOG" >&2
  tail -n 15 "$LOG" >&2 || true
  exit 1
fi

URL="http://localhost:$PORT/?dir=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$DIR")"
echo "OpenChamber  $URL"
echo "project      $DIR"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
fi

# A copy on PATH: ln -s "$PWD/scripts/openc.sh" ~/.local/bin/openc
