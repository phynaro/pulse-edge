@echo off
title PULSE Edge Stack Starter (Windows)
echo =============================================
echo   🚀 Starting PULSE Edge IoT Stack (Dev)...
echo =============================================

:: 1. Start Edge Agent Daemon
echo [1/3] Starting Edge Agent Daemon...
start "Pulse Edge Agent" dotnet run --project src\Pulse.Edge.Agent\Pulse.Edge.Agent.csproj

:: 2. Start local REST API
echo [2/3] Starting Edge API Server...
start "Pulse Edge API" dotnet run --project src\Pulse.Edge.Api\Pulse.Edge.Api.csproj

:: 3. Wait a few seconds for API setup, then start UI
echo Waiting for API services to boot...
timeout /t 5 /nobreak > nul

echo [3/3] Starting Vite Web UI...
cd src\Pulse.Edge.UI
start "Pulse Edge UI" npm run dev

echo =============================================
echo   ✅ All development services launched!
echo   Close the popped-up command prompts to stop.
echo =============================================
cd ..
