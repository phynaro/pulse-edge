# Phase 1 engineering slice evidence — 2026-07-12

## Scope

This record covers the sequencing-exception slice authorized while Gate G0 remains blocked: reproducible toolchain metadata, a blocking repository quality workflow, frontend lint remediation, and a read-only UI smoke check.

## Implemented

- Pinned .NET SDK `10.0.300` with latest-patch roll-forward in `global.json`.
- Pinned Node `26.5.0` and pnpm `11.5.0` in repository metadata.
- Enabled NuGet lock files and committed the generated project lock files.
- Added `.github/workflows/quality.yml` with locked backend restore, warning-free build, backend tests, NuGet audit, frozen frontend install, blocking lint, production build, Node production audit, and failure artifacts.
- Removed the frontend lint baseline of 48 errors and 2 warnings without disabling the rules.

## Verification results

| Check | Result |
|---|---|
| `pnpm lint:ui` | Passed; zero lint findings |
| `pnpm build:ui` | Passed; TypeScript and Vite production build completed |
| `dotnet restore Pulse.Edge.slnx --locked-mode` | Passed |
| `dotnet build Pulse.Edge.slnx --no-restore --warnaserror` | Passed; 0 warnings, 0 errors |
| Backend automated tests | Passed; 47 passed, 0 failed, 0 skipped |
| Workflow YAML parse | Passed |
| `git diff --check` | Passed |

The local Node runtime was `26.0.0`, below the new `26.5.0` project pin, so pnpm correctly emitted an engine warning. CI installs the pinned runtime; developers should update Node before treating their workstation as toolchain-conformant.

## Read-only browser smoke

With the user-started local server, the dashboard, protocol adapter list and add-adapter wizard, tag list and edit-tag initialization, stream list, and template manager rendered successfully. No browser console errors were observed and no configuration was saved or mutated.

## Known non-blocking build observations

- Vite reports that local font URLs remain runtime-resolved.
- The primary JavaScript chunk is larger than Vite's 500 kB advisory threshold.

These observations are not new compiler or lint failures, but should be handled as later frontend performance/packaging work.

## Gate interpretation

This evidence completes the authorized initial slice; it does not yet pass Gate G1. Hosted CI, initial frontend tests, secret/license scanning, checksummed artifacts, SBOMs, and branch enforcement are complete. Auth/backup/browser coverage, tag-based release creation, and proof that a failed check prevents release creation remain open.

## Gate follow-up

The first hosted Quality run passed for commit `854955e37070b913ae672e4592e67b4b8fbd716d`: backend restore/build/test/audit and frontend install/lint/build were green. Run: https://github.com/phynaro/pulse-edge/actions/runs/29193876254

The follow-up change adds four frontend unit tests, production dependency and license-policy enforcement, full-history secret scanning, checksummed version/commit-stamped build artifacts, and an SPDX JSON SBOM. Local frontend checks pass, and all four expanded hosted jobs passed in [Quality run 29194077549](https://github.com/phynaro/pulse-edge/actions/runs/29194077549).

PR #1 merged as commit `82dd70e44429369023960dc0a362e86fc931749d`. Its [post-merge `main` Quality run](https://github.com/phynaro/pulse-edge/actions/runs/29195409651) passed all four jobs and retained backend test/audit evidence, frontend license evidence, secret-scan evidence, a checksummed approximately 47 MB artifact bundle, and an SPDX JSON SBOM.

After the repository became public, `main` protection was enabled with all four Quality jobs required, strict/current-branch checks, conversation resolution, linear history, admin enforcement, and force-push/deletion prevention. The external approval count was later set to zero for the solo-developer workflow. Temporary PR #2 intentionally failed frontend lint; GitHub reported it as blocked. The run was cancelled after proof, and the PR and temporary branch were closed/deleted. Evidence: https://github.com/phynaro/pulse-edge/pull/2 and https://github.com/phynaro/pulse-edge/actions/runs/29194525820.
