# Initial Production-Readiness Baseline — 2026-07-12

This record captures the first evidence collection for the production-readiness roadmap. It is evidence for the current workstation only; it does not prove a clean build on a second environment.

## Environment

- Repository: `pulse-edge`
- Target framework: `.NET 10` (`net10.0`)
- Frontend: React 19, TypeScript 6, Vite 8
- Host filesystem: 228 GiB total, 182 GiB used, 3.6 GiB available, reported at 99% capacity by `df`
- PULSE local data directory: approximately 9.1 MiB in `~/.pulse`

## Backend build

Command:

```sh
dotnet build Pulse.Edge.slnx --no-restore
```

Initial result: **Passed** in 8.52 seconds with 0 warnings and 0 errors after a current package restore/audit.

A later clean rebuild exposed one nullable warning in the bulk-bind query. The query now excludes null metrics explicitly. A subsequent `dotnet clean` and full solution build passed with 0 warnings and 0 errors.

## Backend tests

Command:

```sh
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --no-build --no-restore
```

Initial result: **Passed** — 45 passed, 0 failed, 0 skipped in 1 minute 15 seconds.

After adding isolated backup tests, the full suite passed with **47 passed, 0 failed, and 0 skipped**.

## NuGet vulnerability audit

Command:

```sh
dotnet list Pulse.Edge.slnx package --vulnerable --include-transitive
```

Result: **Passed** — no vulnerable package was reported for any solution project using the current NuGet advisory sources.

The earlier `Microsoft.OpenApi 2.0.0` and `SQLitePCLRaw.lib.e_sqlite3 2.1.11` warnings could not be reproduced after restoring the current dependency graph. Current direct references include `Microsoft.OpenApi 2.7.5` and `SQLitePCLRaw.lib.e_sqlite3 3.53.3`.

## Frontend production build

Command:

```sh
pnpm --filter pulse-edge-ui build
```

Result: **Passed**. TypeScript compilation and Vite production bundling completed.

Open warnings:

- Local font URLs were not resolved during build and are deferred to runtime.
- The main JavaScript chunk is approximately 553 kB before gzip and exceeds Vite's 500 kB warning threshold.

## Frontend lint

Command:

```sh
pnpm --filter pulse-edge-ui lint
```

Result: **Failed** — 50 findings: 48 errors and 2 warnings.

The dominant categories are React hook purity/state-in-effect rules, explicit `any` types, unused variables, empty blocks, and Fast Refresh export rules. This prevents G1 from passing and must be addressed or governed by an explicitly approved lint baseline.

## Gate implications

- G0 automated-test check: evidence supports passing this individual check.
- G0 clean second-environment check: not tested.
- G1 clean backend build: current workstation passes.
- G1 frontend pipeline: production build passes, lint fails; gate remains open.
- G1 vulnerability check: current NuGet graph passes; frontend dependency audit and automated CI scan remain to be added.
- R-001 disk pressure: confirmed at host level. PULSE data is currently small, so immediate host cleanup is operationally necessary while product-level thresholds and retention remain roadmap work.
- R-002 vulnerable NuGet dependencies: closed for the current dependency graph, subject to continuous scanning in CI.

A later repeatable snapshot recorded approximately 12.6 GiB available at 94% filesystem capacity. See [the local operational baseline](2026-07-12-local-operational-baseline.md). R-001 is therefore mitigated but remains under monitoring.

## Backup implementation audit

The configuration backup implementation was inspected without applying a restore to the live node.

Observed safeguards:

- Export is restricted to the Admin role.
- The document has a fixed format name and format version.
- Inspection verifies a SHA-256 checksum using fixed-time comparison.
- Inspection checks duplicate IDs and adapter, stream, and MQTT-device references.
- Restore replaces configuration inside a database transaction.
- Device identity, cloud pairing, users, queues, and history are outside the portable payload.

Open evidence and limitations at the time of the audit:

- The payload includes adapter `ConfigJson` and may therefore contain plaintext protocol credentials.
- Only the current backup format version is accepted; cross-version migration is not demonstrated.

## Disposable backup round trip

Two automated tests now run against a unique temporary SQLite database rather than `~/.pulse/edge.db`:

1. A fixture containing node identity, an adapter, stream, MQTT device, tag, template, local user, telemetry queue record, and event queue record is exported and inspected.
2. Portable configuration is deliberately replaced, node identity is changed after export, and the backup is restored.
3. The test verifies the original adapter, stream, device, tag, and template return while the post-export API key, local user, telemetry queue, and event queue remain preserved.
4. A second test changes the checksum and verifies inspection rejects the document.

Focused result: **2 passed, 0 failed**.  
Full-suite result: **47 passed, 0 failed, 0 skipped**.

Supporting changes make `QueueDbContext` accept an explicit database path and allow `ConfigurationBackupService` to receive a context factory. Production callers continue to use the existing parameterless behavior.

The pre-existing power-meter database test was also moved to a unique temporary database. A repository search confirms the database-using tests now pass an isolated path, so running the suite does not open or mutate the active `~/.pulse/edge.db`.

This proves the core current-version backup/restore semantics on a disposable fixture. Browser download behavior, endpoint authorization, acquisition restart, and cross-version migration remain separate future evidence.
