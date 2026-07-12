# Linux ARM64 Clean-Room Reproducibility Check

**Date:** 2026-07-12  
**Purpose:** Supporting evidence for G0 reproducibility and Phase 1 toolchain planning

## Isolation method

A source-only archive of the current worktree was streamed into fresh, ephemeral Docker containers. The archive excluded:

- `.git`
- all `node_modules`
- all .NET `bin` and `obj` directories
- frontend `dist`
- local `.pulse` data

The containers had no mount to the project or `~/.pulse`, so they could not use workstation build outputs, package directories, or the active PULSE database.

The first archive attempt exposed macOS AppleDouble `._*` metadata files as invalid C# inputs on Linux. Repeating the archive with `COPYFILE_DISABLE=1` removed those files and allowed compilation. Release/CI packaging from macOS must continue to exclude AppleDouble and extended-attribute metadata.

## Backend environment

- Container image: `mcr.microsoft.com/dotnet/sdk:10.0`
- Pulled image digest: `sha256:ea8bde36c11b6e7eec2656d0e59101d4462f6bd630f2c8201ed0572b295d5`
- OS: Ubuntu 24.04
- Architecture/RID: ARM64 / `linux-arm64`
- SDK: .NET `10.0.301`
- Runtime: .NET `10.0.9`

Commands inside the clean container:

```sh
dotnet restore Pulse.Edge.slnx
dotnet build Pulse.Edge.slnx --no-restore
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --no-build --no-restore
```

Results:

- Restore: passed for all solution projects.
- Build: passed with 0 warnings and 0 errors in 44.62 seconds.
- Tests: 47 passed, 0 failed, 0 skipped in 1 minute 15 seconds.

## Frontend environment

- Container image: `node:26-bookworm-slim`
- Pulled image digest: `sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c`
- OS family: Debian Bookworm
- Architecture: ARM64
- Node: `v26.5.0`
- npm: `11.17.0`
- pnpm: explicitly installed as `11.5.0`

Commands inside the clean container:

```sh
pnpm install --frozen-lockfile
pnpm --filter pulse-edge-ui build
```

Results:

- The lockfile passed pnpm supply-chain policy verification for 188 entries.
- Frozen installation passed for both workspace projects.
- TypeScript and Vite production build passed.
- Output matched the local build sizes: approximately 161.18 kB CSS and 552.94 kB JavaScript before gzip.

Known frontend warnings remained:

- Font URLs are deferred for runtime resolution.
- The main JavaScript chunk exceeds Vite's 500 kB warning threshold.
- Lint was intentionally not represented as passing; the recorded 48 errors and 2 warnings remain open.

## Gate interpretation

This proves that the current source snapshot restores, builds, and tests in separate Linux ARM64 environments without workstation dependency/build caches. It also provides evidence that the codebase is portable enough to compile and test on a second OS/architecture.

It does **not** fully satisfy the G0 clean-checkout check because:

- the roadmap and supporting changes are not yet committed and therefore were transferred as a worktree snapshot rather than checked out from an immutable commit;
- the production deployment target is Windows x64;
- installer, Windows Service, firewall, permissions, device-driver, and native protocol behavior were not exercised.

G0 still requires a clean checkout of the accepted commit on a supported Windows x64 environment.

