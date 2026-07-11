#!/bin/bash

# =============================================================================
#  📦 PULSE Edge Linux Deployment Script
# =============================================================================
#  This script automates the installation of PULSE Edge on a target Linux system.
#  It extracts the binaries, sets up a systemd service, configures the firewall,
#  and verifies that the service is running successfully.
#
#  Usage:
#    sudo ./deploy-edge.sh [tarball_path]
# =============================================================================

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. Enforce root privileges
if [ "$EUID" -ne 0 ]; then
    log_error "Please run this script as root (e.g. using sudo)."
    exit 1
fi

# Resolve the non-root user who invoked sudo
TARGET_USER=$SUDO_USER
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
    # Fallback to the current user if not run through sudo
    TARGET_USER=$(logname 2>/dev/null || echo "pi")
fi

TARGET_DIR="/opt/pulse-edge"
PORT=5288

echo "============================================="
echo "  🚀 Starting PULSE Edge Installation"
echo "============================================="
log_info "Target installation directory: $TARGET_DIR"
log_info "Target service user: $TARGET_USER"

# 2. Locate the deployment tarball
TARBALL=$1
if [ -z "$TARBALL" ]; then
    # Auto-detect in current directory
    TARBALL=$(ls pulse-edge-linux-arm64.tar.gz 2>/dev/null | head -n 1)
    if [ -z "$TARBALL" ]; then
        TARBALL=$(ls *.tar.gz 2>/dev/null | head -n 1)
    fi
fi

if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then
    log_error "Deployment package (tarball) not found."
    log_info "Please place the pulse-edge-linux-arm64.tar.gz in this folder or pass it as an argument:"
    echo "  sudo ./deploy-edge.sh /path/to/pulse-edge-linux-arm64.tar.gz"
    exit 1
fi

log_info "Found deployment package: $TARBALL"

# 3. Stop existing service if running
if systemctl is-active --quiet pulse-edge.service; then
    log_info "Stopping existing pulse-edge service..."
    systemctl stop pulse-edge.service
fi

# 4. Extract package
log_info "Extracting files to $TARGET_DIR..."
mkdir -p "$TARGET_DIR"
tar -xzf "$TARBALL" -C "$TARGET_DIR"

if [ $? -ne 0 ]; then
    log_error "Failed to extract tarball."
    exit 1
fi

# 5. Set permissions
log_info "Setting executable permissions..."
chmod +x "$TARGET_DIR/Pulse.Edge"
chmod +x "$TARGET_DIR/Pulse.Edge.Agent"
chown -R "$TARGET_USER":"$TARGET_USER" "$TARGET_DIR"

# 6. Verify libicu dependency
if ! ldconfig -p | grep -q libicu; then
    log_warn "libicu (Unicode support) is not detected on this system."
    log_warn "If the application crashes, install it using: sudo apt-get install -y libicu-dev"
fi

# 7. Create systemd Service unit file
log_info "Creating systemd service file..."
cat <<EOF > /etc/systemd/system/pulse-edge.service
[Unit]
Description=PULSE Edge Unified IoT Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$TARGET_DIR
ExecStart=$TARGET_DIR/Pulse.Edge
Restart=always
RestartSec=5
KillSignal=SIGINT
SyslogIdentifier=pulse-edge
User=$TARGET_USER
Environment=HOME=/home/$TARGET_USER

[Install]
WantedBy=multi-user.target
EOF

# 8. Configure Firewall rules
if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld; then
    log_info "Configuring firewalld rules for port $PORT..."
    firewall-cmd --zone=public --add-port=$PORT/tcp --permanent &>/dev/null
    firewall-cmd --reload &>/dev/null
    log_success "Port $PORT opened in firewalld."
elif command -v ufw &> /dev/null && systemctl is-active --quiet ufw; then
    log_info "Configuring ufw rules for port $PORT..."
    ufw allow $PORT/tcp &>/dev/null
    ufw reload &>/dev/null
    log_success "Port $PORT opened in ufw."
else
    log_warn "No active firewall system (firewalld/ufw) detected. Firewall configuration skipped."
fi

# 9. Reload and start the service
log_info "Enabling and starting pulse-edge service..."
systemctl daemon-reload
systemctl enable pulse-edge.service
systemctl start pulse-edge.service

# 10. Verify health
log_info "Waiting for service to start and report health..."
elapsed=0
success=false
while [ $elapsed -lt 15 ]; do
    if curl -sf "http://localhost:$PORT/health" >/dev/null; then
        success=true
        break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

if [ "$success" = true ]; then
    log_success "PULSE Edge successfully deployed and active!"
    log_success "You can access the UI at: http://<device-ip>:$PORT"
else
    log_error "Health check failed. The service did not start within 15 seconds."
    log_info "To check the service status, run: systemctl status pulse-edge.service"
    log_info "To view the service logs, run: journalctl -u pulse-edge.service -n 50 --no-pager"
    exit 1
fi
