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

:: 3. Copy UI static assets to Web API folder so they can be embedded
echo 📁 Copying UI static assets for embedding...
if not exist src\Pulse.Edge.Api\wwwroot (
    mkdir src\Pulse.Edge.Api\wwwroot
)
del /f /s /q src\Pulse.Edge.Api\wwwroot\* >nul 2>nul
xcopy /e /i /y src\Pulse.Edge.UI\dist src\Pulse.Edge.Api\wwwroot\

:: 4. Compile Unified API Server with Embedded UI and Self-Extracted Native DLLs
echo 🔌 Compiling Single Standalone Pulse.Edge (!ARCH!) executable...
dotnet publish src\Pulse.Edge.Api\Pulse.Edge.Api.csproj -c Release -r !ARCH! --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false -o dist
if %errorlevel% neq 0 (
    echo ❌ Error: Compilation failed.
    exit /b 1
)

:: 5. Clean up unnecessary compiler artifacts
echo 🧹 Cleaning up compiler artifacts...
del /f /q dist\*.pdb >nul 2>nul
del /f /q dist\Pulse.Edge.staticwebassets.endpoints.json >nul 2>nul
del /f /q dist\appsettings.Development.json >nul 2>nul
if exist dist\web.config (
    del /f /q dist\web.config
)

echo =============================================
echo   ✅ Build Completed Successfully!
echo =============================================
echo Your Windows deployment package is located at:
echo  ➡️  dist\
echo.
echo Files left in dist\:
echo  1. Pulse.Edge.exe      - The entire unified application (Standalone)
echo  2. appsettings.json    - Configuration overrides template (Optional)
echo.
echo You only need to distribute the single 'Pulse.Edge.exe' file!
echo =============================================
pause
