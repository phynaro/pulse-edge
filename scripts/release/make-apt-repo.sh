#!/usr/bin/env bash
# Generate a flat APT repo index + staging install.sh for the arm64 .deb in a dir.
# Usage: make-apt-repo.sh <debian_dir> <version>
set -euo pipefail

debian_dir="${1:?usage: make-apt-repo.sh <debian_dir> <version>}"
version="${2:?usage: make-apt-repo.sh <debian_dir> <version>}"
staging_url="pulse.trazor.cloud/download/staging/debian"

deb_file="$(ls "$debian_dir"/pulse-edge_*_arm64.deb 2>/dev/null | head -n 1)"
if [ -z "$deb_file" ] || [ ! -f "$deb_file" ]; then
  echo "error: no arm64 .deb found in $debian_dir" >&2
  exit 1
fi
deb_name="$(basename "$deb_file")"
file_size="$(wc -c < "$deb_file" | tr -d ' ')"
sha256_hash="$(shasum -a 256 "$deb_file" | awk '{print $1}')"

packages_file="$debian_dir/Packages"
cat > "$packages_file" <<EOF
Package: pulse-edge
Version: $version
Section: utils
Priority: optional
Architecture: arm64
Maintainer: Integra Innovation Co., Ltd. <support@integra.co.th>
Depends: libicu-dev
Filename: $deb_name
Size: $file_size
SHA256: $sha256_hash
Description: PULSE Edge Unified IoT Gateway Server
 PULSE Edge platform collects telemetry and provides an asset-centric
 management API and UI.
EOF

gzip -c "$packages_file" > "$packages_file.gz"

pkg_size="$(wc -c < "$packages_file" | tr -d ' ')"
pkg_hash="$(shasum -a 256 "$packages_file" | awk '{print $1}')"
pkg_gz_size="$(wc -c < "$packages_file.gz" | tr -d ' ')"
pkg_gz_hash="$(shasum -a 256 "$packages_file.gz" | awk '{print $1}')"

cat > "$debian_dir/Release" <<EOF
Archive: stable
Component: main
Origin: PULSE
Label: PULSE Edge Staging Repository
Architecture: arm64
SHA256:
 $pkg_hash $pkg_size Packages
 $pkg_gz_hash $pkg_gz_size Packages.gz
EOF

cat > "$debian_dir/install.sh" <<EOF
#!/bin/bash
# install.sh - Configure PULSE Edge STAGING repository
set -e
if [ "\$EUID" -ne 0 ]; then
    echo "Please run this script as root (e.g. using sudo)." >&2
    exit 1
fi
echo "deb [trusted=yes] https://$staging_url ./" > /etc/apt/sources.list.d/pulse.list
apt-get update -y
echo "Staging repository registered. Install via: sudo apt install pulse-edge"
EOF
chmod +x "$debian_dir/install.sh"
