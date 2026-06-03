#!/bin/bash

# PULSE Edge Stack Starter Utility
# Press Ctrl+C to kill all services cleanly.

echo "============================================="
echo "  🚀 Starting PULSE Edge IoT Stack..."
echo "============================================="

# Trap Ctrl+C (SIGINT) and exit signals to kill all child processes automatically
trap "echo -e '\n🛑 Stopping all services...'; kill 0" EXIT

# 1. Start SQLite Edge Agent Daemon
echo "🤖 Starting Edge Agent Daemon..."
dotnet run --project src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj &
sleep 1.5

# 2. Start local REST API
echo "🔌 Starting Edge API Server (on http://localhost:5288)..."
dotnet run --project src/Pulse.Edge.Api/Pulse.Edge.Api.csproj &
sleep 1.5

# 3. Start local React Web UI
echo "💻 Starting Vite Web UI Server (on http://localhost:8080)..."
cd src/Pulse.Edge.UI
npm run dev &

# Keep script alive and wait for all background tasks
wait
