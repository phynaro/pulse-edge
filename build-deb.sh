#!/bin/bash

# =============================================================================
#  📦 PULSE Edge Debian Packaging Utility
# =============================================================================
#  This script packages the compiled PULSE Edge binaries into a standard Debian
#  package (.deb). This package can be installed on any target Debian/Ubuntu
#  system (including RevPi) using:
#
#      sudo apt install ./pulse-edge_1.0.0_arm64.deb
# =============================================================================

set -e

# Default settings
VERSION="1.0.0"
ARCH="arm64" # Target architecture (arm64, arm, amd64)
RID="linux-arm64"

# Handle input arguments for overriding defaults
if [ -n "$1" ]; then
    ARCH="$1"
    case "$ARCH" in
        "arm64" | "aarch64")
            RID="linux-arm64"
            ARCH="arm64"
            ;;
        "armhf" | "arm")
            RID="linux-arm"
            ARCH="armhf"
            ;;
        "amd64" | "x64")
            RID="linux-x64"
            ARCH="amd64"
            ;;
        *)
            echo "❌ Unsupported architecture '$ARCH'. Supported: arm64, armhf, amd64"
            exit 1
            ;;
    esac
fi

if [ -n "$2" ]; then
    VERSION="$2"
fi

echo "============================================="
echo "  📦 Building Debian Package (.deb)"
echo "  🎯 Target Arch: $ARCH ($RID)"
echo "  🏷️  Version:     $VERSION"
echo "============================================="

# Ensure we are in the edge directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Verify build outputs exist
SOURCE_DIR="dist/$RID"
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Build directory '$SOURCE_DIR' not found."
    echo "Please run './build.sh $RID' or './build.sh all' first."
    exit 1
fi

# Define package name and temp build directory
PKG_DIR="dist/pkg_deb"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/opt/pulse-edge"
mkdir -p "$PKG_DIR/lib/systemd/system"

# 1. Copy Application Binaries
echo "📁 Copying application binaries..."
cp "$SOURCE_DIR/Pulse.Edge" "$PKG_DIR/opt/pulse-edge/"
cp "$SOURCE_DIR/Pulse.Edge.Agent" "$PKG_DIR/opt/pulse-edge/"
cp "$SOURCE_DIR/appsettings.json" "$PKG_DIR/opt/pulse-edge/"

# 2. Create Systemd Service File
echo "⚙️  Generating systemd service file..."
cat <<EOF > "$PKG_DIR/lib/systemd/system/pulse-edge.service"
[Unit]
Description=PULSE Edge Unified IoT Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/pulse-edge
ExecStart=/opt/pulse-edge/Pulse.Edge
Restart=always
RestartSec=5
KillSignal=SIGINT
SyslogIdentifier=pulse-edge
User=pulse
Group=pulse
Environment=HOME=/var/lib/pulse-edge

# --- Sandboxing (systemd) ---
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
# ProtectSystem=strict makes the filesystem read-only except these paths:
ReadWritePaths=/var/lib/pulse-edge /opt/pulse-edge/logs
# NOTE: do NOT add MemoryDenyWriteExecute=true — it breaks the .NET JIT.

[Install]
WantedBy=multi-user.target
EOF

# 3. Create Debian Control File
echo "📝 Writing Debian control file..."
cat <<EOF > "$PKG_DIR/DEBIAN/control"
Package: pulse-edge
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: Integra Innovation Co., Ltd. <support@integra.co.th>
Depends: libicu-dev
Description: PULSE Edge Unified IoT Gateway Server
 PULSE Edge platform collects telemetry and provides an asset-centric
 management API and UI.
EOF

# 4. Create Post-Install Script (postinst)
echo "📜 Writing post-installation script..."
cat <<'EOF' > "$PKG_DIR/DEBIAN/postinst"
#!/bin/bash
set -e

# Create dedicated system user and group for PULSE Edge
if ! getent group pulse >/dev/null; then
    groupadd -r pulse
fi
if ! getent passwd pulse >/dev/null; then
    useradd -r -g pulse -d /var/lib/pulse-edge -s /sbin/nologin -c "PULSE Edge System User" pulse
fi

# Set home directory for database and storage
mkdir -p /var/lib/pulse-edge/.pulse
chown -R pulse:pulse /var/lib/pulse-edge

# Make binaries executable and set directory ownership
chmod +x /opt/pulse-edge/Pulse.Edge
chmod +x /opt/pulse-edge/Pulse.Edge.Agent
mkdir -p /opt/pulse-edge/logs
chown -R pulse:pulse /opt/pulse-edge

# Reload systemd configuration
systemctl daemon-reload

# Enable service for boot autostart
systemctl enable pulse-edge.service

# Restart the service
systemctl restart pulse-edge.service

# Configure Firewall rules if applicable
PORT=5288
if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
    firewall-cmd --zone=public --add-port=$PORT/tcp --permanent &>/dev/null || true
    firewall-cmd --reload &>/dev/null || true
elif command -v ufw &> /dev/null && systemctl is-active --quiet ufw; then
    ufw allow $PORT/tcp &>/dev/null || true
    ufw reload &>/dev/null || true
fi

exit 0
EOF

# 5. Create Pre-Remove Script (prerm)
echo "📜 Writing pre-removal script..."
cat <<'EOF' > "$PKG_DIR/DEBIAN/prerm"
#!/bin/bash
set -e

# Stop the service before removal
if systemctl is-active --quiet pulse-edge.service; then
    systemctl stop pulse-edge.service
fi

# Disable the service
systemctl disable pulse-edge.service

# Remove Firewall rules if applicable
PORT=5288
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
        firewall-cmd --zone=public --remove-port=$PORT/tcp --permanent &>/dev/null || true
        firewall-cmd --reload &>/dev/null || true
    elif command -v ufw &> /dev/null && systemctl is-active --quiet ufw; then
        ufw delete allow $PORT/tcp &>/dev/null || true
        ufw reload &>/dev/null || true
    fi
fi

exit 0
EOF

# 6. Set Debian script permissions
chmod 755 "$PKG_DIR/DEBIAN/control"
chmod 755 "$PKG_DIR/DEBIAN/postinst"
chmod 755 "$PKG_DIR/DEBIAN/prerm"

# 7. Build Debian Package
OUTPUT_FILE="dist/pulse-edge_${VERSION}_${ARCH}.deb"
echo "🛠️  Building package using dpkg-deb..."

if command -v dpkg-deb &> /dev/null; then
    # Set correct ownership for package files
    # (Must run as root or fake root to build correctly)
    if [ "$EUID" -eq 0 ]; then
        chown -R root:root "$PKG_DIR"
        echo "Size of build directory before package:"
        du -sh "$PKG_DIR"
        dpkg-deb --build "$PKG_DIR" "$OUTPUT_FILE"
    else
        echo "⚠️  Warning: Building without root privileges. Attempting build..."
        echo "Size of build directory before package:"
        du -sh "$PKG_DIR"
        dpkg-deb --build "$PKG_DIR" "$OUTPUT_FILE"
    fi
    echo "============================================="
    echo "  ✅ Debian Package Created Successfully!"
    echo "  ➡️  $OUTPUT_FILE"
    echo "============================================="
else
    echo "❌ Error: 'dpkg-deb' is not available on this system."
    echo "To build a Debian package, please run this script on a Debian/Ubuntu system."
    echo "(For macOS, you can build this inside a Docker container or run it on the RevPi itself)."
    exit 1
fi

# Clean up temp folder
rm -rf "$PKG_DIR"
