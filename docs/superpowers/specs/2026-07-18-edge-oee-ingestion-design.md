# Edge OEE Ingestion — Design Spec

**Date:** 2026-07-18
**Status:** Approved design, pending implementation plan
**Contract:** `know-how/cloud_oee_ingestion.md` (authoritative, v1 — live on the cloud API)

---

## 1. Goal & scope

Implement the Edge OEE Ingestion Contract in Pulse Edge: per-machine **channels** are declared to the cloud (`POST /edge/oee/channels`), and the edge reports **state transitions** and **periodic syncs** with cumulative counters (`POST /edge/oee/events`) through a durable outbox with per-channel monotonic sequence numbers.

In the same slice, the existing **event subsystem is removed entirely** — it is confirmed dead (the only producer, `QueueStorageService.EnqueueEventAsync`, has zero callers; the cloud send is a mock). Its UI surface (Buffer tab panel, dashboard count) is repurposed for the OEE outbox.

Out of scope (contract §7): `type: "job"` messages, additional capabilities. Out of scope for this slice: cloud-side anything (already live), OEE dashboards/analytics on the edge.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Channel configuration model | New dedicated `OeeChannel` entity with tag-role bindings to existing `DataPoint`s |
| Signal acquisition | Tap live poller readings in-process (no double polling, no DB polling) |
| Old event subsystem | Remove entirely; repurpose Buffer-tab panel + dashboard count for the OEE outbox |
| UI scope | Full commissioning UI tab (channel CRUD + tag-role binding + live state + outbox status) |
| State derivation | Simple fixed rules: run tag nonzero = running; optional fault tag nonzero = fault (wins); optional code tag passthrough (≤64 chars); per-channel debounce (default 2 s) |
| Delivery architecture | **Approach A** — dedicated `OeeSyncService` background loop, independent of the telemetry `SyncService`, so OEE liveness is never starved by telemetry backlogs and the contract's exponential backoff (5 s → 5 min) can be implemented without touching the telemetry path |

---

## 2. Data model & storage (`Pulse.Edge.Storage`)

Two new durable tables, created via the existing idempotent `CREATE TABLE IF NOT EXISTS` pattern in `QueueStorageService.InitializeAsync()`. **Never dropped on boot** (the drop-and-recreate treatment of `QueueTelemetry` explicitly does not apply — the outbox is the durability boundary).

### `OeeChannel`

| Column | Type | Notes |
|---|---|---|
| `Id` | int PK | |
| `ExternalId` | string, unique, required | Contract identity. **Immutable after creation** — the API rejects updates to it. |
| `Name` | string, required | May change; re-declaration updates the cloud. |
| `Enabled` | bool | Disabled channels are not declared and emit nothing. |
| `RunDataPointId` | int FK, required | Nonzero value ⇒ candidate `running`. |
| `FaultDataPointId` | int FK, nullable | Nonzero ⇒ candidate `fault`; fault wins over running. Unbound ⇒ channel can never emit `fault` (contract §3.4: never infer faults). |
| `CodeDataPointId` | int FK, nullable | Value stringified and passed through verbatim, truncated to 64 chars. |
| `GoodDataPointId` | int FK, nullable | Cumulative totalizer. Binding it derives the `counters` capability — no separate flag to drift. |
| `RejectDataPointId` | int FK, nullable | Only meaningful if `Good` is bound. |
| `DebounceSeconds` | int, default 2 | Per-channel debounce window. |
| `NextSeq` | long, default 0 | Persistent per-channel sequence counter. |

### `OeeOutboxMessage`

| Column | Type | Notes |
|---|---|---|
| `Id` | int PK autoincrement | Drain order (insertion order preserves per-channel seq order). |
| `ChannelId` | int FK | |
| `Seq` | long | Unique index `(ChannelId, Seq)` — mirrors the cloud dedup key. |
| `Type` | string | `state` \| `sync`. |
| `Ts` | UTC datetime | Observation time (first-observed time of the debounced candidate state). |
| `State` | string | `running` \| `stopped` \| `fault`. |
| `Code` | string ≤64, nullable | |
| `GoodCount` / `RejectCount` | long, nullable | Null ⇒ `counters` omitted on that message. |
| `IsSending` | bool | In-flight lock, same pattern as the telemetry queue; reset on startup. |
| `RetryCount` | int | Diagnostic only. |
| `CreatedAt` | UTC datetime | |

### Sequence atomicity

Message emission inserts the outbox row and increments `OeeChannel.NextSeq` **in one SQLite transaction**. SQLite's single-writer model makes assign-and-persist atomic: a seq can never be handed out twice, and a crash cannot fall between assignment and persistence. (Analogy: a retentive PLC counter — the value lives in durable store, not process memory.)

### Disk safety valve

Rows leave the outbox only on `202` acknowledgment, but a hard cap of **100,000 rows** (≈69 days of 1/min syncs for one channel) protects the disk during a months-long cloud outage: oldest non-in-flight rows are pruned first and a `DiagnosticEvent` (`OEE_DATA_LOSS`, throttled) is recorded — mirroring the telemetry `BUFFER_DATA_LOSS` policy but sized far larger because replay matters more here.

---

## 3. State engine & observation (`Pulse.Edge.Agent`)

**`OeeStateEngine`** — singleton, registered in both hosting modes (SinglePort: API process; MultiPort: Agent process — same conditional registration blocks as the existing services in both `Program.cs` files). It is the contract's "dumb, reliable observer": readings in, outbox messages out, no network access, no business logic beyond the fixed derivation rules.

### Reading tap

New singleton interface **`ITagReadingSink`** with `OnReadings(adapterId, IReadOnlyList<TagReading> readings)`. Each driver poller calls it with the same per-scan batch it already passes to `EnqueueTelemetryBatchAsync`. The engine ignores readings for unbound DataPoints. Full scan-rate freshness, zero extra device traffic, and the poller remains sole owner of the connection.

> **Implementation must verify:** pollers currently skip tags whose data source is disabled/unbound (`IsDataSourceEnabledAsync` gating). An OEE-bound DataPoint must be polled and delivered to the sink **even if it is not mapped to any telemetry stream** — OEE binding counts as "in use."

### Derivation rules (fixed, v1)

1. Run tag nonzero ⇒ candidate `running`, else `stopped`.
2. Fault tag bound and nonzero ⇒ candidate `fault` (beats running).
3. Bad reading quality (comms lost, driver error) ⇒ candidate state **unchanged** — a dead cable is not a machine stop. The engine simply stops emitting; the cloud's ~180 s liveness rule records honest no-data time.

### Debounce

On-delay-timer semantics: a candidate state must persist for `DebounceSeconds` before the transition is accepted. Emitted `ts` = the time the candidate was **first observed** (not when debounce expired), keeping interval boundaries honest.

### Emission

- **Accepted transition** ⇒ `state` message, with `good`/`reject` captured from the *same scan* (exact per-interval count attribution). If the counter read failed on that scan, omit `counters` rather than send stale/zero values (contract §3.6).
- **Every 60 s per channel** ⇒ `sync` with current state and, for counter-capable channels, the most recent successfully-read counter values (omitted if the latest read failed). Also immediately at engine start (boot sync — repairs intervals spanning a restart).
- All messages go to the outbox unconditionally; during an outage they accumulate and replay (contract §8 worked scenario). The 60 s cadence continuing into the outbox during an outage is what makes explicit "reconnect syncs" unnecessary — the replayed backlog always ends with a recent sync.

---

## 4. Delivery — `OeeSyncService` (`Pulse.Edge.Cloud` + registration in both hosts)

A dedicated `BackgroundService` owning the entire OEE network path. Deliberately independent of the telemetry `SyncService` (fixed 3 s retry, shared pacing) so a telemetry backlog can never starve OEE liveness against the cloud's 180 s no-data rule.

### Preconditions

Each iteration reads `DeviceConfig`: missing `ApiKey` or sync disabled ⇒ idle. Onboarding/claiming stays owned by `CloudProvisioningService`; this service never acquires credentials.

### Declaration before events (contract §2)

On every service start (⇒ every boot), and whenever channel config changes, POST all enabled channels (`externalId`, `name`, derived `capabilities`) to `/edge/oee/channels`. Event sending begins only after a `201`. Config-change detection: a dirty flag set by the channel CRUD endpoints (same spirit as `EdgeConfigMonitor` change events). Re-declaration is idempotent, so over-declaring is harmless.

### Drain loop (contract §3–4)

Read up to **1000** outbox rows ordered by `Id`, mark `IsSending`, POST to `/edge/oee/events`. On `202`:

- **accepted** (incl. duplicates) ⇒ delete rows — the only way a message leaves the outbox.
- **rejected `"invalid message"`** ⇒ terminal: delete the row, record a `DiagnosticEvent` (edge bug signal; retry can never succeed).
- **rejected `"unknown channel"`** ⇒ clear `IsSending`, set re-declare flag, retry after declaring.

### Failure handling (contract §1, §4)

| Response | Action |
|---|---|
| `503` / network / timeout / other non-2xx | Keep whole batch (`IsSending` reset); **exponential backoff 5 s → 5 min cap**, reset on success. Replay is always safe (dedup on `(channel, seq)`). |
| `400` envelope | Log diagnostic; halve batch size and retry — never retry unchanged. |
| `401` | Stop sending; `CloudStatus = "Revoked"`, same as telemetry loop; provisioning re-enters claim flow. |
| `409` | Stop sending; set `CloudStatus` for UI surfacing — device needs re-pairing. |

### HTTP layer

Two new methods on the existing `CloudClient` — `DeclareOeeChannelsAsync`, `SendOeeEventsBatchAsync` — inheriting centralized URL validation (HTTPS enforcement via `GetUri`/`IsAcceptableCloudEndpoint`), bearer auth, and response classification conventions. Payload shapes exactly per contract §2.1 and §3.2 (camelCase, ISO-8601 UTC with milliseconds).

### Crash safety

Rows stuck `IsSending = 1` after a crash are reset at startup (existing `ResetSendingStatusAsync` pattern); the re-sent batch dedups to a no-op server-side.

---

## 5. API & UI

### API — new `OeeEndpoints` group (`/api/oee/...`), cookie-auth like all others

- **Channel CRUD** — validation: `ExternalId` required, unique, immutable after creation; role bindings must reference existing DataPoints; fault/code/good/reject optional.
- **`GET /api/oee/status`** — per-channel live state (from engine), outbox depth, last ack time, last error.
- **`GET /api/oee/outbox`** — recent outbox rows (replaces `/api/buffer/events`).

### UI — new OEE tab (`Pulse.Edge.UI`, built with the PULSE design system / `pulse` skill)

- Channel list with live state badges (running / stopped / fault / no-data).
- Create/edit modal: externalId, name, tag pickers by role (from existing DataPoints), debounce.
- Outbox/sync status view.
- Buffer tab: the dead "Pending Events" panel becomes the OEE outbox panel; dashboard `pendingEventsCount` becomes the OEE outbox count.

---

## 6. Event subsystem removal

Delete end-to-end (all confirmed dead — no producer exists):

- `Models/QueueEvent.cs`, `DbSet<QueueEvent>`, its DDL block.
- `QueueStorageService`: `EnqueueEventAsync`, `GetPendingEventsBatchAsync`, `CompleteEventsBatchAsync`, `FailEventsBatchAsync`, event branch of `ResetSendingStatusAsync`.
- `SyncService`: the event branch of the sync loop.
- `CloudClient.SendEventsBatchAsync` (mock).
- API: `GET /api/buffer/events`; `DELETE FROM QueueEvents` in `SettingsEndpoints`.
- UI: Pending Events panel in `BufferTab.tsx`, `useBufferStatus` fetch, related types.
- One-time `DROP TABLE IF EXISTS QueueEvents` in `InitializeAsync` — safe: the table is provably always empty.
- `ConfigurationBackupServiceTests` reference to `QueueEvent` updated to use a real table.

---

## 7. Testing

CI gates apply: `--warnaserror`, zero ESLint errors, all suites in `quality.yml`.

- **Unit** — state-derivation truth table (run × fault × quality), debounce timing, seq atomicity across simulated restarts (no reuse, no gaps from crashes), outbox lifecycle (202 / partial-reject / 503 paths), backoff progression, cap pruning + diagnostic.
- **CloudClient** — fake HTTP handler: request shapes vs contract, `202` per-message error parsing, status classification (503/400/401/409).
- **Integration** — SimulatorDriver gains synthetic run/fault/good/reject tags so a full channel commissions with no hardware (doubles as the demo story). End-to-end: simulator → engine → outbox → fake cloud endpoint → ack → empty outbox, plus an outage-and-replay scenario mirroring contract §8 (lost-202 case ⇒ duplicates acknowledged, nothing double-counted).
- **UI** — vitest for the new tab components.

---

## 8. Risks & notes

- **Poller gating** (§3 note): if pollers hard-skip unbound tags, a small change to the gating predicate is required; verify early in implementation.
- **Clock discipline** (contract checklist item 7): `ts` uses system UTC; NTP discipline is a deployment concern, noted in the Windows deployment docs rather than solved here.
- **Roadmap**: this is feature work landing amid the production-readiness mission; it follows the same PR + CI gate discipline (branch, PR, `quality.yml` green, no direct push to `main`).
