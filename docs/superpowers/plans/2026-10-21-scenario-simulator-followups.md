# Scenario simulator: deferred follow-ups (from the 2026-10-21 reviews)

All "can wait" per the final whole-branch review. None blocks the Integra Dairy demo.

- Failed save right after an event drain retries only after the 30 s throttle (add a `_savePending` flag).
- Re-triggering a `ramp` event (e.g. `cold_store_drift`) restarts the ramp: start is derived as `until − duration`.
- Per-tick allocations (string keys, LINQ, one `StableRandom` per noisy unit per second); delegate allocation in the bucket cache.
- `ScenarioStateStore.LockTimeout` default 2 s (public init property).
- `HourIndex` uses double division on ticks (exact on whole seconds); engine assumes UTC inputs.
- Faults drawn in off-shift hours can carry into the next shift start (slightly lower availability).
- Missing pinned-value tests: cross-process determinism, bucket-spanning fault, overnight shift; direct tests for `NextExponential`/`NextNormal`.
- Scenario JSON realism: vibration bands slightly outside 1.0–2.5 mm/s; parent/child meter relation not modelled; `cip1` follows shifts (CIP usually runs between shifts); `hld1_temp` follows `ckr1`; no tests pin the brief's exact numbers.
- Poller: weak `ProductionTemplate_Unchanged` test; noisy per-datapoint log for unknown addresses (backs off).
- API: malformed POST body gives the framework's 400/415; empty `eventId` gives 404 (arguably 400).
- UI: `ScenarioPanel` status load has no in-flight/cancel guard; colour hexes not design tokens; template labels English-only (pre-existing pattern).
- Soak test hard-codes the 30 s save cadence for its IO-error cap.
- State store: a corrupt main file that can't be moved aside may be copied over `.bak` on the next save; the `.bak` copy isn't fsynced; a first concurrent `Update` may run `Load` twice.
- Spec §6.2 items not built (also in `know-how/adapters/simulator.md` §7): time-of-day load shape beyond shifts, CIP/cleaning windows, slowly varying reject fraction.

Pre-existing on `main`, not from this branch:
- NuGet advisories NU1903 (`System.Security.Cryptography.Xml` 10.0.12) and NU1902 (`System.Security.Cryptography.Pkcs` 10.0.12) fail `--warnaserror`.
- `ConfigurationBackupServiceTests` and `PowerMeterOnboardingTests` fail on Windows (edge.db file lock).
