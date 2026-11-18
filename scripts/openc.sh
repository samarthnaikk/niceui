#!/usr/bin/env bash
# Open the learning chat on a folder, starting its server when needed.
#
#   openc              open the folder you are standing in
#   openc ~/code/app   open another folder
#   openc --stop       stop the server this launcher started
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
current_dir() {
  curl -sf "http://localhost:$PORT/app/info" 2>/dev/null \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("directory",""))' 2>/dev/null || true
}
listener_pid() {
  ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true
}
is_ours() {
  [[ -n "${1:-}" ]] && { tr '\0' ' ' < "/proc/$1/cmdline"; } 2>/dev/null | grep -q 'server/server.mjs'
}
stop_server() {
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null || true)"
  is_ours "$pid" && kill "$pid" 2>/dev/null || true
  pid="$(listener_pid)"
  is_ours "$pid" && kill "$pid" 2>/dev/null || true
  rm -f "$PIDFILE"
  for _ in $(seq 1 20); do alive || return 0; sleep 0.25; done
}

if [[ "${1:-}" == "--stop" ]]; then
  stop_server
  echo "niceui stopped"
  exit 0
fi

DIR="$(cd "${1:-$PWD}" && pwd)"

if alive && [[ "$(current_dir)" != "$DIR" ]]; then
  stop_server
fi

if ! alive; then
  if [[ ! -f "$ROOT/dist/index.html" ]]; then
    echo "building…"
    ( cd "$ROOT" && bun run build )
  fi
  ( cd "$ROOT" && NICEUI_DIR="$DIR" PORT="$PORT" setsid nohup node server/server.mjs >>"$LOG" 2>&1 </dev/null & echo $! >"$PIDFILE" )
  for _ in $(seq 1 80); do alive && break; sleep 0.25; done
fi

if ! alive; then
  echo "niceui did not start. Log: $LOG" >&2
  tail -n 10 "$LOG" >&2 || true
  exit 1
fi

URL="http://localhost:$PORT/"
echo "niceui  $URL"
echo "folder  $DIR"
command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 &
