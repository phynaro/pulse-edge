@echo off
setlocal enabledelayedexpansion

echo =============================================
echo   📦 PULSE Edge Multi-Platform Build Utility
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

:: Determine targets to compile
set TARGET_ARG=%~1
if "%TARGET_ARG%"=="" (
    set TARGET_ARG=all
)

echo 📦 Using package manager: !PKG_MANAGER!
echo 🎯 Compiling target: !TARGET_ARG!

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

:: 4. Build based on selection
if "!TARGET_ARG!"=="all" (
    call :build_target win-x86
    call :build_target win-x64
    call :build_target linux-x64
) else (
    call :build_target !TARGET_ARG!
)

echo =============================================
echo   ✅ Multi-Platform Build Completed Successfully!
echo =============================================
echo Deployment packages generated in dist\ folder:
if exist dist\win-x86 (
    echo   ➡️  Windows 32-bit:  dist\win-x86\Pulse.Edge.exe
)
if exist dist\win-x64 (
    echo   ➡️  Windows 64-bit:  dist\win-x64\Pulse.Edge.exe
)
if exist exist dist\linux-x64 (
    echo   ➡️  Linux 64-bit:    dist\linux-x64\Pulse.Edge
)
echo.
echo Each target folder is standalone and ready to run!
echo To compile a single target, pass its RID as an argument, e.g.:
echo   build.bat linux-x64
echo =============================================
pause
exit /b 0

:build_target
set RID=%1
set OUT_DIR=dist\%RID%

echo 🔌 Compiling standalone binary for target: %RID%...
dotnet publish src\Pulse.Edge.Api\Pulse.Edge.Api.csproj -c Release -r %RID% --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:PublishTrimmed=false -o %OUT_DIR%
if %errorlevel% neq 0 (
    echo ❌ Error: Compilation failed for %RID%
    exit /b 1
)

:: Clean up unnecessary compiler artifacts
echo 🧹 Cleaning up compiler artifacts in %OUT_DIR%...
del /f /q %OUT_DIR%\*.pdb >nul 2>nul
del /f /q %OUT_DIR%\Pulse.Edge.staticwebassets.endpoints.json >nul 2>nul
del /f /q %OUT_DIR%\appsettings.Development.json >nul 2>nul
if exist %OUT_DIR%\web.config (
    del /f /q %OUT_DIR%\web.config
)
exit /b 0
