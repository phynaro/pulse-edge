#!/bin/bash

# =============================================================================
#  📦 PULSE Edge Client Repository Setup Script
# =============================================================================
#  This script registers the PULSE Edge Debian repository on a target Linux
#  system (such as RevPi) so the application can be installed and updated
#  using standard package management:
#
#      sudo apt install pulse-edge
#
#  Usage:
#    curl -fsSL https://pulse.trazor.cloud/download/debian/install.sh | sudo bash
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

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. Enforce root privileges
if [ "$EUID" -ne 0 ]; then
    log_error "Please run this script as root (e.g. using sudo)."
    echo "  curl -fsSL https://pulse.trazor.cloud/download/debian/install.sh | sudo bash"
    exit 1
fi

REPO_URL="pulse.trazor.cloud/download/debian"
KEYRING_PATH="/usr/share/keyrings/pulse-archive-keyring.gpg"
SOURCES_PATH="/etc/apt/sources.list.d/pulse.list"

echo "============================================="
echo "  📦 Registering PULSE Edge Software Repo"
echo "============================================="

# 2. Download and trust the GPG public key
log_info "Downloading GPG public signing key from $REPO_URL..."
if curl -fsSL "https://$REPO_URL/pulse.gpg" | gpg --dearmor -o "$KEYRING_PATH" 2>/dev/null; then
    log_success "Signing key installed to $KEYRING_PATH"
else
    log_error "Failed to download GPG key from https://$REPO_URL/pulse.gpg"
    exit 1
fi

# 3. Add the APT source listing
log_info "Adding software repository sources to $SOURCES_PATH..."
echo "deb [signed-by=$KEYRING_PATH] https://$REPO_URL stable main" > "$SOURCES_PATH"

if [ $? -eq 0 ]; then
    log_success "Software sources list updated successfully."
else
    log_error "Failed to write repository source to $SOURCES_PATH"
    exit 1
fi

# 4. Refresh package list
log_info "Refreshing local package lists..."
if apt-get update -y &>/dev/null; then
    log_success "Package lists updated successfully."
else
    log_warn "Apt update finished with warnings/errors, checking package availability..."
fi

# 5. Success summary
echo "============================================="
log_success "PULSE Edge repository setup completed!"
echo "============================================="
echo "You can now install the edge gateway agent by running:"
echo -e "  ${GREEN}sudo apt install pulse-edge${NC}"
echo "============================================="
