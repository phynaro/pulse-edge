# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with me (how to communicate)

My background is Electrical / Automation Engineering, and I am transitioning into full-stack software development. I know the domain (PLCs, protocols, industrial systems) deeply, and I understand most of this project's web/.NET stack — but I am not yet fluent in it, so treat me as a capable learner, not a senior web developer.

When you explain things:

- **Spell out the reasoning, don't just name it.** Instead of "it's a race condition, add a mutex," say what two things are happening at the same time, why that causes the bug, and what the fix actually does. Avoid dropping a jargon term as if it's self-explanatory.
- **Expand acronyms and web/.NET idioms the first time** they come up in a discussion (e.g. DI, middleware, hydration, CORS, tree-shaking, WAL). One short clause is enough — "CORS (the browser rule that blocks a page from calling a different origin)".
- **Prefer a plain sentence over a terse senior-dev shorthand.** If a phrase only makes sense to someone who already knows the pattern, rewrite it so it lands at a glance.
- **Connect new web concepts to things I already know** from automation/embedded work when a fair analogy exists — it helps me anchor them.
- **Don't over-explain the industrial/domain side.** I know that part; keep the teaching focused on the software stack, tooling, and web patterns.
- I would rather understand *why* than just be handed a command. When you suggest a fix or a tool, include the one-line reason it's the right call.

This is about clarity, not hand-holding — keep the engineering rigor, just make the software-side explanations legible to someone still building fluency.

## What this repository is

**PULSE Edge** is the on-premise industrial edge appliance for the PULSE platform (Integra Innovation). It runs on a plant-floor machine, polls industrial devices (PLCs, meters, gateways) over multiple protocols, buffers telemetry locally in SQLite, and forwards it to PULSE Cloud with store-and-forward reliability. A local web UI handles commissioning, data binding, and diagnostics.

This is a **.NET 10 solution** (`Pulse.Edge.slnx`) plus a **React/Vite UI** in a pnpm workspace. It is a separate product from the PULSE cloud monorepo described in `GEMINI.md` — that file documents the cloud platform (Fastify/Postgres/InfluxDB) and is **not** the architecture of this repo. Ignore it for edge work.

The active mission right now is production hardening tracked in `docs/PULSE_Edge_Production_Readiness_Roadmap.md` — see "Production readiness" below.

## Commands

The whole stack (backend build + API + Agent + Vite UI) starts with one script:

```bash
./start-edge.sh            # builds, starts unified server on :5288, UI dev server on :8080
```

### Backend (.NET, run from repo root)

```bash
dotnet restore Pulse.Edge.slnx --locked-mode        # CI uses --locked-mode; lockfiles are committed
dotnet build   Pulse.Edge.slnx --warnaserror        # CI builds warnings-as-errors — keep it clean
dotnet test    src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj
dotnet test    src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~QueueStorageServiceTests   # single test class
dotnet list Pulse.Edge.slnx package --vulnerable --include-transitive   # NuGet audit (CI gate)
```

The .NET SDK is pinned in `global.json` (10.0.300) and every project uses a committed `packages.lock.json` with `RestorePackagesWithLockFile`. After changing package versions you must restore to regenerate the lockfile, or `--locked-mode` restore fails in CI.

### Frontend (from repo root — pnpm workspace)

```bash
pnpm build:ui      # tsc -b && vite build  (also: pnpm --filter pulse-edge-ui build)
pnpm lint:ui       # eslint (CI gate — zero errors required)
pnpm test:ui       # vitest run
pnpm --filter pulse-edge-ui test -- <file>   # single vitest file
```

Node is pinned `>=26.5.0 <27` (`.node-version`), pnpm `11.5.0`.

### Production build & packaging

```bash
./build.sh                 # builds UI → copies into API wwwroot → dotnet publish self-contained per-RID into dist/
```

`build.sh` is the source of truth for how the UI gets embedded (see hosting note below). Installers: `PulseEdge.iss` (Inno Setup, Windows), `PulseEdge.wxs` (WiX/MSI), `build-deb.sh` (Debian).

`deploy-staging.sh` / `deploy-edge.sh` push build artifacts to MinIO (`.env` holds `MINIO_*` credentials) for on-site staging. This is a **direct-from-local-machine** path, deliberately **not** driven by CI — use it to build and publish to a staging site by hand; CI (`quality.yml`) only validates, it does not deploy.

> Note when packaging from macOS: a plain `tar`/`zip` emits AppleDouble `._*` files that break C# compilation on Linux. Use `COPYFILE_DISABLE=1` (roadmap risk R-005).

## Architecture

### Two executables, two hosting modes

There are two entry points that both register the **same** protocol drivers and services:

- **`Pulse.Edge.Api`** — ASP.NET Core Kestrel server (Minimal APIs). Binds `http://*:5288` (`serverUrl` config override). Serves the REST API, and in single-port mode also serves the UI and hosts the acquisition Worker.
- **`Pulse.Edge.Agent`** — a `Host` worker process (the acquisition engine on its own).

`hostingMode` in `appsettings.json` selects the topology (`Program.cs` in both projects branches on it):

- **`SinglePort`** (default, production): the **API process hosts everything** — it registers `EdgeConfigMonitor`, `CloudProvisioningService`, and the `Worker` as hosted services *inside itself*, and serves the React UI from an embedded resource (`ManifestEmbeddedFileProvider`, `wwwroot`) via `UseStaticFiles` + `MapFallbackToFile("index.html")`. One TCP port (5288) is the entire external surface. This is the target set by `docs/PULSE_Edge_single_port_migration.md`.
- **`MultiPort`** (dev convenience): API and Agent run as **separate** `dotnet run` processes; the Agent owns acquisition and forwards its logs to the API's diagnostics pipeline via `DiagnosticCaptureMonitor` / `DiagnosticForwardingProvider`.

In single-port publish, the UI lives *inside* the API assembly as an embedded resource — `build.sh` copies `Pulse.Edge.UI/dist/` into `src/Pulse.Edge.Api/wwwroot/` before `dotnet publish`. Editing UI source alone won't change a published server; you must rebuild the UI and republish.

### Acquisition pipeline (the hot path)

```
Device ──driver──> DriverPoller ──> QueueStorageService (SQLite) ──> SyncService/CloudClient ──> PULSE Cloud
```

A parallel OEE data plane (OeeStateEngine → OeeOutboxMessages → OeeSyncService → POST /edge/oee/*) reports per-machine state transitions and counters with per-channel sequence numbers — contract: know-how/cloud_oee_ingestion.md; it deliberately bypasses /edge/telemetry.

- **Protocol drivers** — one project per protocol: `Protocols.OpcUa`, `.Modbus`, `.MqttProtocol`, `.LibPlcTag` (EtherNet/IP), `.S7Net` (Siemens S7), `.RestApi`, `.Bacnet`, plus the built-in `SimulatorDriver`. The **Simulator is a shipped, first-class driver** (not just a test fixture) — it generates synthetic tag data for demos, commissioning without hardware, and pre-deployment validation; keep it in production builds. All drivers implement `IProtocolDriver` and are registered **Transient** so each adapter instance gets an isolated connection.
- **DriverPollers** (`Agent/Drivers/*Poller.cs`) wrap each driver with polling/scheduling; `DriverPollerRegistry` (singleton) maps adapters to pollers. Polling semantics: `know-how/tag_polling_mechanism.md`.
- **`QueueStorageService`** (`Pulse.Edge.Storage`) — the single SQLite store (EF Core, `QueueDbContext`). Holds queued telemetry, OEE channels + outbox, adapters, data sources, data points, stream templates, local users, audit + diagnostic events. `InitializeAsync()` runs at startup before hosted services to avoid races. This is the durability boundary — Roadmap Phase 4 hardens it (WAL, retention, disk thresholds).
- **`SyncService` + `CloudClient`** (`Pulse.Edge.Cloud`) — store-and-forward delivery to cloud; `CloudProvisioningService` handles pairing/registration.
- **`EdgeConfigMonitor`** — watches local config and reconciles the running adapter/poller set.

### API surface & UI

Endpoints are grouped under `Pulse.Edge.Api/Endpoints/` (Minimal API extension classes): `Adapter`, `Auth`, `Backup`, `Buffer`, `Dashboard`, `DataPoint`, `DataSource`, `DiagnosticLog`, `Oee`, `Settings`. Auth is **local cookie auth** — `PasswordService` + `CurrentUserValidationMiddleware` in `Security/`, backed by the `LocalUser` model (spec: `docs/PULSE_Edge_Local_Authentication_Spec.md`). Logging is Serilog with daily rolling files (30-day / 10 MB retention) plus a `DiagnosticLogService` sink surfaced through the UI.

The UI (`src/Pulse.Edge.UI`, React 19 + Vite + `@pulse/ui` from `packages/pulse-ui`) is the commissioning console: adapter setup, tag/stream binding wizards, dashboard, diagnostics. It uses the **PULSE design system** — invoke the `pulse` skill for any UI work.

### Domain concepts

- **Adapter** = a configured connection to one device (protocol + endpoint + credentials).
- **DataSource / DataPoint** = a device's declared readable points; DataPoints bind to **StreamTemplates** that shape the cloud telemetry payload. Cloud contract: `know-how/cloud_data_source_declaration.md`, `know-how/cloud_telemetry_stream_payload.md`; specs in `docs/PULSE_Edge_Telemetry_API_Spec.md` and `docs/PULSE_Edge_Registration_and_Data_Binding_Flow.md`.
- Per-protocol connection/addressing details live in `know-how/adapters/*.md` — read the relevant one before touching a driver.

## Production readiness (current mission)

`docs/PULSE_Edge_Production_Readiness_Roadmap.md` is the **living, gate-driven** delivery plan (phases G0–G8). Rules that matter when working here:

- It is **evidence-driven**: an acceptance item is checked only after durable evidence (a CI run link, a test report, a repo path) exists under `docs/readiness-evidence/`. Implementation alone does not close a gate. Do not mark gate items complete without attaching evidence.
- **Current state:** G0 (baseline) is *blocked* pending Windows/load validation; G1 (build integrity) is *in progress* — CI hygiene mostly done, with frontend/auth/backup/browser test coverage and release-tag enforcement still open. Keep exactly one phase `In progress`.
- Update the **Follow-up dashboard**, **Gate review log**, and **Decision and risk log** in that doc as part of the work, not as an afterthought.
- The CI workflow (`.github/workflows/quality.yml`) is the enforced gate: backend build/test/audit + frontend lint/build. `main` is branch-protected requiring these checks. Never weaken a check to make it pass.

Supporting specs live in `docs/` (Data Reliability, Diagnostic Logging, Cloud Integration, Windows Deployment, Product Specification); baseline/security context is in `PULSE_Edge_Pilot_*` and `know-how/edge_security_pillars.md`.

## Conventions

- **Warnings are errors.** The build runs `--warnaserror`; don't introduce warnings.
- **Committed lockfiles** for both NuGet (`packages.lock.json`) and pnpm (`pnpm-lock.yaml`). Regenerate via restore/install after dependency changes — never hand-edit.
- Drivers stay **Transient** and self-isolating; shared services (storage, registry, cloud) are **Singleton**.
- SQLite (`edge.db` + `-wal`/`-shm`) is the only local datastore — no server database. It is the durability boundary; treat schema/queue changes with the reliability gates in mind.
- Don't push to `main`; it's protected. Branch, PR, let CI pass.
