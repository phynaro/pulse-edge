# PULSE Edge G0 Gate Review Packet

**Gate:** G0 — Baseline accepted  
**Current decision:** In progress  
**Prepared:** 2026-07-12

This packet is the agenda and evidence index for the G0 decision. Reviewers must not approve G0 from feature completeness or local demonstrations alone.

## Candidate identity

Complete after the roadmap changes are reviewed and committed.

| Field | Value |
|---|---|
| Candidate version | TBD |
| Git commit | TBD |
| Proposed baseline tag | TBD |
| Windows validation report | TBD |
| Review date | TBD |

## Evidence already available

| Requirement | Evidence | Assessment |
|---|---|---|
| Automated backend tests | [Initial baseline](readiness-evidence/2026-07-12-initial-baseline.md#backend-tests) | 47/47 pass |
| Local clean backend build | [Initial baseline](readiness-evidence/2026-07-12-initial-baseline.md#backend-build) | 0 warnings, 0 errors |
| Isolated backup/restore semantics | [Disposable backup round trip](readiness-evidence/2026-07-12-initial-baseline.md#disposable-backup-round-trip) | Core current-version semantics pass |
| Dependency vulnerability review | [NuGet audit](readiness-evidence/2026-07-12-initial-baseline.md#nuget-vulnerability-audit) | No vulnerable NuGet package reported |
| Separate OS/architecture build | [Linux ARM64 clean room](readiness-evidence/2026-07-12-linux-arm64-clean-room.md) | Backend and frontend build; 47 tests pass |
| Local operating snapshot | [Local operational baseline](readiness-evidence/2026-07-12-local-operational-baseline.md) | Repeatable read-only snapshot; not capacity proof |
| Proposed platform/capacity boundary | [Pilot baseline profile](PULSE_Edge_Pilot_Baseline_Profile.md) | Draft; approval pending |
| Pilot limitations | [Known limitations](PULSE_Edge_Pilot_Known_Limitations.md) | Draft; acceptance pending |

## Evidence still required

### 1. Immutable Windows x64 clean checkout

Run from a fresh clone of the candidate commit on an approved Windows x64 machine:

```powershell
pwsh -File .\scripts\readiness\Test-PulseEdgeWindowsBaseline.ps1
```

- [ ] Checkout was clean before validation.
- [ ] Report identifies the exact commit and environment.
- [ ] Restore passed.
- [ ] Backend build passed with zero unintended warnings.
- [ ] All backend tests passed.
- [ ] Frozen frontend install and production build passed.
- [ ] NuGet audit reported no unaccepted critical/high vulnerability.
- [ ] Report and logs are attached to this packet.

### 2. Representative fixture and capacity measurements

- [ ] Fixture covers the adapters, tag states, streams, queues, and roles defined in the baseline profile.
- [ ] Idle measurements recorded.
- [ ] Normal pilot-load measurements recorded.
- [ ] Proposed target-load measurements recorded.
- [ ] Cloud-outage storage growth recorded.
- [ ] Backlog-recovery rate and live-acquisition impact recorded.
- [ ] Proposed capacity envelope accepted or revised from evidence.

### 3. Backup/UI commissioning exercise

- [ ] Export completed through an authenticated Admin UI/API path on a disposable node.
- [ ] Backup inspected successfully.
- [ ] Restore completed after deliberate portable-configuration changes.
- [ ] Identity, cloud pairing, users, and queued records remained preserved.
- [ ] Acquisition restarted and returned to the expected health state.
- [ ] Backup credential-handling control was followed.

### 4. Documentation decisions

- [ ] Product approves the pilot scope and support promise.
- [ ] Engineering approves feasibility and measured capacity.
- [ ] Operations approves hardware, installation, monitoring, and recovery controls.
- [ ] Security accepts pilot controls or records required remediation.
- [ ] Known limitations have named owners and dispositions.
- [ ] No `TBD` remains in the accepted baseline boundary.

## Gate checklist

Copy the final decision back into the production-readiness roadmap.

| G0 check | Evidence complete | Approved | Notes |
|---|---|---|---|
| All existing automated tests pass | Yes | Pending | 47/47 local and Linux ARM64 |
| Clean checkout builds on a second environment | Partial | Pending | Linux clean room passes; Windows x64 pending |
| Pilot configuration exports and restores successfully | Core test complete | Pending | UI/acquisition exercise pending |
| Hardware and support matrix approved | No | Pending | Draft exists |
| Capacity targets and thresholds measurable | Partial | Pending | Plan and local snapshot exist; load evidence pending |
| Known limitations and accepted risks documented | Draft complete | Pending | Stakeholder acceptance pending |

## Reviewer decision

Allowed decisions:

- `Passed` — every applicable check has objective evidence and approval.
- `Rejected` — evidence contradicts the proposed baseline or risk is unacceptable.
- `In progress` — evidence or approval is missing.

| Role | Reviewer | Decision | Date | Conditions or open actions |
|---|---|---|---|---|
| Product | TBD | In progress | TBD | |
| Engineering | TBD | In progress | TBD | |
| Operations | TBD | In progress | TBD | |
| Security | TBD | In progress | TBD | |

**Final G0 decision:** `In progress`

Do not create the baseline tag until the final decision is `Passed`. If rejected, record the reasons in the roadmap gate log and return Phase 0 to `In progress`.

