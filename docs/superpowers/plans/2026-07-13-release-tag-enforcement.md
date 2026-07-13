# Release-tag Build, Staging Deploy, and Check Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a version tag, only if every required check passes, build the Linux release artifacts, upload them to MinIO `staging/`, and create a matching GitHub Release.

**Architecture:** `quality.yml` becomes reusable (`workflow_call`). A new `release.yml` fires on a `v*` tag with three chained jobs: `guard` (tag/branch/version), `validate` (calls the reusable checks — the gate), `publish` (`needs: [guard, validate]`, so a red check structurally blocks it). `publish` runs `stage-linux.sh`, which reuses `build.sh` + `build-deb.sh` + a shared `make-apt-repo.sh`, then uploads via `mc` and creates the Release.

**Tech Stack:** GitHub Actions (reusable workflows), bash (bash 3.2 compatible for local scripts), .NET self-contained publish, `dpkg-deb`, `curl` (PULSE repo upload API), `gh` CLI. (The local `deploy-staging.sh` still uses the MinIO client `mc` directly.)

## Global Constraints

- Tag regex: `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`. Valid: `v0.9.0`, `v1.0.0-rc.1`, `v0.9.0-pilot.2`. Invalid: `1.2.3`, `v1.2`, `vfoo`, `v1.2.3.4`.
- Version stamping: `.deb` and APT use full `version`; `.NET -p:Version` uses numeric part before `-`; `-p:InformationalVersion` uses full `version`.
- Platforms: Linux only — `linux-x64`, `linux-arm`, `linux-arm64` + arm64 `.deb`. Windows/macOS deferred (R-006).
- Release only commits reachable from `main`. Re-tagging an existing version is an error. MinIO `staging/` is overwrite (latest wins).
- Local scripts must run on macOS bash 3.2 (indexed arrays OK; no associative arrays / `${var,,}`).
- Do not change `quality.yml` behavior for `pull_request` / `push: main` (reuse is additive).
- CI uploads via the PULSE repo API, NOT MinIO directly (no MinIO keys in GitHub). `PUT ${PULSE_API_ORIGIN}/api/repo/objects/<key>`, `Authorization: Bearer <REPO_UPLOAD_TOKEN>`, raw bytes, relative key, ~100 MB max, same key overwrites. Required: `REPO_UPLOAD_TOKEN` (**secret**), `PULSE_API_ORIGIN` (**variable**). Object keys use a `staging/` prefix.

---

### Task 1: Version-derivation script (unit-tested)

**Files:**
- Create: `scripts/release/derive-version.sh`
- Test: `scripts/release/derive-version.test.sh`

**Interfaces:**
- Produces: `derive-version.sh <tag-or-ref>` prints `version=<X.Y.Z[-pre]>` and `numeric_version=<X.Y.Z>` to stdout, exit 0 on valid, exit 1 + stderr on invalid. Accepts `refs/tags/v1.2.3` or `v1.2.3`. Consumed by Task 6 `guard`.

- [ ] **Step 1: Write the failing test**

Create `scripts/release/derive-version.test.sh`:

```bash
#!/usr/bin/env bash
# Plain-bash test harness for derive-version.sh. Runs on macOS bash 3.2.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
script="$here/derive-version.sh"
fails=0

assert_ok() { # desc input expected_version expected_numeric
  local desc="$1" input="$2" exp_v="$3" exp_n="$4" out v n
  if ! out="$("$script" "$input" 2>/dev/null)"; then
    echo "FAIL: $desc — expected success, got failure"; fails=$((fails+1)); return
  fi
  v="$(printf '%s\n' "$out" | sed -n 's/^version=//p')"
  n="$(printf '%s\n' "$out" | sed -n 's/^numeric_version=//p')"
  if [ "$v" = "$exp_v" ] && [ "$n" = "$exp_n" ]; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc — got version=$v numeric=$n, expected version=$exp_v numeric=$exp_n"; fails=$((fails+1))
  fi
}

assert_reject() { # desc input
  local desc="$1" input="$2"
  if "$script" "$input" >/dev/null 2>&1; then
    echo "FAIL: $desc — expected rejection, got success"; fails=$((fails+1))
  else
    echo "PASS: $desc"
  fi
}

assert_ok     "final release"      "v1.2.3"             "1.2.3"          "1.2.3"
assert_ok     "refs/tags form"     "refs/tags/v0.9.0"   "0.9.0"          "0.9.0"
assert_ok     "rc pre-release"     "v1.0.0-rc.1"        "1.0.0-rc.1"     "1.0.0"
assert_ok     "pilot pre-release"  "v0.9.0-pilot.2"     "0.9.0-pilot.2"  "0.9.0"
assert_reject "missing v"          "1.2.3"
assert_reject "two-part"           "v1.2"
assert_reject "non-numeric"        "vfoo"
assert_reject "four-part"          "v1.2.3.4"

if [ "$fails" -eq 0 ]; then echo "All tests passed."; else echo "$fails test(s) failed."; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
chmod +x scripts/release/derive-version.test.sh
bash scripts/release/derive-version.test.sh
```
Expected: fails — script does not exist yet.

- [ ] **Step 3: Write the script**

Create `scripts/release/derive-version.sh`:

```bash
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
chmod +x scripts/release/derive-version.sh
bash scripts/release/derive-version.test.sh
```
Expected: `All tests passed.`

- [ ] **Step 5: Commit**

```bash
git add scripts/release/derive-version.sh scripts/release/derive-version.test.sh
git commit -m "Add tested version-derivation script for releases"
```

---

### Task 2: Make quality.yml reusable and version-aware

**Files:**
- Modify: `.github/workflows/quality.yml` (`on:` block + `artifacts` job "Build versioned artifacts" step)

**Interfaces:**
- Produces: `quality.yml` callable via `workflow_call` with optional string input `version` (default `''`). Consumed by Task 6 `validate`.

- [ ] **Step 1: Add the `workflow_call` trigger**

Replace the `on:` block:

```yaml
on:
  pull_request:
  push:
    branches:
      - main
```

with:

```yaml
on:
  pull_request:
  push:
    branches:
      - main
  workflow_call:
    inputs:
      version:
        description: Version to stamp on built artifacts (blank = dev placeholder)
        type: string
        default: ''
```

- [ ] **Step 2: Make the artifacts step honor the input version**

In the `artifacts` job "Build versioned artifacts" step, replace:

```bash
          version="0.0.0-${GITHUB_SHA::12}"
```

with:

```bash
          version="${{ inputs.version }}"
          if [ -z "$version" ]; then version="0.0.0-${GITHUB_SHA::12}"; fi
          numeric="${version%%-*}"
```

and change the Agent publish version args from `-p:Version="$version"` to `-p:Version="$numeric"` (keep `-p:InformationalVersion="$version"`):

```bash
          dotnet publish src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj --no-restore --configuration Release --output artifacts/agent -p:Version="$numeric" -p:InformationalVersion="$version"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/quality.yml
git commit -m "Make quality workflow reusable with an optional version input"
```

---

### Task 3: Add `linux-all` group and version stamping to build.sh

**Files:**
- Modify: `build.sh`

**Interfaces:**
- Produces: `./build.sh linux-all` builds `linux-x64`, `linux-arm`, `linux-arm64` into `dist/<rid>/`. When env `VERSION` is set, binaries are stamped with it. Consumed by Task 5 `stage-linux.sh`.

- [ ] **Step 1: Add the `linux-all` target group**

In the `case "$INPUT_TARGET" in` block, add a branch before the `"all")` branch:

```bash
        "linux-all" | "linuxall")
            TARGETS=("linux-x64" "linux-arm" "linux-arm64")
            ;;
```

- [ ] **Step 2: Compute optional version publish args**

Immediately after the target-selection `if/else/fi` block (just before the `echo "📦 Package Manager..."` line), add:

```bash
# Optional version stamping via VERSION env (unset = current csproj default)
VERSION_ARGS=()
if [ -n "${VERSION:-}" ]; then
    NUMERIC_VERSION="${VERSION%%-*}"
    VERSION_ARGS=(-p:Version="$NUMERIC_VERSION" -p:InformationalVersion="$VERSION")
    echo "🏷️  Stamping version: $VERSION (numeric $NUMERIC_VERSION)"
fi
```

- [ ] **Step 3: Pass the version args into both publishes**

In `build_target()`, add `"${VERSION_ARGS[@]}"` to each `dotnet publish`. For the API publish, change the last line from `-o "$out_dir/"` to:

```bash
      -o "$out_dir/" \
      "${VERSION_ARGS[@]}"
```

and identically for the Agent publish (add the same two lines after its `-o "$out_dir/"`).

- [ ] **Step 4: Verify existing behavior and the new group locally**

```bash
bash -n build.sh                      # syntax check
VERSION=9.9.9-test ./build.sh linux-arm64
ls dist/linux-arm64/Pulse.Edge dist/linux-arm64/Pulse.Edge.Agent
```
Expected: syntax OK; the two self-contained binaries exist (cross-compiled from macOS). (Full `linux-all` also works but is slower; one RID is enough to confirm.)

- [ ] **Step 5: Commit**

```bash
git add build.sh
git commit -m "Add linux-all build group and optional version stamping"
```

---

### Task 4: Extract the shared APT-repo helper and de-duplicate deploy-staging.sh

**Files:**
- Create: `scripts/release/make-apt-repo.sh`
- Test: `scripts/release/make-apt-repo.test.sh`
- Modify: `deploy-staging.sh`

**Interfaces:**
- Produces: `make-apt-repo.sh <debian_dir> <version>` — finds the `pulse-edge_*_arm64.deb` in `<debian_dir>` and writes `Packages`, `Packages.gz`, `Release`, and `install.sh` there. Consumed by Task 5 and by `deploy-staging.sh`.

- [ ] **Step 1: Write the failing test**

Create `scripts/release/make-apt-repo.test.sh`:

```bash
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
chmod +x scripts/release/make-apt-repo.test.sh
bash scripts/release/make-apt-repo.test.sh
```
Expected: fails — `make-apt-repo.sh` does not exist.

- [ ] **Step 3: Write the helper**

Create `scripts/release/make-apt-repo.sh`:

```bash
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
```

- [ ] **Step 4: Run to verify it passes**

```bash
chmod +x scripts/release/make-apt-repo.sh
bash scripts/release/make-apt-repo.test.sh
```
Expected: `All tests passed.`

- [ ] **Step 5: Refactor deploy-staging.sh to use the helper**

In `deploy-staging.sh`, after the line that copies the deb into staging
(`cp "$DEB_FILE" "$STAGING_DIR/debian/"`), delete the inline index/Release/
install.sh generation (from `# Generate Flat APT Repository index` through the
`chmod +x "$STAGING_DIR/debian/install.sh"` line) and replace the whole block with:

```bash
# Generate APT repo index + install.sh via the shared helper
log_info "Generating APT repository metadata indices..."
"$SCRIPT_DIR/scripts/release/make-apt-repo.sh" "$STAGING_DIR/debian" "1.0.0"
```

- [ ] **Step 6: Verify deploy-staging.sh still parses**

```bash
bash -n deploy-staging.sh
```
Expected: no output. (Full run is user-smoke-tested later — it needs macOS tools + MinIO.)

- [ ] **Step 7: Commit**

```bash
git add scripts/release/make-apt-repo.sh scripts/release/make-apt-repo.test.sh deploy-staging.sh
git commit -m "Extract shared APT-repo helper and reuse it in deploy-staging.sh"
```

---

### Task 5: Linux staging build script

**Files:**
- Create: `scripts/release/stage-linux.sh`

**Interfaces:**
- Consumes: `build.sh linux-all` + `VERSION` (Task 3), `build-deb.sh <arch> <version>`, `make-apt-repo.sh` (Task 4).
- Produces: `stage-linux.sh <version>` assembles `dist/staging/{debian,linux}` + `dist/staging/SHA256SUMS`. Consumed by Task 6 `publish`.

- [ ] **Step 1: Write the script**

Create `scripts/release/stage-linux.sh`:

```bash
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
```

- [ ] **Step 2: Partial local verification**

```bash
chmod +x scripts/release/stage-linux.sh
bash -n scripts/release/stage-linux.sh
```
Expected: no syntax errors. A full run needs `dpkg-deb` (absent on stock macOS), so the complete build is verified in CI (Task 8). If `dpkg-deb` is installed locally (`brew install dpkg`), a full `./scripts/release/stage-linux.sh 9.9.9-test` should produce `dist/staging/` with the `.deb`, three zips, APT files, and `SHA256SUMS`.

- [ ] **Step 3: Commit**

```bash
git add scripts/release/stage-linux.sh
git commit -m "Add Linux staging build-and-package script"
```

---

### Task 6: Release workflow (tag → gated build → MinIO + GitHub Release)

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `derive-version.sh` (Task 1), reusable `quality.yml` (Task 2), `stage-linux.sh` (Task 5), and `REPO_UPLOAD_TOKEN` (secret) + `PULSE_API_ORIGIN` (variable).

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  guard:
    name: Validate tag and branch
    runs-on: ubuntu-latest
    timeout-minutes: 10
    outputs:
      version: ${{ steps.derive.outputs.version }}
      numeric_version: ${{ steps.derive.outputs.numeric_version }}
    steps:
      - name: Check out full history
        uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - name: Derive and validate version from tag
        id: derive
        run: ./scripts/release/derive-version.sh "$GITHUB_REF" >> "$GITHUB_OUTPUT"
      - name: Require tag commit to be on main
        run: |
          set -euo pipefail
          git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
          if ! git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main; then
            echo "error: tagged commit $GITHUB_SHA is not reachable from main; refusing to release." >&2
            exit 1
          fi

  validate:
    name: Required checks
    needs: guard
    uses: ./.github/workflows/quality.yml
    with:
      version: ${{ needs.guard.outputs.version }}
    secrets: inherit

  publish:
    name: Build, stage, and release
    needs: [guard, validate]
    runs-on: ubuntu-latest
    timeout-minutes: 40
    permissions:
      contents: write
    steps:
      - name: Check out source
        uses: actions/checkout@v6
      - name: Set up .NET
        uses: actions/setup-dotnet@v5
        with:
          global-json-file: global.json
      - name: Set up pnpm
        uses: pnpm/action-setup@v6
      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version-file: .node-version
          cache: pnpm
      - name: Build and assemble Linux staging tree
        run: ./scripts/release/stage-linux.sh "${{ needs.guard.outputs.version }}"
      - name: Publish staging artifacts to PULSE repo
        env:
          REPO_UPLOAD_TOKEN: ${{ secrets.REPO_UPLOAD_TOKEN }}
          PULSE_API_ORIGIN: ${{ vars.PULSE_API_ORIGIN }}
        run: |
          set -euo pipefail
          cd dist/staging
          find . -type f | sed 's#^\./##' | sort > "$RUNNER_TEMP/keys.txt"
          while IFS= read -r rel; do
            [ -n "$rel" ] || continue
            echo "==> Publishing staging/$rel"
            curl --fail-with-body -sS -X PUT \
              -H "Authorization: Bearer ${REPO_UPLOAD_TOKEN}" \
              -H "Content-Type: application/octet-stream" \
              --data-binary @"$rel" \
              "${PULSE_API_ORIGIN}/api/repo/objects/staging/${rel}"
            echo
          done < "$RUNNER_TEMP/keys.txt"
      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          version="${{ needs.guard.outputs.version }}"
          prerelease=""
          case "$version" in *-*) prerelease="--prerelease" ;; esac
          if gh release view "v$version" >/dev/null 2>&1; then
            echo "error: release v$version already exists; versions are immutable." >&2
            exit 1
          fi
          gh release create "v$version" \
            --title "v$version" \
            --notes "Automated Linux staging release v$version (also published to the PULSE repo staging area)." \
            $prerelease \
            "dist/staging/debian/pulse-edge_${version}_arm64.deb" \
            "dist/staging/linux/pulse-edge-linux-x64.zip" \
            "dist/staging/linux/pulse-edge-linux-arm.zip" \
            "dist/staging/linux/pulse-edge-linux-arm64.zip" \
            "dist/staging/SHA256SUMS"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Add tag-triggered release workflow: gated build, MinIO staging, GitHub Release"
```

---

### Task 7: Verify the reusable change does not break the normal path

**Files:** none (verification only)

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin feature/g1-release-enforcement
gh pr create --base main --title "G1: release-tag build, staging deploy, and check enforcement" \
  --body "Reusable quality workflow + tag-triggered release pipeline (Linux artifacts → MinIO staging + GitHub Release), gated on required checks. See docs/superpowers/specs/2026-07-13-release-tag-enforcement-design.md."
```

- [ ] **Step 2: Watch the Quality workflow on the PR**

```bash
SHA=$(git rev-parse HEAD)
until gh run list --commit "$SHA" --workflow Quality --limit 1 | grep -q Quality; do sleep 3; done
RID=$(gh run list --commit "$SHA" --workflow Quality --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
```
Expected: all four Quality jobs pass — proves the reusable change didn't alter PR behavior. Do NOT merge yet.

---

### Task 8: Prove enforcement + happy path, record gate evidence

**Files:**
- Modify: `docs/PULSE_Edge_Production_Readiness_Roadmap.md`

**Prerequisite:** the user must add `REPO_UPLOAD_TOKEN` (secret) and `PULSE_API_ORIGIN` (variable) before the happy-path proof (Step 4). Confirm with the user before running Steps 1–4 (they push to `main` and to real staging).

- [ ] **Step 1: Merge the feature PR to main**

```bash
gh pr merge --squash --delete-branch=false
git checkout main && git pull --ff-only origin main
```

- [ ] **Step 2: Enforcement proof — a failed check blocks the release**

Create a throwaway branch, neutralize the guard on that branch so `validate` is reached, break a required check, tag it, and confirm no build/upload/release happens.

```bash
git checkout -b ci/release-enforce-proof
```

In `.github/workflows/release.yml`, replace the entire "Require tag commit to be on main" step:

```yaml
      - name: Require tag commit to be on main
        run: |
          set -euo pipefail
          git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main
          if ! git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main; then
            echo "error: tagged commit $GITHUB_SHA is not reachable from main; refusing to release." >&2
            exit 1
          fi
```

with the temporary proof version:

```yaml
      - name: Require tag commit to be on main
        run: echo "guard temporarily disabled for enforcement proof"
```

Break a required check (invalid TypeScript fails the frontend job), then tag:

```bash
printf '\nconst unused_bad = ;\n' >> src/Pulse.Edge.UI/src/main.tsx
git commit -am "PROOF: disable guard + failing check for release-gate evidence"
git push -u origin ci/release-enforce-proof
git tag v0.0.1-enforce-proof.1
git push origin v0.0.1-enforce-proof.1
```

Observe:

```bash
RID=$(gh run list --workflow Release --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" || true
gh run view "$RID"                                  # validate FAILED, publish SKIPPED
gh release view v0.0.1-enforce-proof.1 2>&1 | head -1   # expect: release not found
```
Evidence: `validate` red, `publish` skipped, no release, nothing uploaded. Capture the run URL.

- [ ] **Step 3: Clean up the proof**

```bash
git push origin :refs/tags/v0.0.1-enforce-proof.1
git push origin :ci/release-enforce-proof
git tag -d v0.0.1-enforce-proof.1
git checkout main
```

- [ ] **Step 4: Happy-path proof — a passing tag produces a release**

(Requires `REPO_UPLOAD_TOKEN` + `PULSE_API_ORIGIN` to be set.) Tag a real `main` commit with a throwaway pre-release tag:

```bash
git tag v0.0.1-pipeline-proof.1
git push origin v0.0.1-pipeline-proof.1
RID=$(gh run list --workflow Release --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
gh release view v0.0.1-pipeline-proof.1     # release with .deb, 3 zips, SHA256SUMS
```
Also confirm the artifacts are downloadable, e.g. `curl -fsI "$PULSE_API_ORIGIN/download/staging/debian/install.sh"`. Capture the run/release URL, then clean up the GitHub release (staging is overwritten by the next real release):

```bash
gh release delete v0.0.1-pipeline-proof.1 --yes --cleanup-tag
```

- [ ] **Step 5: Record evidence and check the gate item**

In `docs/PULSE_Edge_Production_Readiness_Roadmap.md`, Phase 1 / Gate G1, change:

```markdown
- [ ] A failed required check prevents release creation.
```

to:

```markdown
- [x] A failed required check prevents release creation.
```

Add under the G1 **Evidence** list (use the captured URLs):

```markdown
- Release enforcement proof: [failed check skipped publish; no release or upload](<enforcement-proof-run-url>)
- Release happy path: [tag built Linux artifacts, uploaded to MinIO staging, and created a GitHub Release](<happy-path-run-url>)
```

Add a **Gate review log** row:

```markdown
| 2026-07-13 | G1 | In progress | Tag-triggered release pipeline gated on the reusable Quality checks builds Linux artifacts (self-contained binaries + arm64 .deb/APT repo), uploads to MinIO staging, and creates a GitHub Release. Enforcement proof shows a failed check skips publish with no upload or release. | Request the authorized G1 gate review. |
```

- [ ] **Step 6: Commit**

```bash
git add docs/PULSE_Edge_Production_Readiness_Roadmap.md
git commit -m "Record release-enforcement gate evidence (G1)"
git push origin main
```

---

## Notes for the implementer

- **macOS cross-compile:** `dotnet publish -r linux-*` works from macOS, so `build.sh linux-all` runs locally; only `.deb` packaging needs `dpkg-deb` (Ubuntu has it; macOS needs `brew install dpkg`). Don't block on a full local `stage-linux.sh` run — CI is the real check.
- **`shasum` portability:** used by `make-apt-repo.sh` and `stage-linux.sh`; present on both macOS and ubuntu-latest.
- **Secrets:** Task 8 Step 4 fails without `REPO_UPLOAD_TOKEN` + `PULSE_API_ORIGIN`. The enforcement proof (Step 2) does not need them (it never reaches upload).
- **deploy-staging.sh:** the refactor changes only the APT-index block; the user should run it once locally after merge to confirm the manual full-platform flow still works (CI cannot exercise its macOS/upload path).
