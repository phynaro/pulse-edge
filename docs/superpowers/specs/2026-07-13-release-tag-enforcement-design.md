# Release-tag build with check enforcement — Design

**Date:** 2026-07-13
**Gate:** G1 (Build integrity) — closes the open item *"a failed required check prevents release creation"* and the *release-tag artifact/metadata* work.
**Status:** Approved for planning.

## Goal

Produce a versioned, downloadable release **only** from a commit that has passed
every required check. On GitHub you cannot stop a human from clicking "create a
release" in the web UI, so the enforceable form of the gate is: *releases are
produced by an automated pipeline that runs the required checks first and refuses
to publish anything if they fail.*

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Trigger | Push a semver git tag `vMAJOR.MINOR.PATCH` |
| Version format | Semver + pre-releases (`v1.2.3`, `v1.0.0-rc.1`, `v0.9.0-pilot.2`) |
| Output | Versioned bundle + SBOM published as a GitHub Release |
| Enforcement wiring | Reusable workflow (`quality.yml` exposed via `workflow_call`) |
| Installers / signing | Out of scope — deferred to G6 |

## Architecture

Two workflow files, one calling the other.

### 1. `quality.yml` becomes reusable

Add a `workflow_call` trigger with an optional `version` input alongside the
existing `pull_request` and `push: main` triggers:

```yaml
on:
  pull_request:
  push:
    branches: [main]
  workflow_call:
    inputs:
      version:
        type: string
        default: ''
```

The `artifacts` job derives its version as: use `inputs.version` when non-empty,
otherwise fall back to today's `0.0.0-${GITHUB_SHA::12}` placeholder. This keeps
PR/push behavior identical and lets a release run stamp the real version. The
uploaded artifact name stays `pulse-edge-${{ github.sha }}`.

No check logic changes — the point of reuse is a single source of truth so PRs
and releases run the *same* checks and cannot drift.

### 2. `release.yml` — new, triggered by a version tag

```yaml
on:
  push:
    tags: ['v*']
```

Three jobs in a dependency chain:

**`guard`** (safety + version derivation)
- Fetches `main` and confirms the tagged commit is reachable from it:
  `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`. If false, fail —
  this blocks releasing an unreviewed side branch that never went through the
  PR + checks flow.
- Validates the tag matches the accepted semver shape
  (`v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?`); reject malformed tags.
- Derives `version` = tag without the leading `v`, and `numeric_version` =
  the part before any `-`. Exposes both as job outputs.

**`validate`** (the gate)
- `uses: ./.github/workflows/quality.yml`
- `needs: guard`
- `with: { version: ${{ needs.guard.outputs.version }} }`
- `secrets: inherit` (so the reusable workflow's gitleaks step keeps its token)
- Runs the full backend / frontend / secret-scan / artifact checks.

**`publish`** (release creation)
- `needs: [guard, validate]` — cannot start unless validation fully passed.
- Downloads the artifact `pulse-edge-${{ github.sha }}` that `validate` already
  built. We release the exact bits that passed the checks rather than rebuilding,
  so the released artifact provably equals the validated one.
- Zips the bundle to `pulse-edge-<version>.zip`.
- Creates a GitHub Release `v<version>` via `gh release create`, attaching the
  zip, the SBOM (`pulse-edge.spdx.json`), and `SHA256SUMS`.
- Marks it `--prerelease` when `version` contains a `-`.
- Needs `permissions: { contents: write }` to create the release.

### Data flow

```
git push origin v1.2.3
        │
        ▼
   release.yml
        │
     [guard] ── not on main / bad tag ──▶ FAIL (no release)
        │ ok, outputs version=1.2.3
        ▼
    [validate]  uses quality.yml (backend, frontend, secrets, artifacts)
        │        any check red ──▶ FAIL (publish never runs, no release)
        │ all green, builds pulse-edge-<sha> artifact
        ▼
    [publish]  download validated artifact → zip → gh release create v1.2.3
        │
        ▼
   GitHub Release "v1.2.3": bundle.zip + SBOM + SHA256SUMS
```

## Version stamping

- Tag `v1.2.3` → `version=1.2.3`, `numeric_version=1.2.3`.
- Tag `v1.0.0-rc.1` → `version=1.0.0-rc.1`, `numeric_version=1.0.0`.
- .NET publish uses `-p:Version=<numeric_version>` (the `Version`/`AssemblyVersion`
  property only accepts numeric `Major.Minor.Patch`) and
  `-p:InformationalVersion=<version>` (carries the full human-readable string,
  including any pre-release suffix). The GitHub Release name/tag uses the full
  `version`.

## Error handling / edge cases

- **Tag not on main** → `guard` fails; no build, no release.
- **Malformed tag** (`v1.2`, `1.2.3`, `vfoo`) → `guard` rejects; no release.
- **Any required check fails** → `validate` fails; `publish` is skipped; no release.
- **Re-tagging an existing version** → `gh release create` fails if the release
  already exists; treated as an error (versions are immutable). Documented, not
  auto-overwritten.
- **Pre-release tag** → release is flagged pre-release so tooling ranks it below
  the final version.

## Implementation risk to verify

The `publish` job downloads an artifact uploaded by a job *inside* the reusable
`validate` workflow. Artifacts are scoped per run, and a called workflow's jobs
execute within the same run, so this is expected to work — but it is the one
non-obvious assumption in the design and must be confirmed early during
implementation (a quick throwaway run). Fallback if it does not: have `publish`
rebuild the versioned bundle from the validated commit instead of downloading it
(slightly less ideal for supply-chain provenance, but functionally equivalent for
the gate).

## Verification / gate evidence

CI workflows are validated by exercising them, not unit tests. Evidence plan:

1. **Happy path:** tag a real commit on `main` (e.g. an early `v0.9.0-pilot.0`),
   confirm the Release appears with the bundle, SBOM, and checksums, and that the
   version is stamped (not `0.0.0-...`).
2. **Enforcement proof:** on a throwaway branch, temporarily break one required
   check, tag that commit, push the tag, and capture that `validate` went red and
   **no Release was created**. Delete the proof tag/branch afterward. This failed
   run plus the absent release is the durable evidence, mirroring the earlier
   PR-block proof.
3. Attach both run links to the roadmap G1 gate item and check it off.

## Files touched

- `.github/workflows/quality.yml` — add `workflow_call` + version-input wiring in
  the `artifacts` job.
- `.github/workflows/release.yml` — new.
- `docs/PULSE_Edge_Production_Readiness_Roadmap.md` — check the gate item and add
  evidence links after the proof.

## Out of scope (later gates)

Signed installers, per-platform `.msi` / `.deb`, self-contained per-RID builds,
staged install, and rollback — all G6 (Update, rollback, disaster recovery).
Release-numbering *policy* (support window, upgrade-compatibility rules) is a
Phase 0 item; this design only needs the tag *format* convention, not the policy.
