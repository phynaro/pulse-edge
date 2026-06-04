@echo off
setlocal enabledelayedexpansion

echo =============================================
echo   📦 PULSE Edge Windows Build Utility
echo =============================================

:: 1. Check prerequisites
echo Checking prerequisites...
where dotnet >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Error: .NET SDK is not installed or not in PATH.
    exit /b 1
)

:: Detect package manager
where pnpm >nul 2>nul
if %errorlevel% eq 0 (
    set PKG_MANAGER=pnpm
    set INSTALL_CMD=pnpm install
    set BUILD_CMD=pnpm run build
) else (
    where npm >nul 2>nul
    if %errorlevel% eq 0 (
        set PKG_MANAGER=npm
        set INSTALL_CMD=npm install
        set BUILD_CMD=npm run build
    ) else (
        echo ❌ Error: Neither pnpm nor Node.js/npm is installed or in PATH.
        exit /b 1
    )
)

:: Define Target Architecture (default to win-x86)
set ARCH=win-x86
if "%~1"=="x64" (
    set ARCH=win-x64
)

echo 🎯 Target Architecture: !ARCH!
echo 📦 Using package manager: !PKG_MANAGER!

:: Create clean dist directory
if exist dist (
    rmdir /s /q dist
)
mkdir dist

:: 2. Build the React Frontend
echo 💻 Building React UI static assets...
cd src\Pulse.Edge.UI
call !INSTALL_CMD!
call !BUILD_CMD!
if %errorlevel% neq 0 (
    echo ❌ Error: React build failed.
    cd ..\..
    exit /b 1
)
cd ..\..

:: 3. Embed UI inside API wwwroot
echo 📁 Copying UI static assets to Web API...
if not exist src\Pulse.Edge.Api\wwwroot (
    mkdir src\Pulse.Edge.Api\wwwroot
)
del /f /s /q src\Pulse.Edge.Api\wwwroot\* >nul 2>nul
xcopy /e /i /y src\Pulse.Edge.UI\dist src\Pulse.Edge.Api\wwwroot\

:: 4. Compile Unified API Server (Hosts API, background sync worker, and React UI)
echo 🔌 Compiling Unified Pulse.Edge (!ARCH!) executable...
dotnet publish src\Pulse.Edge.Api\Pulse.Edge.Api.csproj -c Release -r !ARCH! --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false -o dist
if %errorlevel% neq 0 (
    echo ❌ Error: Compilation failed.
    exit /b 1
)

echo =============================================
echo   ✅ Build Completed Successfully!
echo =============================================
echo Your unified Windows executable is located at:
echo  - Unified Process:  dist\Pulse.Edge.exe
echo  - UI Assets Folder: dist\wwwroot\
echo.
echo To run this application, copy the entire 'dist/' folder
echo to the target machine and execute 'Pulse.Edge.exe'.
echo.
echo To compile for 64-bit Windows instead, run:
echo   build-windows.bat x64
echo =============================================
pause
