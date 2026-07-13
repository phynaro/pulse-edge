#!/usr/bin/env bash
# Build Linux release artifacts and assemble the MinIO staging tree (no upload).
# Usage: stage-linux.sh <version>
set -euo pipefail

version="${1:?usage: stage-linux.sh <version>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

echo "==> Building Linux binaries for $version"
VERSION="$version" ./build.sh linux-all

echo "==> Building arm64 .deb for $version"
./build-deb.sh arm64 "$version"

staging="dist/staging"
rm -rf "$staging"
mkdir -p "$staging/debian" "$staging/linux"

deb_file="dist/pulse-edge_${version}_arm64.deb"
if [ ! -f "$deb_file" ]; then
  echo "error: expected $deb_file not found" >&2
  exit 1
fi
cp "$deb_file" "$staging/debian/"
scripts/release/make-apt-repo.sh "$staging/debian" "$version"

for rid in linux-x64 linux-arm linux-arm64; do
  ( cd "dist/$rid" && zip -r -q "../staging/linux/pulse-edge-${rid}.zip" . )
done

( cd "$staging" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS )

echo "==> Staging tree ready at $staging"
find "$staging" -type f | sort
