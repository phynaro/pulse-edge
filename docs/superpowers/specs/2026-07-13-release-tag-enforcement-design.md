# Release-tag build, staging deploy, and check enforcement — Design

**Date:** 2026-07-13 (revised after clarifying the real release target)
**Gate:** G1 (Build integrity) — closes *"a failed required check prevents release creation"* and defines the real release pipeline.
**Status:** Revised; awaiting approval.

## Goal

On pushing a version tag, **only if every required check passes**, build the
Linux release artifacts (self-contained binaries + Debian package/APT repo),
upload them to the MinIO staging area at `pulse.trazor.cloud`, and create a
matching GitHub Release. A failed check must stop the build and the upload.

## Decisions

| Topic | Choice |
|---|---|
| Trigger | Push semver tag `vMAJOR.MINOR.PATCH[-pre]` |
| Platforms | **Linux only**: `linux-x64`, `linux-arm`, `linux-arm64`, plus the arm64 `.deb`/APT repo. Windows + macOS deferred (R-006). |
| Output targets | **Both** — upload to MinIO `staging/`, and create a GitHub Release |
| Staging layout | Overwrite `staging/` each release (latest tag wins), matching `deploy-staging.sh` today |
| Enforcement wiring | Reusable workflow (`quality.yml` via `workflow_call`) gates a `publish` job |
| Version source | Derived from the tag; injected into `.deb`, APT index, filenames, and binary metadata |

## What the release contains (the artifacts)

For each Linux RID, a self-contained single-file build of **both** executables
(`Pulse.Edge` — the unified server — and `Pulse.Edge.Agent`), mirroring
`build.sh`'s `build_target`. Assembled into a `dist/staging/` tree:

```
dist/staging/
  debian/
    pulse-edge_<version>_arm64.deb     # RevPi / apt install path
    Packages  Packages.gz  Release     # flat APT repo index
    install.sh                         # registers the staging apt repo
  linux/
    pulse-edge-linux-x64.zip           # self-contained binaries, per arch
    pulse-edge-linux-arm.zip
    pulse-edge-linux-arm64.zip
  SHA256SUMS                           # checksums over everything above
```

The arm64 `.deb` + APT repo is the primary Linux deploy path (RevPi is arm64,
installed via `sudo apt install pulse-edge`). The per-arch zips give direct
downloads for x64/arm/arm64. This is what the chosen "x64, arm, arm64 + .deb"
means concretely. (x64/armhf `.deb` packages can be added later if needed — out
of scope now.)

## Architecture

Three workflow files/scripts, plus targeted edits to existing build scripts.

### 1. `quality.yml` becomes reusable (unchanged from prior design)

Add a `workflow_call` trigger with an optional `version` input. Its four jobs
remain the required checks. This is what the release gates on.

### 2. Build-script changes (reused by both local and CI, DRY)

- **`build.sh`**: add a `linux-all` target group that builds `linux-x64`,
  `linux-arm`, `linux-arm64` in one invocation (today each call runs
  `rm -rf dist`, so three separate calls would wipe each other). Add optional
  `VERSION` env support: when set, pass `-p:Version=<numeric>` and
  `-p:InformationalVersion=<version>` to the `dotnet publish` calls; when unset,
  behavior is exactly as today. Windows/mac targets untouched.
- **`build-deb.sh`**: already accepts `build-deb.sh <arch> <version>` — no change
  needed beyond passing the version.
- **`scripts/release/make-apt-repo.sh`** (new): generate the flat APT repo files
  (`Packages`, `Packages.gz`, `Release`) and the staging `install.sh` for a given
  `.deb` and version. This logic currently lives inline in `deploy-staging.sh`
  (lines ~146–228); extracting it lets CI and the local script share one
  implementation so the APT metadata can't drift. `deploy-staging.sh` is
  refactored to call this helper. (Local script must be smoke-tested once by the
  user, since CI cannot exercise its macOS/upload path.)

### 3. `scripts/release/stage-linux.sh` (new) — build + package, no upload

Takes `<version>`. Runs `VERSION=<version> ./build.sh linux-all`, then
`./build-deb.sh arm64 <version>`, then `make-apt-repo.sh`, zips the three arch
folders, assembles `dist/staging/`, and writes `SHA256SUMS`. Produces the full
staging tree locally with no network — so it is runnable and inspectable outside
CI. The MinIO upload is deliberately *not* in this script (keeps it testable).

### 4. `release.yml` (new) — tag-triggered, gated pipeline

Trigger: `push: tags: ['v*']`. Jobs:

- **`guard`** — validate tag shape (`scripts/release/derive-version.sh`), confirm
  the tagged commit is reachable from `main`, output `version` + `numeric_version`.
- **`validate`** — `uses: ./.github/workflows/quality.yml`, `needs: guard`,
  `secrets: inherit`. The gate: runs all required checks on the tagged commit.
- **`publish`** — `needs: [guard, validate]`, so it cannot start unless every
  check passed. Steps:
  1. Check out the tagged commit; set up .NET, pnpm, Node.
  2. `scripts/release/stage-linux.sh "${{ needs.guard.outputs.version }}"` →
     builds `dist/staging/`.
  3. Install the MinIO client (`mc`), configure the alias from secrets, and
     `mc mirror --overwrite dist/staging/ pulse-minio/$MINIO_BUCKET/staging/`.
  4. Create the GitHub Release `v<version>` (via `gh release create`), marking it
     `--prerelease` when the version has a `-`, attaching the `.deb`, the three
     zips, and `SHA256SUMS`.

### Data flow

```
git push origin v1.2.3
        │
        ▼
   release.yml
     [guard]  bad tag / not on main ──▶ FAIL (nothing built)
        │ version=1.2.3
        ▼
   [validate] uses quality.yml (backend, frontend, secrets, artifacts)
        │  any check red ──▶ FAIL ──▶ publish skipped ──▶ NOTHING built or uploaded
        │ all green
        ▼
   [publish] stage-linux.sh → dist/staging/ (binaries + .deb + apt + zips + sums)
        │        │
        │        ├─▶ mc mirror ─▶ MinIO pulse-repo/staging/  (pulse.trazor.cloud)
        │        └─▶ gh release create v1.2.3 (.deb, zips, SHA256SUMS)
```

## Secrets required (added by the user in GitHub)

- `MINIO_ENDPOINT` (e.g. `https://pulse.trazor.cloud`)
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `MINIO_BUCKET` (e.g. `pulse-repo`)

The `publish` job needs `contents: write` (for the GitHub Release) and reads the
MinIO secrets from the repository/environment secrets.

## Version stamping

- Tag `v1.2.3` → `version=1.2.3`, `numeric_version=1.2.3`.
- Tag `v1.0.0-rc.1` → `version=1.0.0-rc.1`, `numeric_version=1.0.0`.
- `.deb` control `Version:` and filename use `version` (dpkg accepts the full
  string). `.NET` `-p:Version` uses `numeric_version`; `-p:InformationalVersion`
  uses the full `version`. APT `Packages` `Version:` uses `version`.

## Error handling / edge cases

- Malformed tag or tag not on `main` → `guard` fails; nothing built.
- Any required check fails → `validate` fails → `publish` skipped → nothing built
  or uploaded (this is the gate).
- MinIO auth/upload failure → `publish` fails after build; no partial "success".
  The GitHub Release step runs only after a successful upload.
- Re-tagging an existing version → `gh release create` errors if the release
  exists (versions immutable). MinIO `staging/` is overwrite-by-design.
- Pre-release tag → GitHub Release flagged pre-release.

## Verification / gate evidence

1. **`stage-linux.sh` locally (partial):** on the dev Mac, `.deb` packaging needs
   `dpkg-deb` (not default on macOS). Verify the non-deb parts locally
   (`build.sh linux-all` cross-compiles Linux binaries from macOS; zip + checksum
   steps run). Full `.deb` + APT steps are verified in CI (Ubuntu has `dpkg-deb`).
2. **`derive-version.sh`:** unit-tested locally (bash test harness).
3. **Normal path unaffected:** the reusable `quality.yml` change is proven by a
   PR whose four checks stay green.
4. **Enforcement proof:** on a throwaway branch, relax the guard and break one
   check, tag it, and capture that `validate` went red, `publish` was skipped, and
   **nothing reached MinIO or a GitHub Release**. Delete the proof tag/branch.
5. **Happy-path proof:** tag a real `main` commit with a throwaway pre-release
   tag; confirm the MinIO `staging/` tree and the GitHub Release appear with the
   real version; then clean up.
6. Record run/release links in the roadmap G1 evidence and check the gate item.

## Files touched

- `.github/workflows/quality.yml` — add `workflow_call` + version input.
- `.github/workflows/release.yml` — new.
- `scripts/release/derive-version.sh` (+ `.test.sh`) — new.
- `scripts/release/make-apt-repo.sh` — new (extracted from `deploy-staging.sh`).
- `scripts/release/stage-linux.sh` — new.
- `build.sh` — add `linux-all` group + optional `VERSION` env.
- `deploy-staging.sh` — call `make-apt-repo.sh` (de-duplicate).
- `docs/PULSE_Edge_Production_Readiness_Roadmap.md` — evidence + gate item.

## Out of scope (later gates)

- Windows (`.exe`/`.msi` installers or ZIPs) and macOS ZIPs — deferred (R-006);
  the CI script builds Linux only. `deploy-staging.sh` keeps building them for
  local manual use.
- Signed packages, rollback, staged install — G6.
- Promotion from `staging/` to production on MinIO — remains the manual
  `mc cp` step documented in `deploy-staging.sh`; not automated here.
- x64/armhf `.deb` packages and a multi-arch APT repo — future, if needed.
