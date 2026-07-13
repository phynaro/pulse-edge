#!/usr/bin/env bash
# Validate a release tag and emit its version parts.
# Usage: derive-version.sh <refs/tags/vX.Y.Z[-pre] | vX.Y.Z[-pre]>
set -euo pipefail

raw="${1:-}"
tag="${raw#refs/tags/}"

if ! printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "error: tag '$tag' is not a valid version tag (expected vMAJOR.MINOR.PATCH[-prerelease])" >&2
  exit 1
fi

version="${tag#v}"
numeric_version="${version%%-*}"

echo "version=${version}"
echo "numeric_version=${numeric_version}"
