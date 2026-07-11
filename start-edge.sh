#!/bin/bash

# PULSE Edge Stack Starter Utility
# Press Ctrl+C to kill all services cleanly.

echo "============================================="
echo "  🚀 Starting PULSE Edge IoT Stack..."
echo "============================================="

ROOT_DIR="$PWD"
PID_FILE="$ROOT_DIR/.pulse-edge-dev.pids"

is_pulse_pid() {
  local pid="$1"
  local command_line cwd
  command_line=$(ps -p "$pid" -o command= 2>/dev/null || true)
  case "$command_line" in
    *Pulse.Edge*) return 0 ;;
  esac
  if command -v lsof >/dev/null 2>&1; then
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
    case "$cwd" in
      "$ROOT_DIR"|"$ROOT_DIR"/*) return 0 ;;
    esac
  fi
  return 1
}

stop_pid_tree() {
  local pid="$1"
  kill -0 "$pid" 2>/dev/null || return 0
  is_pulse_pid "$pid" || return 0
  # dotnet run and pnpm may each have a child process that owns the port.
  local children
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  [ -n "$children" ] && kill $children 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
}

stop_existing_stack() {
  local pids=""
  if [ -f "$PID_FILE" ]; then
    pids=$(awk '/^[0-9]+$/ { print $1 }' "$PID_FILE" | sort -u)
  fi

  # A standalone Agent in MultiPort mode does not own an HTTP port. If PID
  # tracking was interrupted or the PID file was removed, discover only Agent
  # executables launched from this workspace so an old polling process cannot
  # survive the restart.
  local workspace_agent_path="$ROOT_DIR/src/Pulse.Edge.Agent/bin/"
  local process_pid
  while IFS= read -r process_pid; do
    [ -n "$process_pid" ] && pids="$pids $process_pid"
  done < <(
    ps -axo pid=,command= 2>/dev/null | awk -v agent_path="$workspace_agent_path" '
      index($0, agent_path) && $0 ~ /\/Pulse\.Edge\.Agent([[:space:]]|$)/ { print $1 }
    '
  )

  # Compatibility fallback for a stack launched before PID tracking existed.
  # Only accept listeners whose command line identifies them as PULSE Edge.
  if command -v lsof >/dev/null 2>&1; then
    local listener command_line
    for listener in $(lsof -tiTCP:5288 -sTCP:LISTEN 2>/dev/null; lsof -tiTCP:8080 -sTCP:LISTEN 2>/dev/null); do
      command_line=$(ps -p "$listener" -o command= 2>/dev/null || true)
      case "$command_line" in
        *Pulse.Edge*|*pulse-edge*|*vite*) pids="$pids $listener" ;;
      esac
    done
  fi

  pids=$(echo "$pids" | tr ' ' '\n' | awk '/^[0-9]+$/ && !seen[$1]++')
  if [ -n "$pids" ]; then
    echo "♻️  Stopping the running PULSE Edge stack..."
    for pid in $pids; do stop_pid_tree "$pid"; done

    local attempts=0
    while [ "$attempts" -lt 20 ]; do
      local alive=""
      for pid in $pids; do is_pulse_pid "$pid" && kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
      [ -z "$alive" ] && break
      sleep 0.25
      attempts=$((attempts + 1))
    done
    for pid in $pids; do is_pulse_pid "$pid" && kill -9 "$pid" 2>/dev/null || true; done
    echo "✅ Previous PULSE Edge stack stopped."
  fi
  rm -f "$PID_FILE"
}

stop_existing_stack

# Check for 'initial' argument to reset database for onboarding tests
RESET_DB=false
for arg in "$@"; do
  if [ "$arg" == "initial" ]; then
    RESET_DB=true
  fi
done

if [ "$RESET_DB" == "true" ]; then
  echo "🧹 Resetting local database for initial onboarding test..."
  rm -f "$HOME/.pulse/edge.db"*
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    rm -f "/c/ProgramData/PULSE Edge/edge.db"* 2>/dev/null || true
  fi
fi

# Trap Ctrl+C (SIGINT), SIGTERM, and EXIT signals to kill all child processes cleanly
cleanup() {
  trap - EXIT SIGINT SIGTERM
  echo -e "\n🛑 Stopping all services..."
  local pids=""
  [ -f "$PID_FILE" ] && pids=$(awk '/^[0-9]+$/ { print $1 }' "$PID_FILE" | sort -u)
  [ -z "$pids" ] && pids=$(jobs -p)
  if [ -n "$pids" ]; then
    for pid in $pids; do stop_pid_tree "$pid"; done
    wait $pids 2>/dev/null
  fi
  rm -f "$PID_FILE"
  exit 0
}
trap cleanup EXIT SIGINT SIGTERM

# ─────────────────────────────────────────────────────────────────
# wait_for_http <url> <label> [timeout_seconds=60]
#   Polls <url> every 1 s until it returns HTTP 2xx/3xx.
#   Exits with error if the timeout is reached.
# ─────────────────────────────────────────────────────────────────
wait_for_http() {
  local url="$1"
  local label="$2"
  local timeout="${3:-60}"
  local elapsed=0

  echo "⏳ Waiting for $label to be ready at $url..."
  until curl -sf -o /dev/null "$url"; do
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "❌ Timed out after ${timeout}s waiting for $label. Aborting."
      exit 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "✅ $label is ready (${elapsed}s)"
}

# Detect hosting mode from appsettings config (default: SinglePort)
HOSTING_MODE="SinglePort"
if [ -f src/Pulse.Edge.Api/appsettings.Development.json ]; then
  HOSTING_MODE=$(grep -i '"hostingMode"' src/Pulse.Edge.Api/appsettings.Development.json | head -n 1 | awk -F'"' '{print $4}')
fi
if [ -z "$HOSTING_MODE" ] && [ -f src/Pulse.Edge.Api/appsettings.json ]; then
  HOSTING_MODE=$(grep -i '"hostingMode"' src/Pulse.Edge.Api/appsettings.json | head -n 1 | awk -F'"' '{print $4}')
fi
if [ -z "$HOSTING_MODE" ]; then
  HOSTING_MODE="SinglePort"
fi

echo "📢 Detected Hosting Mode: $HOSTING_MODE"

# Build the shared dependency graph once before the readiness timer starts.
# In MultiPort mode both executables reference the same projects, and allowing
# two concurrent `dotnet run` builds can duplicate work and exceed the timeout.
echo "🔨 Building PULSE Edge services..."
if ! dotnet build src/Pulse.Edge.Api/Pulse.Edge.Api.csproj; then
  echo "❌ PULSE Edge build failed. Aborting."
  exit 1
fi

if [ "$HOSTING_MODE" == "SinglePort" ]; then
  # 1. Start local Unified Edge Server (Hosts API & background Agent)
  echo "🔌 Starting Unified Edge Server (on http://localhost:5288)..."
  dotnet run --no-build --project src/Pulse.Edge.Api/Pulse.Edge.Api.csproj &
  echo $! >> "$PID_FILE"
else
  # 1. Start separate Edge Agent Daemon
  echo "🤖 Starting Standalone Edge Agent Daemon..."
  dotnet run --no-build --project src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj &
  echo $! >> "$PID_FILE"

  # 2. Start separate local REST API
  echo "🔌 Starting Edge API Server (on http://localhost:5288)..."
  dotnet run --no-build --project src/Pulse.Edge.Api/Pulse.Edge.Api.csproj &
  echo $! >> "$PID_FILE"
fi

# Wait for the API to be healthy before starting the UI
wait_for_http "http://localhost:5288/health" "Edge API" 90

# Start local React Web UI (only after API is up)
echo "💻 Starting Vite Web UI Server (on http://localhost:8080)..."
cd src/Pulse.Edge.UI
pnpm dev &
echo $! >> "$PID_FILE"

# Keep script alive and wait for all background tasks
wait
