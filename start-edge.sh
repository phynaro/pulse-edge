#!/bin/bash

# PULSE Edge Stack Starter Utility
# Press Ctrl+C to kill all services cleanly.

echo "============================================="
echo "  🚀 Starting PULSE Edge IoT Stack..."
echo "============================================="

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

# Trap Ctrl+C (SIGINT) and exit signals to kill all child processes automatically
trap "echo -e '\n🛑 Stopping all services...'; kill 0" EXIT

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

if [ "$HOSTING_MODE" == "SinglePort" ]; then
  # 1. Start local Unified Edge Server (Hosts API & background Agent)
  echo "🔌 Starting Unified Edge Server (on http://localhost:5288)..."
  dotnet run --project src/Pulse.Edge.Api/Pulse.Edge.Api.csproj &
else
  # 1. Start separate Edge Agent Daemon
  echo "🤖 Starting Standalone Edge Agent Daemon..."
  dotnet run --project src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj &

  # 2. Start separate local REST API
  echo "🔌 Starting Edge API Server (on http://localhost:5288)..."
  dotnet run --project src/Pulse.Edge.Api/Pulse.Edge.Api.csproj &
fi

# Wait for the API to be healthy before starting the UI
wait_for_http "http://localhost:5288/api/dashboard" "Edge API" 90

# Start local React Web UI (only after API is up)
echo "💻 Starting Vite Web UI Server (on http://localhost:8080)..."
cd src/Pulse.Edge.UI
pnpm dev &

# Keep script alive and wait for all background tasks
wait

