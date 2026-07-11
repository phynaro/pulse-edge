#!/bin/bash

# =============================================================================
#  📦 PULSE Edge Multi-Platform Staging Build & Deploy Utility
# =============================================================================
#  This script runs locally on your Mac. It:
#    1. Verifies local tool dependencies (dpkg, minio-client) via Homebrew.
#    2. Compiles binary targets for all platforms (Windows, Linux, macOS).
#    3. Packages the Debian archive (.deb) and generates flat APT repository indices.
#    4. Archives Windows and macOS binaries into downloadable ZIP packages.
#    5. Organizes files locally into:
#         dist/staging/debian/
#         dist/staging/windows/
#         dist/staging/macos/
#    6. Uploads the entire staging workspace to MinIO under 'staging/'.
# =============================================================================

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 1. Check local dependencies on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Check for dpkg-deb (required to build .deb packages on Mac)
    if ! command -v dpkg-deb &> /dev/null; then
        log_warn "dpkg-deb not found. Installing 'dpkg' via Homebrew..."
        brew install dpkg
    fi

    # Check for minio-client (mc)
    if ! command -v mc &> /dev/null; then
        log_warn "MinIO Client (mc) not found. Installing via Homebrew..."
        brew install minio-mc
    fi
fi

# Verify dependencies are available
if ! command -v dpkg-deb &> /dev/null; then
    log_error "dpkg-deb is required. Please run: brew install dpkg"
    exit 1
fi
if ! command -v mc &> /dev/null; then
    log_error "MinIO Client (mc) is required. Please run: brew install minio-mc"
    exit 1
fi

# 2. Load environment configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env ]; then
    source .env
else
    log_error "No .env configuration found. Please create one with MinIO credentials."
    exit 1
fi

# Validate MinIO Env vars
if [ -z "$MINIO_ENDPOINT" ] || [ -z "$MINIO_ACCESS_KEY" ] || [ -z "$MINIO_SECRET_KEY" ]; then
    log_error "MinIO credentials are not fully configured in your .env file."
    exit 1
fi

MINIO_BUCKET=${MINIO_BUCKET:-"pulse-repo"}

# 3. Compile standard targets (Windows & Linux)
log_info "Compiling standard binaries (Windows & Linux RIDs)..."
./build.sh all

# 4. Build macOS Standalone Targets (osx-arm64, osx-x64)
log_info "Compiling macOS standalone targets..."
OSX_TARGETS=("osx-arm64" "osx-x64")

# Compile macOS targets manually (similar to build_target in build.sh)
for rid in "${OSX_TARGETS[@]}"; do
    out_dir="dist/$rid"
    log_info "Building macOS target: $rid..."
    rm -rf "$out_dir"

    # Compile Web API
    dotnet publish src/Pulse.Edge.Api/Pulse.Edge.Api.csproj \
      -c Release \
      -r "$rid" \
      --self-contained true \
      -p:PublishSingleFile=true \
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:PublishTrimmed=false \
      -o "$out_dir/" &>/dev/null

    # Compile Agent
    dotnet publish src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj \
      -c Release \
      -r "$rid" \
      --self-contained true \
      -p:PublishSingleFile=true \
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:PublishTrimmed=false \
      -o "$out_dir/" &>/dev/null

    # Clean up native build artifacts
    rm -f "$out_dir"/*.pdb
    rm -f "$out_dir"/*.staticwebassets.endpoints.json
    rm -f "$out_dir"/appsettings.Development.json
done

# 5. Clean and prepare local staging output directories
# (We do this AFTER compilation so build.sh clean doesn't wipe them)
STAGING_DIR="dist/staging"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/debian"
mkdir -p "$STAGING_DIR/windows"
mkdir -p "$STAGING_DIR/macos"

# 6. Archive Binaries into ZIPs
log_info "Archiving Windows and macOS releases..."

# Windows ZIP archives
(cd dist/win-x64 && zip -r -q "../staging/windows/pulse-edge-windows-x64.zip" *)
(cd dist/win-x86 && zip -r -q "../staging/windows/pulse-edge-windows-x86.zip" *)

# macOS ZIP archives
(cd dist/osx-arm64 && zip -r -q "../staging/macos/pulse-edge-macos-arm64.zip" *)
(cd dist/osx-x64 && zip -r -q "../staging/macos/pulse-edge-macos-x64.zip" *)

# 7. Generate Debian Package (.deb) and Repository Indices
log_info "Packaging Debian release..."
./build-deb.sh arm64

DEB_FILE=$(ls dist/pulse-edge_*_arm64.deb 2>/dev/null | head -n 1)
if [ -z "$DEB_FILE" ] || [ ! -f "$DEB_FILE" ]; then
    log_error "Failed to locate the generated Debian package."
    exit 1
fi

DEB_NAME=$(basename "$DEB_FILE")
cp "$DEB_FILE" "$STAGING_DIR/debian/"

# Generate Flat APT Repository index
log_info "Generating APT repository metadata indices..."
FILE_SIZE=$(wc -c < "$DEB_FILE" | tr -d ' ')
SHA256_HASH=$(shasum -a 256 "$DEB_FILE" | awk '{print $1}')
PACKAGES_FILE="$STAGING_DIR/debian/Packages"

cat <<EOF > "$PACKAGES_FILE"
Package: pulse-edge
Version: 1.0.0
Section: utils
Priority: optional
Architecture: arm64
Maintainer: Integra Innovation Co., Ltd. <support@integra.co.th>
Depends: libicu-dev
Filename: $DEB_NAME
Size: $FILE_SIZE
SHA256: $SHA256_HASH
Description: PULSE Edge Unified IoT Gateway Server
 PULSE Edge platform collects telemetry and provides an asset-centric
 management API and UI.
EOF

# Compress Packages index
gzip -c "$PACKAGES_FILE" > "$PACKAGES_FILE.gz"

# Generate Release file
RELEASE_FILE="$STAGING_DIR/debian/Release"
PKG_SIZE=$(wc -c < "$PACKAGES_FILE" | tr -d ' ')
PKG_HASH=$(shasum -a 256 "$PACKAGES_FILE" | awk '{print $1}')
PKG_GZ_SIZE=$(wc -c < "$PACKAGES_FILE.gz" | tr -d ' ')
PKG_GZ_HASH=$(shasum -a 256 "$PACKAGES_FILE.gz" | awk '{print $1}')

cat <<EOF > "$RELEASE_FILE"
Archive: stable
Component: main
Origin: PULSE
Label: PULSE Edge Staging Repository
Architecture: arm64
SHA256:
 $PKG_HASH $PKG_SIZE Packages
 $PKG_GZ_HASH $PKG_GZ_SIZE Packages.gz
EOF

# 8. Generate Staging install.sh script
log_info "Generating custom install.sh setup script..."
STAGING_URL="pulse.trazor.cloud/download/staging/debian"

cat <<EOF > "$STAGING_DIR/debian/install.sh"
#!/bin/bash
# install.sh - Configure PULSE Edge STAGING repository on RevPi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "\${BLUE}[INFO]\${NC} \$1"; }
log_success() { echo -e "\${GREEN}[SUCCESS]\${NC} \$1"; }
log_error() { echo -e "\${RED}[ERROR]\${NC} \$1"; }

if [ "\$EUID" -ne 0 ]; then
    log_error "Please run this script as root (e.g. using sudo)."
    exit 1
fi

SOURCES_PATH="/etc/apt/sources.list.d/pulse.list"

log_info "Registering PULSE Edge Staging repository..."

# Write flat APT source (flat repo needs the trailing "./" component)
echo "deb [trusted=yes] https://$STAGING_URL ./" > "\$SOURCES_PATH"

log_info "Refreshing package lists..."
apt-get update -y &>/dev/null

log_success "Staging repository registered successfully!"
echo "---------------------------------------------"
echo -e "Install via: \${GREEN}sudo apt install pulse-edge\${NC}"
echo "---------------------------------------------"
EOF

chmod +x "$STAGING_DIR/debian/install.sh"

# 9. Upload to MinIO
log_info "Configuring MinIO client alias..."
mc alias set pulse-minio "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" --api S3v4 &>/dev/null

if [ $? -ne 0 ]; then
    log_error "Failed to authenticate with MinIO. Please check your credentials in .env."
    exit 1
fi

# Ensure bucket exists
if ! mc ls "pulse-minio/$MINIO_BUCKET" &>/dev/null; then
    log_info "MinIO bucket '$MINIO_BUCKET' does not exist. Creating it..."
    mc mb "pulse-minio/$MINIO_BUCKET" &>/dev/null
    mc anonymous set download "pulse-minio/$MINIO_BUCKET" &>/dev/null
    log_success "Bucket '$MINIO_BUCKET' created and access set to public read-only."
fi

log_info "Mirroring staging directory to MinIO ($MINIO_BUCKET/staging/)..."
# Upload staging/ to pulse-repo/staging/
mc mirror --overwrite "$STAGING_DIR/" "pulse-minio/$MINIO_BUCKET/staging/"

if [ $? -eq 0 ]; then
    echo "============================================="
    log_success "Deployment to Staging Completed Successfully!"
    echo "============================================="
    log_info "Downloads available at:"
    echo -e "  Debian install:  ${GREEN}curl -fsSL https://$STAGING_URL/install.sh | sudo bash${NC}"
    echo -e "  Windows ZIPs:    ${GREEN}https://pulse.trazor.cloud/download/staging/windows/${NC}"
    echo -e "  macOS ZIPs:      ${GREEN}https://pulse.trazor.cloud/download/staging/macos/${NC}"
    echo "============================================="
    log_info "To promote staging/ to production (debian/, windows/, macos/):"
    echo -e "  ${BLUE}mc cp --recursive pulse-minio/$MINIO_BUCKET/staging/debian/ pulse-minio/$MINIO_BUCKET/debian/${NC}"
    echo -e "  ${BLUE}mc cp --recursive pulse-minio/$MINIO_BUCKET/staging/windows/ pulse-minio/$MINIO_BUCKET/windows/${NC}"
    echo -e "  ${BLUE}mc cp --recursive pulse-minio/$MINIO_BUCKET/staging/macos/ pulse-minio/$MINIO_BUCKET/macos/${NC}"
    echo "============================================="
else
    log_error "Failed to upload files to MinIO."
    exit 1
fi
