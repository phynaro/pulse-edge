# Scenario Simulator Implementation Plan (Integra Dairy, plan 1 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scenario-driven simulator mode to PULSE Edge that makes a whole factory (first scenario: the Integra Dairy processed-cheese plant) stream realistic, independent, restart-stable machine, process and energy data, with named events a presenter can trigger.

**Architecture:** A new `Simulation/` folder in `Pulse.Edge.Agent` holds a pure, deterministic engine: machine states come from a seeded per-unit/per-hour random model (no replay, no process hash codes); counters, analog values and meters integrate over time; state persists to a JSON file in the edge data directory. The existing `SIMULATOR` protocol gets a third template, `scenario`, whose tag addresses are `<unitId>.<signal>`. Events are requested through a small REST API that writes a request file the engine picks up, so it works in both hosting modes (single-port and split Agent/API).

**Tech Stack:** .NET 10 (SDK 10.0.300), xUnit 2.9, ASP.NET Core Minimal APIs, React/Vite UI (pnpm, vitest), System.Text.Json (no new NuGet packages).

**Spec:** `D:\pulse-project\docs\superpowers\specs\2026-10-21-integra-dairy-demo-design.md` (§4 plant, §6 Part A).

**The five plans** (each a separate document, written when its predecessor lands):
1. **This plan:** scenario simulator (pulse-edge).
2. Setup script for the Integra Dairy org (pulse-project `scripts/demo/integra-dairy/`).
3. Edge on the spare VPS: Linux service, own Cloudflare tunnel + Access, health check; then day 0 and accumulation.
4. Marketing plan re-cast + Claims Register refresh (`docs/marketing/video-series-plan.md`).
5. Manual re-shoot on Integra Dairy (pulse-site).

## Global Constraints

- `dotnet build Pulse.Edge.slnx --warnaserror` stays clean; `dotnet restore --locked-mode` must pass, so **no new NuGet packages**.
- The existing `energy` and `production` templates behave exactly as today (`SimulatorDriverOeeTests` stays green).
- **No `GetHashCode()` for seeds.** It differs per .NET process. Use the stable FNV-1a hash (Task 1).
- Scenario time is computed in the scenario's UTC offset (`+07:00` for Integra Dairy), so shift schedules don't depend on the host's timezone.
- Non-GET API calls already require the Admin role (`CurrentUserValidationMiddleware`); new endpoints rely on that, not on custom checks.
- UI copy in both `en` and `th` (the UI's i18n folder `src/Pulse.Edge.UI/src/i18n`).
- Unit and signal ids are lowercase `[a-z0-9_]+`. Unit ids mirror the spec's location codes (`HTST-1` → `htst1`).

## Review Focus

1. **Restart mid-run:** after a process restart, counters continue from where they were (never jump back) and machine states at a given wall time are identical to before the restart.
2. **Host down for an hour, then back:** totalizers (kWh, good/reject) advance by what the model says was produced in the gap, never by more than the model's own rate (no huge single-sample spike, no negative delta).
3. **A tag address that doesn't exist in the scenario** (typo while binding) must show as a failed read (quality not `Good`), not a silent 0.
4. **Event triggered twice, or while already active:** it extends to one active window; it never stacks two overlapping effects (no double temperature drop).
5. **Two machines of the same kind** (`iws1`, `iws2`) must not fault at the same moments; a reviewer opening both trends side by side sees independent stops.

---

### Task 1: Stable randomness

**Files:**
- Create: `src/Pulse.Edge.Agent/Simulation/StableRandom.cs`
- Test: `src/Pulse.Edge.Tests/Simulation/StableRandomTests.cs`

**Interfaces:**
- Produces:
  - `public static ulong StableRandom.Hash(string key)`: FNV-1a 64-bit over UTF-8.
  - `public sealed class StableRandom(ulong seed)`: SplitMix64.
    - `public double NextDouble()` returns a value in [0,1).
    - `public double NextExponential(double mean)`.
    - `public double NextNormal(double mean, double sd)` (Box-Muller).
  - `public static StableRandom StableRandom.For(params string[] parts)`: seed = `Hash(string.Join("|", parts))`.

- [ ] **Step 1: Write the failing tests**
  - `Hash_IsStableAcrossCalls`: `Hash("iws1|2026-10-21T10")` equals a hard-coded value computed once (FNV-1a 64 offset `14695981039346656037`, prime `1099511628211`).
  - `For_SameParts_SameSequence`: two instances from `For("iws1","10")` yield the same first 5 `NextDouble()` values.
  - `For_DifferentParts_DifferentSequence`: `For("iws1","10")` and `For("iws2","10")` differ on the first value.
  - `NextDouble_InRange`: 10,000 draws all in [0,1).
- [ ] **Step 2: Run, expect FAIL.** `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~StableRandomTests`
- [ ] **Step 3: Implement** `StableRandom` as specified.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(simulator): stable seeded randomness`

### Task 2: Scenario model and catalog (with the Integra Dairy scenario)

**Files:**
- Create: `src/Pulse.Edge.Agent/Simulation/ScenarioModel.cs`, `src/Pulse.Edge.Agent/Simulation/ScenarioCatalog.cs`, `src/Pulse.Edge.Agent/Simulation/Scenarios/integra-dairy.json` (EmbeddedResource in `Pulse.Edge.Agent.csproj`)
- Test: `src/Pulse.Edge.Tests/Simulation/ScenarioCatalogTests.cs`

**Interfaces:**
- Produces (records, System.Text.Json camelCase):
  - `ScenarioDefinition(string Id, string Name, string UtcOffset, ShiftCalendar Shifts, IReadOnlyList<UnitDefinition> Units, IReadOnlyList<EventDefinition> Events)`
  - `ShiftCalendar(IReadOnlyList<ShiftWindow> Windows)`
  - `ShiftWindow(int[] Weekdays /*0=Sun*/, string Start /*"HH:mm"*/, string End)`
  - `UnitDefinition(string Id, string Kind /*machine|analog|meter|ambient*/, MachineParams? Machine, AnalogParams? Analog, MeterParams? Meter, AmbientParams? Ambient)`
  - `AmbientParams(double Center, double Amplitude, double PeriodMinutes, double NoiseSd, string? FollowsUnit, double? StoppedValue, string Unit)`: a value that only drifts gently around `Center` (sine of `Amplitude` with a per-unit phase from `StableRandom` + small noise), never an abnormal value, never targeted by events. With `FollowsUnit` it sits at `StoppedValue` while that machine isn't Running (e.g. motor current 0 A when stopped).
  - `MachineParams(double RatePerMin, double RejectFraction, double MtbfMinutes, double MttrMinutes, double MicroStopsPerHour, int[] FaultCodes, bool FollowsShifts, double RunningKw, double IdleKw)`
  - `AnalogParams(double Setpoint, double TauSeconds, double NoiseSd, string? FollowsUnit, double? StoppedValue, string Unit)`
  - `MeterParams(double BaseKw, string[] Feeds, double PfAtFullLoad, double PfAtLowLoad, double StartKwh)`
  - `EventDefinition(string Id, string Unit, string Effect /*force_fault|offset|ramp*/, double Magnitude, int DurationMinutes, int? FaultCode, double DailyProbability)`
  - `public static class ScenarioCatalog`:
    - `IReadOnlyList<string> Ids()`
    - `ScenarioDefinition Load(string id)`, which throws `KeyNotFoundException`.
    - `IEnumerable<string> SignalsOf(UnitDefinition u)`:
      - machine: `state, fault, fault_code, good_count, reject_count, speed`
      - analog and ambient: `value`
      - meter: `kw, kwh, pf`

**Integra Dairy content** (in the JSON; values from spec §4, realistic mid-size plant):
- `utcOffset` `+07:00`.
- **Shifts:** Mon–Sat `06:00–14:00`, `14:00–22:00`. Sunday and nights are planned stops for `followsShifts` machines.
- **Machines:**
  - `sep1`, `htst1`, `vat1`, `vat2`, `prs1`, `grd1`, `bld1`, `ckr1`, `cip1`, `fw1`, `fw2`, `cw1`, `cw2`, `md1`, `md2`, `ce1`, `cp1`, `pal1`.
  - `iws1` and `iws2`: rate 420 slices/min, reject 0.015, MTBF 180 min, MTTR 12 min, 4 micro-stops/h, fault codes `[11 film jam, 12 seal temp, 13 cutter]`.
  - Utilities `blr1`, `nh3_1`, `chl1`, `ac1`, `wwt1`: machines with `followsShifts: false`.
- **Analogs:**
  - Temperatures:
    - `silo1_temp` / `silo2_temp`: 4 °C.
    - `htst1_outlet`: 73.0, tau 60 s, sd 0.15, follows `htst1`.
    - `ckr1_temp`: 85; `hld1_temp`: 82; `cold1_temp`: 4.0, tau 900 s.
    - `chl1_glycol`: −2.
  - Pressures: `blr1_pressure` 8.0 bar; `ac1_pressure` 7.0 bar.
  - Flow: `wwt1_flow` m³/h.
- **Meters:**
  - `m_main`: feeds every machine, base 60 kW.
  - `m_boiler`: feeds `blr1`.
  - `m_refrig`: feeds `nh3_1` and `chl1`.
  - `m_iws1`: feeds `iws1`, `fw1`, `cw1`, `md1`.
  - `m_iws2`: likewise for line 2.
  - `m_air`: feeds `ac1`.
  - Typical plant demand a few hundred kW.
- **Ambient "alive everywhere" signals** (owner, 2026-10-21: almost every place shows a live value, just a small wobble, no abnormal events). Roughly 60–80 units:
  - *Every machine* gets `<machine>_motor_current` (A, follows the machine, 0 when stopped) and `<machine>_vibration` (mm/s, 1.0–2.5, follows the machine).
  - *Rooms/areas:*
    - temperature + humidity for milk reception, cheese making, processed cheese, slicing & packing, warehouse dock and QA lab;
    - `rip1_temp` 12 °C / `rip1_rh` 85% (ripening room).
  - *Tanks and levels:*
    - `silo1_level` / `silo2_level` (%), slow drift;
    - `whey_tank_level`, `cip1_tank_temp`, `cip1_conductivity`, `hld1_level`.
  - *Utilities:*
    - `blr1_feedwater_temp`, `blr1_steam_flow`, `ac1_flow`, `nh3_1_suction_pressure`, `chl1_flow`;
    - `wwt1_ph` (6.8–7.4), `wwt1_level`;
    - `water_main_flow`.
  - *Electrical:* `<meter>_voltage` (~400 V three-phase) and `<meter>_current` per energy meter.
  - Names follow the location codes in spec §4.2 so the setup script (plan 2) can bind each one to the matching asset or location.
- **Events** (daily probability 0.3–0.6):
  - `htst_temp_drop`: `htst1_outlet` offset −3.5 for 8 min.
  - `iws1_film_jam`: force fault code 11 on `iws1` for 15 min.
  - `cold_store_drift`: `cold1_temp` ramp +6 over 90 min.
  - `boiler_trip`: force fault on `blr1` for 20 min.
  - `air_leak`: `ac1_pressure` offset −1.2 for 45 min.

- [ ] **Step 1: Write the failing tests**
  - `Catalog_ContainsIntegraDairy`: `Ids()` contains `"integra-dairy"`.
  - `IntegraDairy_UnitIdsUnique_AndValid`: every id matches `^[a-z0-9_]+$` and is unique.
  - `IntegraDairy_MeterFeedsReferToMachines`: every `Feeds` entry is a machine unit id.
  - `IntegraDairy_EventsReferToUnits`: every event's `Unit` exists; `force_fault` targets a machine; **no event targets an `ambient` unit**.
  - `IntegraDairy_EveryMachineHasAmbientMotorSignals`: for every machine unit `m`, units `m_motor_current` and `m_vibration` exist and follow `m`.
  - `IntegraDairy_HasAtLeast60AmbientUnits`.
  - `Load_Unknown_Throws`: `Load("nope")` throws `KeyNotFoundException`.
- [ ] **Step 2: Run, expect FAIL.** `--filter FullyQualifiedName~ScenarioCatalogTests`
- [ ] **Step 3: Implement the records, the catalog** (reads embedded resources named `*.Simulation.Scenarios.<id>.json`) **and the JSON.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(simulator): scenario model and Integra Dairy scenario`

### Task 3: Machine state model (deterministic, independent, shift-aware)

**Files:**
- Create: `src/Pulse.Edge.Agent/Simulation/MachineStateModel.cs`
- Test: `src/Pulse.Edge.Tests/Simulation/MachineStateModelTests.cs`

**Interfaces:**
- Consumes: `StableRandom`, `UnitDefinition`, `MachineParams`, `ShiftCalendar`.
- Produces:
  - `public enum MachineMode { Running, Idle, Fault, PlannedStop }`
  - `public readonly record struct MachineSnapshot(MachineMode Mode, int FaultCode)`
  - `public sealed class MachineStateModel(string scenarioId, UnitDefinition unit, ShiftCalendar shifts, TimeSpan utcOffset)`:
    - `MachineSnapshot At(DateTime utc)`
    - `double ProducedBetween(DateTime fromUtc, DateTime toUtc)`, which integrates `RatePerMin` over Running time in 1-second steps of the mode function. Used for gap catch-up.

Algorithm (the part the signature doesn't determine):
- Time splits into hour buckets.
- For each bucket, `StableRandom.For(scenarioId, unit.Id, bucketStartIso)` draws:
  - fault starts: a Poisson process with mean `MtbfMinutes`;
  - each fault's duration: exponential with mean `MttrMinutes`, clamped to 2–90 min;
  - micro-stops: `MicroStopsPerHour`, each 20–90 s, shown as `Idle`.
- `At(t)` checks the current bucket and the previous one, since a fault started near the end of an hour runs into the next.
- `PlannedStop` wins when `FollowsShifts` and `t` is outside every shift window. Bucket boundaries are hour-aligned in scenario local time.

- [ ] **Step 1: Write the failing tests**
  - `At_IsDeterministic_AcrossInstances`: two new models for `iws1` give equal snapshots at 500 random instants.
  - `At_SameKindUnits_FaultIndependently`: over a simulated 7 days, the share of minutes where `iws1` and `iws2` are both in `Fault` is below 5% of the minutes where either is.
  - `At_OutsideShift_IsPlannedStop`: Sunday 10:00 local → `PlannedStop` for `iws1`. `blr1` (followsShifts false) is not `PlannedStop`.
  - `At_AvailabilityRoughlyMatchesParams`: over 30 days of shift time, `iws1` Running share is between 0.80 and 0.95.
  - `ProducedBetween_IsAdditive`: `P(a,c)` equals `P(a,b)+P(b,c)` within 1 piece.
- [ ] **Step 2: Run, expect FAIL.** `--filter FullyQualifiedName~MachineStateModelTests`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(simulator): deterministic per-unit machine state model`

### Task 4: Scenario engine with persistence and events

**Files:**
- Create: `src/Pulse.Edge.Agent/Simulation/ScenarioEngine.cs`, `src/Pulse.Edge.Agent/Simulation/ScenarioStateStore.cs`
- Modify: `src/Pulse.Edge.Storage/QueueDbContext.cs`: extract the existing data-dir resolution into `public static string ResolveDataDirectory()` (same logic, same precedence: `PULSE_EDGE_DATA_DIR`, then the OS default). `OnConfiguring` calls it.
- Test: `src/Pulse.Edge.Tests/Simulation/ScenarioEngineTests.cs`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `public sealed record ScenarioPersistedState(Dictionary<string,double> Counters, Dictionary<string,double> Analogs, Dictionary<string,DateTime> ActiveEventsUntil, DateTime LastUpdateUtc)`
  - `public sealed class ScenarioStateStore(string directory)`, with files `<dir>/simulator/<scenarioId>.state.json` and `<scenarioId>.events.json`:
    - `ScenarioPersistedState? Load(string scenarioId)`
    - `void Save(string scenarioId, ScenarioPersistedState s)`: atomic write via temp file + rename.
    - `void RequestEvent(string scenarioId, string eventId, DateTime requestedUtc)`: appends.
    - `IReadOnlyList<(string EventId, DateTime RequestedUtc)> DrainEventRequests(string scenarioId)`.
  - `public sealed class ScenarioEngine` (singleton, thread-safe with one lock per scenario):
    - `ScenarioEngine(ScenarioStateStore store)`
    - `void Update(string scenarioId, DateTime nowUtc)`
    - `double Read(string scenarioId, string address)`: address is `<unitId>.<signal>`. Throws `KeyNotFoundException` for an unknown unit or signal (Review Focus 3).
    - `ScenarioStatus Status(string scenarioId, DateTime nowUtc)`
    - `record ScenarioStatus(IReadOnlyList<UnitStatus> Units, IReadOnlyList<ActiveEvent> ActiveEvents)`, `record UnitStatus(string Id, string Kind, string Mode, double? Value)`, `record ActiveEvent(string Id, DateTime UntilUtc)`

Behaviour:
- **Counters:** `good_count`/`reject_count` advance by `ProducedBetween` × (1 − reject) / × reject. They are monotonic and persisted.
- **Long gaps:** if `now − LastUpdateUtc` is over 5 min, catch up with `ProducedBetween` over the gap (Review Focus 2).
- **Analogs:** first-order toward the setpoint, or toward `StoppedValue` when the followed unit isn't Running. Noise: `NextNormal(0, sd)` seeded per (unit, second).
- **Meters:** kW = `BaseKw` + Σ over fed machines of `RunningKw` or `IdleKw` by mode. kWh integrates kW and starts from `StartKwh` on first run. PF interpolates between `PfAtLowLoad` and `PfAtFullLoad` by load fraction.
- **Events:**
  - Drained requests plus daily scheduled draws: per (event, local date), `StableRandom.For(scenario, event, date)` decides with `DailyProbability` and picks a minute inside shift hours.
  - Each activates until `start + DurationMinutes`. Re-triggering an active event sets `until = max(until, now + duration)` and never stacks (Review Focus 4).
  - `force_fault` overrides the machine's mode to `Fault` with the event's code. `offset` adds `Magnitude` to the analog target. `ramp` adds `Magnitude × elapsed/duration`.
- **Saving:** at most every 30 s, plus from `Dispose`.

- [ ] **Step 1: Write the failing tests.** Use a temp dir per test; set `PULSE_EDGE_DATA_DIR` only where needed.
  - `Counters_AreMonotonic` over 2 h of 1 s updates for `iws1`.
  - `Restart_ContinuesCounters`: engine A runs 30 min and saves. Engine B on the same store reads `good_count` ≥ A's last value, and mode at t equals A's mode at t.
  - `Gap_CatchesUpWithoutOvershoot`: an update at t, then t + 60 min; the delta equals `ProducedBetween(t, t+60min)` within 1%.
  - `Meter_DropsWhenFedMachinesStop`: `m_iws1.kw` at a Sunday instant is less than at a running weekday instant.
  - `Analog_ConvergesToSetpoint`: `htst1_outlet.value` within ±0.6 of 73 after 10 min running.
  - `Event_Offset_LowersHtst_AndExpires`: `RequestEvent("htst_temp_drop")` gives a value below 70.5 within 3 min and back above 72 after 8 + 5 min.
  - `Event_RetriggerExtends_NotStacks`: two requests 2 min apart give one active event, and the minimum value is no lower than with a single request.
  - `Read_UnknownAddress_Throws`.
  - `Ambient_AlwaysMoves_StaysInBand`: for `pkg_room_temp`, over 1 h at 10 s steps, at least 90% of consecutive samples differ, and every value is within `Center ± (Amplitude + 4·NoiseSd)`.
  - `Ambient_FollowsMachine`: `iws1_motor_current.value` is 0 at a Sunday (planned stop) instant and > 0 while `iws1` is Running.
- [ ] **Step 2: Run, expect FAIL.** `--filter FullyQualifiedName~ScenarioEngineTests`
- [ ] **Step 3: Implement** the store, the engine and the `ResolveDataDirectory` extraction.
- [ ] **Step 4: Run, expect PASS**, then run the full test project (the extraction must not break storage tests).
- [ ] **Step 5: Commit** `feat(simulator): scenario engine with persistence and events`

### Task 5: Wire the `scenario` template into the SIMULATOR protocol

**Files:**
- Modify: `src/Pulse.Edge.Agent/Drivers/SimulatorDriverPoller.cs`. Parse `Scenario` from ConfigJson. When `Template == "scenario"`, call `engine.Update(scenarioId, now)` and `engine.Read(...)`; leave the `energy`/`production` path unchanged.
- Modify: `src/Pulse.Edge.Agent/Program.cs:67` and `src/Pulse.Edge.Api/Program.cs:253`. Register `ScenarioStateStore` (directory = `QueueDbContext.ResolveDataDirectory()`) and `ScenarioEngine` as **singletons**.
- Test: `src/Pulse.Edge.Tests/Simulation/SimulatorScenarioPollerTests.cs`

**Interfaces:**
- Consumes: `ScenarioEngine.Update/Read` (Task 4).
- Produces: adapter config `{"Template":"scenario","Scenario":"integra-dairy"}`; tag address `<unitId>.<signal>`.

- [ ] **Step 1: Write the failing tests** (use `TestDatabaseBootstrap` the way existing tests do):
  - `ScenarioTemplate_ReadsUnitSignal`: an adapter with scenario config and a datapoint `iws1.good_count` → `LastValue` parses to a number > 0 after two polls 60 s apart.
  - `ScenarioTemplate_UnknownAddress_MarksFailure`: datapoint `iws9.good_count` → `LastError` set and `ConsecutiveFailures` 1 (Review Focus 3).
  - `ProductionTemplate_Unchanged`: the existing `SimulatorDriverOeeTests` scenario still passes.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**, plus `dotnet build Pulse.Edge.slnx --warnaserror`.
- [ ] **Step 5: Commit** `feat(simulator): scenario template for SIMULATOR adapters`

### Task 6: Simulator REST API

**Files:**
- Create: `src/Pulse.Edge.Api/Endpoints/SimulatorEndpoints.cs`; map it in `src/Pulse.Edge.Api/Program.cs` next to `MapOeeEndpoints`.
- Test: `src/Pulse.Edge.Tests/Integration/SimulatorEndpointsTests.cs` (WebApplicationFactory, the way the existing integration tests sign in an Admin).

**Interfaces:**
- Consumes: `ScenarioCatalog`, `ScenarioEngine`, `ScenarioStateStore`.
- Produces:
  - `GET /api/simulator/scenarios` returns `[{ id, name, units: [{ id, kind, signals: [string] }], events: [{ id, unit, durationMinutes }] }]`.
  - `GET /api/simulator/scenarios/{id}/status` returns `ScenarioStatus`.
  - `POST /api/simulator/scenarios/{id}/events` with `{ eventId }` returns `202`, after which `ScenarioStateStore.RequestEvent` is called. Errors: `404` for an unknown scenario or event; `401`/`403` for non-Admin, through the existing middleware.

- [ ] **Step 1: Write the failing tests:** list contains integra-dairy with `iws1` signals; POST an unknown event → 404; POST as a `ReadOnly` user → 403; POST `htst_temp_drop` as Admin → 202, and the events file contains it.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(simulator): scenario list, status and event trigger API`

### Task 7: UI (scenario template, tag browser, live Scenario panel)

**Files:**
- Modify: `src/Pulse.Edge.UI/src/components/ProtocolsTab/CreateAdapterWizard.tsx` and `EditAdapterModal.tsx`. Add a `scenario` option to the template dropdown (around `:1176`) plus a scenario `<select>` from `GET /api/simulator/scenarios`; write `{"Template":"scenario","Scenario":id}`.
- Modify: `src/Pulse.Edge.UI/src/components/TagsTab/SimulatorBrowserModal.tsx`. For scenario adapters, list `<unit>.<signal>` from the API instead of the 11 fixed tags; data types: `state`/`fault` Boolean, counters UInt32, `fault_code` Int32, others Double.
- Create: `src/Pulse.Edge.UI/src/components/ProtocolsTab/ScenarioPanel.tsx` (+ `.test.tsx`), shown on a scenario adapter's card:
  - unit list with mode colour (Running/Idle/Fault/Planned stop), polling status every 5 s;
  - one button per event that POSTs and shows "active until HH:mm";
  - usable at phone width (the presenter triggers from a phone).
- Modify: the en + th i18n files for all new strings.

**Interfaces:**
- Consumes: the Task 6 endpoints.

- [ ] **Step 1: Write the failing vitest tests** (`ScenarioPanel.test.tsx`):
  - renders units from a mocked status response;
  - clicking an event button POSTs `{eventId}` and then shows the active-until text;
  - renders Thai labels when the locale is `th`.
- [ ] **Step 2: Run, expect FAIL.** `pnpm --filter pulse-edge-ui test -- ScenarioPanel`
- [ ] **Step 3: Implement** the panel and the wizard, modal and browser changes.
- [ ] **Step 4: Run, expect PASS.** Then `pnpm lint:ui` (zero errors) and `pnpm build:ui`.
- [ ] **Step 5: Commit** `feat(ui): scenario simulator template, tag browser and live panel`

### Task 8: Docs and an end-to-end check

**Files:**
- Modify: `know-how/adapters/simulator.md`. Rewrite: the real templates (`energy`, `production`, `scenario`), the address scheme, the Integra Dairy unit list and events, and the event API.
- Create: `src/Pulse.Edge.Tests/Simulation/IntegraDairySoakTests.cs`

- [ ] **Step 1: Write the failing soak test** `IntegraDairy_SevenDays_Sane`. Run the engine over 7 simulated days at 10 s steps and check:
  - every counter is monotonic;
  - every analog stays within physical bounds: `cold1_temp` 0–15, `htst1_outlet` 60–80, `blr1_pressure` 0–12;
  - `m_main.kw` stays within 40–900;
  - every event fired at least once from its daily schedule;
  - every ambient unit stayed inside its band the whole week (none ever "alarms");
  - no exception.
- [ ] **Step 2: Run, expect FAIL** (before the doc and threshold tuning, or if any bound is off). Tune the scenario JSON values until it passes, without changing tests.
- [ ] **Step 3: Rewrite the know-how doc.**
- [ ] **Step 4: Run the full gate:** `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`, `dotnet build Pulse.Edge.slnx --warnaserror`, `pnpm lint:ui`, `pnpm test:ui`. All green.
- [ ] **Step 5: Commit** `docs(simulator): scenario simulator know-how; 7-day soak test`

---

## Self-review notes
- **Spec coverage, §6.2:**
  - units + state machines (T3);
  - counters persisting (T4);
  - analogs with dynamics + noise (T4);
  - energy from machine state + load shape. Covered through the shift calendar and fed-machine loads; the time-of-day shape comes from shifts, and no extra pulse-project load-shape port is needed (YAGNI);
  - scenario control, UI + REST (T6, T7);
  - stable identity (T1, T3);
  - output through the normal tag pipeline (T5);
  - OEE channels bind to `iws1.state` / `iws1.fault` / `iws1.fault_code` / `iws1.good_count` / `iws1.reject_count` using the existing OEE channel feature, which needs no change.
- **§6.3 (running on the VPS)** belongs to plan 3.
- **Types:** `ScenarioEngine.Read(scenarioId, address)` is used the same way in T5 and T6; `ScenarioStatus` is defined in T4 and consumed in T6 and T7.
