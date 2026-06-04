#!/bin/bash

# PULSE Edge Stack Starter Utility
# Press Ctrl+C to kill all services cleanly.

echo "============================================="
echo "  🚀 Starting PULSE Edge IoT Stack..."
echo "============================================="

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

# 1. Start Edge Agent Daemon
echo "🤖 Starting Edge Agent Daemon..."
dotnet run --project src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj &

# 2. Start local REST API
echo "🔌 Starting Edge API Server (on http://localhost:5288)..."
dotnet run --project src/Pulse.Edge.Api/Pulse.Edge.Api.csproj &

# Wait for the API to be healthy before starting the UI
wait_for_http "http://localhost:5288/api/dashboard" "Edge API" 90

# 3. Start local React Web UI (only after API is up)
echo "💻 Starting Vite Web UI Server (on http://localhost:8080)..."
cd src/Pulse.Edge.UI
npm run dev &

# Keep script alive and wait for all background tasks
wait
