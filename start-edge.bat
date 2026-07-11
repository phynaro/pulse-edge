@echo off
setlocal enabledelayedexpansion
title PULSE Edge Stack Starter (Windows)
echo =============================================
echo   🚀 Starting PULSE Edge IoT Stack (Dev)...
echo =============================================

:: Stop process trees created by a previous launcher run. Window titles are
:: unique to PULSE Edge, so unrelated dotnet and Node processes are preserved.
echo [0/3] Stopping any running PULSE Edge stack...
taskkill /FI "WINDOWTITLE eq Pulse Edge Server*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Pulse Edge Agent*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Pulse Edge API*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Pulse Edge UI*" /T /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Detect hosting mode from appsettings.Development.json (fallback to appsettings.json)
set HOSTING_MODE=SinglePort
if exist src\Pulse.Edge.Api\appsettings.Development.json (
    for /f "tokens=2 delims=:, " %%a in ('findstr /i "hostingMode" src\Pulse.Edge.Api\appsettings.Development.json') do (
        set val=%%~a
        set val=!val:"=!
        set val=!val: =!
        set HOSTING_MODE=!val!
    )
) else if exist src\Pulse.Edge.Api\appsettings.json (
    for /f "tokens=2 delims=:, " %%a in ('findstr /i "hostingMode" src\Pulse.Edge.Api\appsettings.json') do (
        set val=%%~a
        set val=!val:"=!
        set val=!val: =!
        set HOSTING_MODE=!val!
    )
)

echo 📢 Detected Hosting Mode: !HOSTING_MODE!

if "!HOSTING_MODE!"=="SinglePort" (
    :: 1. Start local Unified Edge Server (Hosts API & background Agent)
    echo [1/2] Starting Unified Edge Server...
    start "Pulse Edge Server" dotnet run --project src\Pulse.Edge.Api\Pulse.Edge.Api.csproj
) else (
    :: 1. Start separate Edge Agent Daemon
    echo [1/3] Starting Standalone Edge Agent Daemon...
    start "Pulse Edge Agent" dotnet run --project src\Pulse.Edge.Agent\Pulse.Edge.Agent.csproj

    :: 2. Start separate local REST API
    echo [2/3] Starting Edge API Server...
    start "Pulse Edge API" dotnet run --project src\Pulse.Edge.Api\Pulse.Edge.Api.csproj
)

:: 2. Wait a few seconds for API setup, then start UI
echo Waiting for services to boot...
timeout /t 5 /nobreak > nul

echo [3/3] Starting Vite Web UI...
cd src\Pulse.Edge.UI
start "Pulse Edge UI" pnpm dev

echo =============================================
echo   ✅ All development services launched!
echo   Close the popped-up command prompts to stop.
echo =============================================
cd ..
