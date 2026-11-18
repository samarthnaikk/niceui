#!/usr/bin/env bash
# Open the learning chat, starting its server when it is not running.
#
#   openc            start (or reuse) the server and open the browser
#   openc --stop     stop the server this script started
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-5180}"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/niceui"
LOG="$STATE/server.log"
PIDFILE="$STATE/server.pid"
mkdir -p "$STATE"

NODE24="$HOME/.local/share/fnm/node-versions/v24.22.3/installation/bin"
[[ -d "$NODE24" ]] && export PATH="$NODE24:$PATH"

alive() { curl -sf -o /dev/null "http://localhost:$PORT/app/info" 2>/dev/null; }

if [[ "${1:-}" == "--stop" ]]; then
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "niceui stopped"
  else
    echo "niceui is not running from this launcher"
  fi
  exit 0
fi

if ! alive; then
  if [[ ! -f "$ROOT/dist/index.html" ]]; then
    echo "building…"
    ( cd "$ROOT" && bun run build )
  fi
  cd "$ROOT"
  PORT="$PORT" setsid nohup node server/server.mjs >>"$LOG" 2>&1 </dev/null &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 80); do
    alive && break
    sleep 0.25
  done
fi

if ! alive; then
  echo "niceui did not start. Log: $LOG" >&2
  tail -n 10 "$LOG" >&2 || true
  exit 1
fi

URL="http://localhost:$PORT/"
echo "niceui  $URL"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
fi
