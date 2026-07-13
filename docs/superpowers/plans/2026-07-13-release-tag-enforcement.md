# Release-tag Check Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a versioned GitHub Release only from a `main` commit that passes every required check, by making the checks reusable and gating a tag-triggered release pipeline on them.

**Architecture:** `quality.yml` gains a `workflow_call` trigger so it can be run as a reusable unit. A new `release.yml` fires on a `v*` tag and runs three chained jobs: `guard` (validate tag shape + confirm the commit is on `main` + derive the version), `validate` (calls `quality.yml` — the gate), and `publish` (downloads the validated artifact and creates the GitHub Release). `publish` has `needs: [guard, validate]`, so a red check structurally blocks the release. The tricky version-parsing lives in a unit-tested bash script.

**Tech Stack:** GitHub Actions (reusable workflows, `workflow_call`), bash (POSIX / bash 3.2 compatible), `gh` CLI, `actions/download-artifact@v6`.

## Global Constraints

- Tag format accepted: `v` + semver, optional pre-release suffix — regex `^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`. Examples valid: `v0.9.0`, `v1.0.0`, `v1.0.0-rc.1`, `v0.9.0-pilot.2`. Invalid: `1.2.3`, `v1.2`, `vfoo`, `v1.2.3.4`.
- `.NET` version stamping: `-p:Version=<numeric part before any '-'>` and `-p:InformationalVersion=<full version>`.
- Release only commits reachable from `main` (strict). Re-tagging an existing version is an error (versions immutable).
- Scripts must run on macOS bash 3.2 (no associative arrays, no `${var,,}`). Use `grep -E`, `sed`, and POSIX parameter expansion only.
- Do not change how `quality.yml` behaves for `pull_request` / `push: main` — the reuse is additive.
- No new third-party Actions beyond those already used, except `actions/download-artifact` (official).
- Installers / signing / per-platform builds are OUT of scope (G6).

---

### Task 1: Version-derivation script (unit-tested)

**Files:**
- Create: `scripts/release/derive-version.sh`
- Test: `scripts/release/derive-version.test.sh`

**Interfaces:**
- Produces: `scripts/release/derive-version.sh <tag-or-ref>` prints two lines to stdout — `version=<X.Y.Z[-pre]>` and `numeric_version=<X.Y.Z>` — and exits 0 on a valid tag; prints an error to stderr and exits 1 on an invalid tag. Accepts either `refs/tags/v1.2.3` or `v1.2.3`. Later tasks (`release.yml` guard job) append its stdout to `$GITHUB_OUTPUT`.

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
Expected: fails — `derive-version.sh` does not exist yet (every case FAILs / errors).

- [ ] **Step 3: Write the script**

Create `scripts/release/derive-version.sh`:

```bash
#!/usr/bin/env bash
# Validate a release tag and emit its version parts.
# Usage: derive-version.sh <refs/tags/vX.Y.Z[-pre] | vX.Y.Z[-pre]>
# Prints: version=<X.Y.Z[-pre]> and numeric_version=<X.Y.Z>
set -euo pipefail

raw="${1:-}"
tag="${raw#refs/tags/}"

if ! printf '%s' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "error: tag '$tag' is not a valid version tag (expected vMAJOR.MINOR.PATCH[-prerelease])" >&2
  exit 1
fi

version="${tag#v}"            # strip leading v
numeric_version="${version%%-*}"  # part before first '-'

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
- Modify: `.github/workflows/quality.yml` (the `on:` block, and the `artifacts` job's "Build versioned artifacts" step)

**Interfaces:**
- Produces: `quality.yml` callable via `workflow_call` with an optional string input `version` (default `''`). When `version` is non-empty, the `artifacts` job stamps it; otherwise it falls back to `0.0.0-<sha12>`. The uploaded artifact is named `pulse-edge-<github.sha>` (unchanged). Consumed by Task 3's `validate` job.

- [ ] **Step 1: Add the `workflow_call` trigger**

In `.github/workflows/quality.yml`, replace the `on:` block:

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

- [ ] **Step 2: Make the artifacts step use the input version**

In the `artifacts` job's "Build versioned artifacts" step, replace this line:

```bash
          version="0.0.0-${GITHUB_SHA::12}"
```

with:

```bash
          version="${{ inputs.version }}"
          if [ -z "$version" ]; then version="0.0.0-${GITHUB_SHA::12}"; fi
          numeric="${version%%-*}"
```

and replace the `dotnet publish` line's version arguments — change:

```bash
          dotnet publish src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj --no-restore --configuration Release --output artifacts/agent -p:Version="$version" -p:InformationalVersion="$version"
```

to:

```bash
          dotnet publish src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj --no-restore --configuration Release --output artifacts/agent -p:Version="$numeric" -p:InformationalVersion="$version"
```

(Note: `${{ inputs.version }}` renders to an empty string for `pull_request` / `push` events, so the fallback keeps today's behavior. Splitting `numeric` also fixes stamping `.NET`'s `Version` with a pre-release string, which is invalid.)

- [ ] **Step 3: Verify the file still parses as valid workflow YAML**

Local linters aren't installed, so confirm indentation/structure by eye against the surrounding jobs, then rely on the CI run in Task 4 as the real check. If `actionlint` is available (`command -v actionlint`), run:

```bash
actionlint .github/workflows/quality.yml
```
Expected: no output (clean). If not installed, skip — Task 4 validates by execution.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/quality.yml
git commit -m "Make quality workflow reusable with an optional version input"
```

---

### Task 3: Create the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `scripts/release/derive-version.sh` (Task 1); `quality.yml`'s `workflow_call` + `version` input and its `pulse-edge-<sha>` artifact (Task 2).
- Produces: on a `v*` tag push, a GitHub Release `v<version>` with the bundle zip, SBOM, and `SHA256SUMS`, gated on the reusable checks.

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
    name: Publish GitHub Release
    needs: [guard, validate]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
    steps:
      - name: Download the validated artifact
        uses: actions/download-artifact@v6
        with:
          name: pulse-edge-${{ github.sha }}
          path: artifacts

      - name: Package the release bundle
        run: |
          set -euo pipefail
          version="${{ needs.guard.outputs.version }}"
          ( cd artifacts && zip -r "../pulse-edge-${version}.zip" . )

      - name: Create the GitHub Release
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
            --notes "Automated release for v$version. Contains the validated Agent + UI bundle, SPDX SBOM, and SHA256SUMS." \
            $prerelease \
            "pulse-edge-${version}.zip" \
            "artifacts/pulse-edge.spdx.json" \
            "artifacts/SHA256SUMS"
```

- [ ] **Step 2: Verify structure**

If `actionlint` is available, run `actionlint .github/workflows/release.yml` (expect clean). Otherwise eyeball indentation and confirm each `run:` block's shell is valid, then rely on Task 5's execution proof.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Add tag-triggered release workflow gated on required checks"
```

---

### Task 4: Verify the reusable change does not break the normal path

**Files:** none (verification only)

- [ ] **Step 1: Push the branch and open a PR**

```bash
git push -u origin feature/g1-release-enforcement
gh pr create --base main --title "G1: release-tag check enforcement" \
  --body "Adds reusable quality workflow + tag-triggered release pipeline gated on required checks. See docs/superpowers/specs/2026-07-13-release-tag-enforcement-design.md."
```

- [ ] **Step 2: Watch the Quality workflow on the PR**

```bash
SHA=$(git rev-parse HEAD)
until gh run list --commit "$SHA" --workflow Quality --limit 1 | grep -q Quality; do sleep 3; done
RID=$(gh run list --commit "$SHA" --workflow Quality --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
```
Expected: all four Quality jobs pass — proves adding `workflow_call` + the version-input wiring did not change PR behavior.

- [ ] **Step 3: Confirm PR is mergeable**

```bash
gh pr checks   # required checks green
```
Do NOT merge yet — Task 5's enforcement proof runs before we rely on the pipeline.

---

### Task 5: Prove enforcement and happy path, then record gate evidence

**Files:**
- Modify: `docs/PULSE_Edge_Production_Readiness_Roadmap.md`

This task produces the durable evidence the G1 gate requires. It uses throwaway tags/branches that are deleted afterward. It needs the feature branch merged to `main` first (so `release.yml` and the guard exist on `main` and the on-main guard can pass for the happy-path tag).

- [ ] **Step 1: Merge the feature PR to main**

```bash
gh pr merge --squash --delete-branch=false
git checkout main && git pull --ff-only origin main
```

- [ ] **Step 2: Enforcement proof — a failed check blocks the release**

On a throwaway branch, make the guard pass but a required check fail, then tag it and confirm `publish` never runs and no release is created. First create the branch:

```bash
git checkout -b ci/release-enforce-proof
```

Neutralize the on-main guard on this branch only, so `validate` is actually reached (otherwise `guard` fails first and we'd prove the wrong thing). In `.github/workflows/release.yml`, replace the entire "Require tag commit to be on main" step:

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

with this temporary proof version:

```yaml
      - name: Require tag commit to be on main
        run: echo "guard temporarily disabled for enforcement proof"
```

Break a required check deliberately (this is invalid TypeScript, so the frontend lint/build fails), commit, push the branch, and tag the commit:

```bash
printf '\nconst unused_bad = ;\n' >> src/Pulse.Edge.UI/src/main.tsx
git commit -am "PROOF: disable guard + intentionally failing check for release-gate evidence"
git push -u origin ci/release-enforce-proof
git tag v0.0.1-enforce-proof.1
git push origin v0.0.1-enforce-proof.1
```

(The tag points at the proof-branch commit, so the release run uses that commit's relaxed `release.yml` — `guard` passes, `validate` runs and fails, and we observe `publish` get skipped.)

Watch the release run:

```bash
RID=$(gh run list --workflow Release --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" || true
gh run view "$RID"      # expect: validate FAILED, publish SKIPPED
gh release view v0.0.1-enforce-proof.1 2>&1 | head -1   # expect: "release not found"
```
Expected evidence: `validate` red, `publish` skipped, no release exists. Capture the run URL.

- [ ] **Step 3: Clean up the proof**

```bash
git push origin :refs/tags/v0.0.1-enforce-proof.1   # delete remote tag
git push origin :ci/release-enforce-proof            # delete remote branch
git tag -d v0.0.1-enforce-proof.1
git checkout main
```

- [ ] **Step 4: Happy-path proof — a passing commit produces a release**

Tag a real `main` commit with a throwaway pre-release tag, confirm the Release appears with a real version, then remove it:

```bash
git tag v0.0.1-pipeline-proof.1
git push origin v0.0.1-pipeline-proof.1
RID=$(gh run list --workflow Release --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --exit-status
gh release view v0.0.1-pipeline-proof.1   # expect: release with bundle zip, SBOM, SHA256SUMS
```
Confirm `build-metadata.txt` inside the bundle shows `version=0.0.1-pipeline-proof.1` (not `0.0.0-...`). Capture the release/run URL, then clean up:

```bash
gh release delete v0.0.1-pipeline-proof.1 --yes --cleanup-tag
```

- [ ] **Step 5: Record evidence in the roadmap and check the gate item**

In `docs/PULSE_Edge_Production_Readiness_Roadmap.md`, in the Phase 1 / Gate G1 section, change:

```markdown
- [ ] A failed required check prevents release creation.
```

to:

```markdown
- [x] A failed required check prevents release creation.
```

and add these two lines under the G1 **Evidence** list (replace the run/release URLs with the ones captured above):

```markdown
- Release enforcement proof: [failed check skipped publish, no release created](<enforcement-proof-run-url>)
- Release happy path: [tag produced a versioned GitHub Release with SBOM and checksums](<happy-path-run-url>)
```

Also add a row to the **Gate review log** table:

```markdown
| 2026-07-13 | G1 | In progress | Tag-triggered release pipeline gated on the reusable Quality checks. Enforcement proof shows a failed check skips publish with no release; happy-path tag produces a versioned GitHub Release with SBOM and checksums. | Request the authorized G1 gate review. |
```

- [ ] **Step 6: Commit**

```bash
git add docs/PULSE_Edge_Production_Readiness_Roadmap.md
git commit -m "Record release-enforcement gate evidence (G1)"
git push origin main
```

---

## Notes for the implementer

- **The flagged risk (spec):** in Task 5 Step 4, verify `publish` successfully downloads the `pulse-edge-<sha>` artifact built inside the reusable `validate` run. If `download-artifact` reports the artifact missing, apply the documented fallback: replace the "Download the validated artifact" step with a rebuild (reuse the `artifacts` job's build commands from `quality.yml`, stamping `${{ needs.guard.outputs.version }}`). Re-run the happy-path proof.
- **On-main guard during the enforcement proof:** Task 5 Step 2 requires temporarily editing the guard's merge-base target to the proof branch so `validate` is actually reached (otherwise `guard` fails first and you'd be proving the wrong thing). That edit lives only on the throwaway branch and is deleted in Step 3.
