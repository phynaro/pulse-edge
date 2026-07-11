#!/bin/bash

# Exit on any error
set -e

echo "============================================="
echo "  📦 PULSE Edge Multi-Platform Build Utility"
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

# Sanitize and normalize input argument
INPUT_TARGET=$(echo "$1" | tr '[:upper:]' '[:lower:]')
if [ -n "$INPUT_TARGET" ]; then
    case "$INPUT_TARGET" in
        "win-x86" | "winx86" | "x86")
            TARGETS=("win-x86")
            ;;
        "win-x64" | "winx64" | "x64")
            TARGETS=("win-x64")
            ;;
        "linux-x64" | "linuxx64" | "linux" | "ubuntu" | "linux64")
            TARGETS=("linux-x64")
            ;;
        "linux-arm" | "linuxarm" | "arm" | "rpi32")
            TARGETS=("linux-arm")
            ;;
        "linux-arm64" | "linuxarm64" | "arm64" | "rpi" | "rpi64")
            TARGETS=("linux-arm64")
            ;;
        "all")
            TARGETS=("win-x86" "win-x64" "linux-x64" "linux-arm" "linux-arm64")
            ;;
        *)
            echo "❌ Error: Unsupported or unrecognized target '$1'."
            echo "Supported targets are: win-x86, win-x64, linux-x64, linux-arm, linux-arm64, all"
            exit 1
            ;;
    esac
else
    # Default to all targets if no argument is passed
    TARGETS=("win-x86" "win-x64" "linux-x64" "linux-arm" "linux-arm64")
fi

echo "📦 Package Manager: $PKG_MANAGER"
echo "🎯 Targets to compile: ${TARGETS[*]}"

# Create a clean dist directory
rm -rf dist
mkdir -p dist

# 2. Build the React Frontend (Compiled once and reused)
echo "💻 Building React UI static assets..."
cd src/Pulse.Edge.UI
$INSTALL_CMD
$BUILD_CMD
cd ../..

# 3. Copy UI static assets to Web API folder so they can be embedded
echo "📁 Copying UI static assets for embedding..."
mkdir -p src/Pulse.Edge.Api/wwwroot
rm -rf src/Pulse.Edge.Api/wwwroot/*
cp -R src/Pulse.Edge.UI/dist/ src/Pulse.Edge.Api/wwwroot/

# 4. Helper function to publish a specific target
build_target() {
    local rid=$1
    local out_dir="dist/$rid"
    
    echo "🔌 Compiling standalone Web/API/UI server for target: $rid..."
    dotnet publish src/Pulse.Edge.Api/Pulse.Edge.Api.csproj \
      -c Release \
      -r "$rid" \
      --self-contained true \
      -p:PublishSingleFile=true \
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:PublishTrimmed=false \
      -o "$out_dir/"

    echo "🤖 Compiling standalone background Agent daemon for target: $rid..."
    dotnet publish src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj \
      -c Release \
      -r "$rid" \
      --self-contained true \
      -p:PublishSingleFile=true \
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:PublishTrimmed=false \
      -o "$out_dir/"

    # Copy app.ico if it exists in UI public directory
    if [ -f "src/Pulse.Edge.UI/public/app.ico" ]; then
        cp "src/Pulse.Edge.UI/public/app.ico" "$out_dir/"
    fi

    # Clean up unnecessary compiler artifacts from output directory
    echo "🧹 Cleaning up compiler artifacts in $out_dir..."
    rm -f "$out_dir"/*.pdb
    rm -f "$out_dir"/Pulse.Edge.staticwebassets.endpoints.json
    rm -f "$out_dir"/Pulse.Edge.Agent.staticwebassets.endpoints.json
    rm -f "$out_dir"/appsettings.Development.json
    if [ -f "$out_dir"/web.config ]; then
        rm "$out_dir"/web.config
    fi
}

# 5. Build all requested targets
for target in "${TARGETS[@]}"; do
    build_target "$target"
done

echo "============================================="
echo "  ✅ Multi-Platform Build Completed Successfully!"
echo "============================================="
echo "Deployment packages generated in dist/ folder:"
if [ -d "dist/win-x86" ]; then
    echo "  ➡️  Windows 32-bit:       dist/win-x86/ (Pulse.Edge.exe & Pulse.Edge.Agent.exe)"
fi
if [ -d "dist/win-x64" ]; then
    echo "  ➡️  Windows 64-bit:       dist/win-x64/ (Pulse.Edge.exe & Pulse.Edge.Agent.exe)"
fi
if [ -d "dist/linux-x64" ]; then
    echo "  ➡️  Linux 64-bit (x64):   dist/linux-x64/ (Pulse.Edge & Pulse.Edge.Agent)"
fi
if [ -d "dist/linux-arm" ]; then
    echo "  ➡️  Linux 32-bit (ARM):   dist/linux-arm/ (Pulse.Edge & Pulse.Edge.Agent)"
fi
if [ -d "dist/linux-arm64" ]; then
    echo "  ➡️  Linux 64-bit (ARM):   dist/linux-arm64/ (Pulse.Edge & Pulse.Edge.Agent)"
fi
echo ""
echo "Windows Installer scripts:"
echo "  ➡️  Inno Setup: PulseEdge.iss"
echo "  ➡️  WiX Toolset: PulseEdge.wxs"
echo ""
echo "To compile the Inno Setup executable wizard (PulseEdgeSetup-1.0.0.exe), run:"
echo "  ISCC PulseEdge.iss"
echo ""
echo "To compile the WiX MSI package (PulseEdgeSetup-1.0.0.msi), run:"
echo "  For WiX v3:   candle -ext WixUtilExtension -ext WixFirewallExtension -out dist/PulseEdge.wixobj PulseEdge.wxs"
echo "                light -ext WixUIExtension -ext WixUtilExtension -ext WixFirewallExtension -out dist-setup/PulseEdgeSetup-1.0.0.msi dist/PulseEdge.wixobj"
echo "  For WiX v4/5: wix build -ext WixToolset.Util.wixext -ext WixToolset.Firewall.wixext -ext WixToolset.UI.wixext -out dist-setup/PulseEdgeSetup-1.0.0.msi PulseEdge.wxs"
echo "============================================="
