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

This evidence completes the authorized initial slice; it does not pass Gate G1. A hosted CI run, frontend automated tests, secret/license scanning, versioned artifacts, SBOMs, and branch enforcement remain open.
