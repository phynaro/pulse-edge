@echo off
title PULSE Edge Stack Starter (Windows)
echo =============================================
echo   🚀 Starting PULSE Edge IoT Stack (Dev)...
echo =============================================

:: 1. Start local Unified Edge Server (Hosts API & background Agent)
echo [1/2] Starting Unified Edge Server...
start "Pulse Edge Server" dotnet run --project src\Pulse.Edge.Api\Pulse.Edge.Api.csproj

:: 2. Wait a few seconds for API setup, then start UI
echo Waiting for services to boot...
timeout /t 5 /nobreak > nul

echo [2/2] Starting Vite Web UI...
cd src\Pulse.Edge.UI
start "Pulse Edge UI" pnpm dev

echo =============================================
echo   ✅ All development services launched!
echo   Close the popped-up command prompts to stop.
echo =============================================
cd ..
