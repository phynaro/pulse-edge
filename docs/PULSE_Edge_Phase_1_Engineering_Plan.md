# PULSE Edge Phase 1 Engineering Plan

**Status:** In progress by explicit sequencing exception
**Roadmap:** Phase 1 / Gate G1  
**Last reviewed:** 2026-07-12

## Objective

Make every accepted change reproducibly buildable, testable, auditable, and traceable to a versioned artifact. G1 remains closed until all required jobs are green and enforced; a workflow that merely exists is not sufficient.

## Current evidence

### Backend

- Clean solution build: 0 warnings, 0 errors.
- Automated tests: 47 passed, 0 failed, 0 skipped.
- NuGet vulnerability audit: no vulnerable direct or transitive package reported by current sources.
- Database-using tests now use isolated temporary SQLite files.
- A blocking repository quality workflow is implemented; its first hosted run is pending.
- The repository pins the .NET SDK and restores from committed NuGet lock files.
- A manual Linux ARM64 clean-room restore/build/test passes, providing a working reference for CI.

### Frontend

- TypeScript and Vite production build passes.
- No frontend unit or browser test file is currently present.
- The repository pins Node and pnpm runtimes.
- The pnpm lockfile is present and uses lockfile version 9.
- A manual Node 26 ARM64 clean-room frozen install and production build passes.
- Lint passes with zero errors and zero warnings.

Remediated lint baseline by rule:

| Rule | Errors | Warnings | Total |
|---|---:|---:|---:|
| `react-hooks/set-state-in-effect` | 15 | 0 | 15 |
| `@typescript-eslint/no-explicit-any` | 12 | 0 | 12 |
| `@typescript-eslint/no-unused-vars` | 5 | 0 | 5 |
| `react-refresh/only-export-components` | 5 | 0 | 5 |
| `no-empty` | 4 | 0 | 4 |
| `react-hooks/preserve-manual-memoization` | 3 | 0 | 3 |
| `react-hooks/purity` | 2 | 0 | 2 |
| `react-hooks/exhaustive-deps` | 0 | 2 | 2 |
| `no-useless-assignment` | 1 | 0 | 1 |
| `prefer-const` | 1 | 0 | 1 |

## Execution sequence

### Batch 1 — Reproducible toolchain

- [x] Add `global.json` for the accepted .NET 10 SDK feature band and roll-forward policy.
- [x] Add a Node version file matching the runtime used to validate Vite 8 and TypeScript 6.
- [x] Record the required pnpm major version using Corepack/project metadata.
- [ ] Document clean bootstrap commands for Windows and CI.
- [x] Prove dependency installation uses the lockfile without modification.
- [ ] Ensure source packaging excludes macOS AppleDouble files and extended-attribute metadata.

**Acceptance:** Two clean environments use the same SDK/runtime families and produce equivalent build/test results.

### Batch 2 — Lint debt removal

Fix behavior-affecting findings before mechanical typing/style findings.

1. **React state/effect behavior** — resolve 15 `set-state-in-effect`, 3 memoization, 2 purity, and 2 dependency findings through derived state, event-driven resets, stable callbacks, and explicit clock state. Do not silence these rules globally.
2. **Type boundaries** — replace 12 explicit `any` occurrences with component, icon, error, payload, and adapter configuration types.
3. **Module boundaries** — split five non-component exports from Fast Refresh component modules.
4. **Mechanical cleanup** — remove unused variables, empty catches, useless assignment, and mutable binding.
5. Run the production build after every behavior-affecting batch.

**Acceptance:** `pnpm --filter pulse-edge-ui lint` returns zero errors and zero unaccepted warnings; `pnpm --filter pulse-edge-ui build` still passes.

**Result:** Complete. Evidence: [Phase 1 engineering slice](readiness-evidence/2026-07-12-phase-1-engineering-slice.md).

### Batch 3 — Automated frontend coverage

- [ ] Add a unit/component test runner compatible with the accepted React/Vite toolchain.
- [ ] Cover dashboard health classification and formatting utilities.
- [ ] Cover authentication state and Admin/ReadOnly rendering boundaries.
- [ ] Cover configuration backup inspection messaging without applying a live restore.
- [ ] Add Playwright smoke coverage for login, navigation, and the read-only dashboard.
- [ ] Add a disposable-node E2E path for onboarding and configuration backup/restore.

**Acceptance:** Tests run headlessly and never depend on or mutate the developer's `~/.pulse/edge.db`.

### Batch 4 — CI workflow

Required pull-request jobs:

1. **Backend build and test**
   - Restore from lock-aware project inputs.
   - Clean build with warnings treated according to the approved warning policy.
   - Run all backend tests and publish test results/coverage.
2. **Frontend quality**
   - Frozen pnpm install.
   - Lint.
   - TypeScript/Vite production build.
   - Unit/component tests.
3. **Security and supply chain**
   - NuGet direct/transitive vulnerability audit.
   - Node production dependency audit with an explicit severity policy.
   - Secret scan.
   - License-policy check.
4. **Browser smoke**
   - Start an isolated test node.
   - Run Playwright smoke tests.
   - Upload traces/screenshots only on failure, with secret-safe fixtures.

**Acceptance:** Every job is deterministic, required, and fails the pull request when its policy is violated. Temporary `continue-on-error` jobs do not satisfy G1.

### Batch 5 — Versioned artifacts and SBOM

- [ ] Derive version metadata from the release tag plus commit.
- [ ] Embed version, commit, build date, and schema version in the service and UI diagnostics.
- [ ] Publish immutable checksummed artifacts.
- [ ] Generate CycloneDX or SPDX SBOMs for .NET and frontend dependencies.
- [ ] Archive test, audit, SBOM, and checksum evidence with the artifact.

**Acceptance:** A downloaded artifact can be mapped back to its source commit, dependency inventory, checks, and release decision.

### Batch 6 — Enforcement

- [ ] Protect the main branch.
- [ ] Require G1 jobs before merge.
- [ ] Require review for workflow, dependency, and release configuration changes.
- [ ] Document emergency exception authority, expiry, and retrospective review.
- [ ] Prove a deliberately failing check prevents merge/release in a test branch.

**Acceptance:** Required checks cannot be bypassed through the ordinary merge path.

## Proposed CI evidence package

Store or link the following from the G1 section of the roadmap:

- Clean bootstrap record from two environments
- Successful CI run URL and commit
- Backend and frontend test reports
- Vulnerability, secret, and license scan results
- Artifact checksums
- .NET and frontend SBOMs
- Branch protection evidence
- Deliberate-failure enforcement test

## Risks and decisions

- Fixing React effect findings may change timing or state-reset behavior; each affected flow needs a targeted interaction check.
- Adding frontend tests without isolated backend data would repeat the database-safety issue already removed from backend tests.
- Runtime pinning values require approval against the Windows installer/runtime strategy; local versions are evidence, not automatically the production selection.
- Dependency audit severity and exception expiry must be explicit. “Audit ran” is not equivalent to “risk accepted.”

## Exit criteria

Phase 1 may move to `Gate review` only when all six batches are complete and linked evidence exists. G1 may move to `Passed` only after an authorized reviewer approves every applicable roadmap gate check.
