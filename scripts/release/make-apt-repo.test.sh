#!/usr/bin/env bash
# Verify make-apt-repo.sh emits a valid flat APT index for a stub .deb.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/make-apt-repo.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

mkdir -p "$tmp/debian"
printf 'stub-deb-content' > "$tmp/debian/pulse-edge_1.2.3_arm64.deb"

if ! "$script" "$tmp/debian" "1.2.3" >/dev/null 2>&1; then
  echo "FAIL: script exited nonzero"; fails=$((fails+1))
fi
for f in Packages Packages.gz Release install.sh; do
  if [ ! -f "$tmp/debian/$f" ]; then echo "FAIL: missing $f"; fails=$((fails+1)); fi
done
if ! grep -q '^Version: 1.2.3$' "$tmp/debian/Packages" 2>/dev/null; then
  echo "FAIL: Packages missing Version: 1.2.3"; fails=$((fails+1))
fi
if ! grep -q '^Filename: pulse-edge_1.2.3_arm64.deb$' "$tmp/debian/Packages" 2>/dev/null; then
  echo "FAIL: Packages missing correct Filename"; fails=$((fails+1))
fi

if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails failure(s)."; exit 1; fi
