#!/bin/bash

# Exit on any error
set -e

echo "============================================="
echo "  📦 PULSE Edge Windows Build Utility"
echo "============================================="

# 1. Check prerequisites
echo "Checking prerequisites..."
if ! command -v dotnet &> /dev/null; then
    echo "❌ Error: .NET SDK is not installed or not in PATH."
    exit 1
fi

# Detect package manager (pnpm preferred, npm fallback)
if command -v pnpm &> /dev/null; then
    PKG_MANAGER="pnpm"
    INSTALL_CMD="pnpm install"
    BUILD_CMD="pnpm run build"
elif command -v npm &> /dev/null; then
    PKG_MANAGER="npm"
    INSTALL_CMD="npm install"
    BUILD_CMD="npm run build"
else
    echo "❌ Error: Neither pnpm nor Node.js/npm is installed or in PATH."
    exit 1
fi

# Define Target Architecture (default to win-x86)
ARCH="win-x86"
if [ "$1" == "x64" ]; then
    ARCH="win-x64"
fi

echo "🎯 Target Architecture: $ARCH"
echo "📦 Using package manager: $PKG_MANAGER"

# Create a clean dist directory at the root
rm -rf dist
mkdir -p dist

# 2. Build the React Frontend
echo "💻 Building React UI static assets..."
cd src/Pulse.Edge.UI
$INSTALL_CMD
$BUILD_CMD
cd ../..

# 3. Embed UI inside API wwwroot
echo "📁 Copying UI static assets to Web API..."
mkdir -p src/Pulse.Edge.Api/wwwroot
rm -rf src/Pulse.Edge.Api/wwwroot/*
cp -R src/Pulse.Edge.UI/dist/ src/Pulse.Edge.Api/wwwroot/

# 4. Compile Unified API Server (Hosts API, background sync worker, and React UI)
echo "🔌 Compiling Unified Pulse.Edge ($ARCH) executable..."
dotnet publish src/Pulse.Edge.Api/Pulse.Edge.Api.csproj \
  -c Release \
  -r $ARCH \
  --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:PublishTrimmed=false \
  -o dist/

echo "============================================="
echo "  ✅ Build Completed Successfully!"
echo "============================================="
echo "Your unified Windows executable is located at:"
echo " - Unified Process:  dist/Pulse.Edge.exe"
echo " - UI Assets Folder: dist/wwwroot/"
echo ""
echo "To run this application, copy the entire 'dist/' folder"
echo "to the target machine and execute 'Pulse.Edge.exe'."
echo ""
echo "To compile for 64-bit Windows instead, run:"
echo "  ./build-windows.sh x64"
echo "============================================="
