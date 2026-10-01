#!/usr/bin/env bash
set -uo pipefail

pick_free_port() {
  node -e "const net=require('node:net'); const s=net.createServer(); s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); });"
}

SERVER_PORT=${SERVER_PORT:-auto}
VITE_PORT=${VITE_PORT:-auto}
if [ "${SERVER_PORT}" = "auto" ]; then
  SERVER_PORT=$(pick_free_port)
fi
if [ "${VITE_PORT}" = "auto" ]; then
  VITE_PORT=$(pick_free_port)
fi
TAILSCALE_REMOTE=${TAILSCALE_REMOTE:-0}
if [ "$TAILSCALE_REMOTE" = "1" ]; then
  VITE_HOST="0.0.0.0"
  SERVER_LISTEN="0.0.0.0"
else
  VITE_HOST="127.0.0.1"
  SERVER_LISTEN=""
fi
URL="http://localhost:${VITE_PORT}/?serverURL=http://localhost:${SERVER_PORT}"

# The development server serves its own Television home, inside this
# checkout by default, so it never uses the developer's default home. It runs
# without the bearer token because the browser URL above carries none.
DEV_HOME=${TV_DEV_HOME:-"$(pwd)/.tv-dev-home"}
TV=(npx tsx packages/cli/src/index.ts --home "${DEV_HOME}")

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    ss -ltn "sport = :$1" | grep -q ":$1"
  fi
}

if port_in_use "${SERVER_PORT}"; then
  echo "error: server port ${SERVER_PORT} is already in use" >&2
  exit 1
fi
if port_in_use "${VITE_PORT}"; then
  echo "error: Vite port ${VITE_PORT} is already in use" >&2
  exit 1
fi

# Television's server serves live canonical artifact assets at /canonical/v2/* and
# bundled views at /views/*. They're fast to build and rarely change, so rebuild
# unconditionally rather than stale-guess.
npm --workspace @telepath-computer/television-server run build
npm --workspace @telepath-computer/television run build:views

"${TV[@]}" config set port "${SERVER_PORT}" auth false listen "${SERVER_LISTEN}" || exit 1

cleanup() {
  kill -- -"$VITE_PID" -"$SERVER_PID" 2>/dev/null
  wait "$VITE_PID" "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

setsid npx vite --config packages/web/vite.config.ts --host "${VITE_HOST}" --port "${VITE_PORT}" --strictPort &
VITE_PID=$!
setsid "${TV[@]}" serve &
SERVER_PID=$!

while true; do
  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    echo "error: vite exited unexpectedly" >&2
    exit 1
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "error: server exited unexpectedly" >&2
    exit 1
  fi
  if curl -s "http://localhost:${VITE_PORT}" > /dev/null 2>&1 && curl -s "http://localhost:${SERVER_PORT}/health" > /dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

echo ""
echo "Browser dev ready:"
echo "  ${URL}"
if [ "$TAILSCALE_REMOTE" = "1" ]; then
  echo "  Remote: http://<tailscale-hostname>:${VITE_PORT}/?serverURL=http://<tailscale-hostname>:${SERVER_PORT}"
fi
echo "Television home: ${DEV_HOME}"
echo "  Pass --home ${DEV_HOME} to tv commands that should reach this server."
echo ""

wait
