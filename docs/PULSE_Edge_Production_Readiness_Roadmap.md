# PULSE Edge Production Readiness Roadmap

This is the living delivery plan for moving PULSE Edge from a pilot-ready product to a production industrial edge appliance.

The roadmap is gate-driven: a phase is complete only when its exit gate has objective evidence. Completing implementation alone does not close a phase.

## How to use this document

1. Update the **Follow-up dashboard** during each project review.
2. Work only on the current phase, except for an explicitly recorded urgent risk.
3. Check an acceptance item only after its evidence exists.
4. Add links or file paths to test reports, decisions, runbooks, builds, or pull requests in the phase's **Evidence** section.
5. Record a gate decision in the **Gate review log**. A failed gate returns the phase to `In progress`.

Status values:

- `Not started` — no committed work has begun.
- `In progress` — implementation or validation is underway.
- `Blocked` — progress requires an explicit decision or external dependency.
- `Gate review` — implementation is complete and evidence is being reviewed.
- `Passed` — every gate check has evidence and the gate has been approved.

## Follow-up dashboard

Update this table first. Keep exactly one phase marked `In progress` unless an urgent production risk is being handled separately.

| Phase | Outcome | Status | Owner | Target | Gate | Next action |
|---|---|---|---|---|---|---|
| 0 | Pilot baseline | Blocked | Engineering + stakeholders | TBD | G0 | Resume Windows and load validation after the Phase 1 sequencing exception |
| 1 | Engineering candidate | In progress | Engineering | TBD | G1 | Pin toolchains, establish blocking CI, and clear the lint baseline |
| 2 | Security candidate | Not started | TBD | TBD | G2 | Create threat model and security hardening backlog |
| 3 | Commissioning candidate | Not started | TBD | TBD | G3 | Design validate/apply/rollback configuration flow |
| 4 | Reliability candidate | Not started | TBD | TBD | G4 | Define retention, queue limits, and disk thresholds |
| 5 | Operations candidate | Not started | TBD | TBD | G5 | Define subsystem health and support bundle contract |
| 6 | Release candidate | Not started | TBD | TBD | G6 | Design signed update and automatic rollback process |
| 7 | Fleet candidate | Not started | TBD | TBD | G7 | Define desired-state and rollout campaign model |
| 8 | Production 1.0 | Not started | TBD | TBD | G8 | Create production validation test matrix |

## Current baseline observations

These observations were recorded during the initial product review and should be rechecked in Phase 0:

- The solution contains local adapter, tag, stream, queue, diagnostic, backup, cloud-pairing, and local-user capabilities.
- Supported implementations include OPC UA, Modbus, MQTT, EtherNet/IP via LibPlcTag, Siemens S7, REST, and BACnet projects.
- The 2026-07-12 clean backend build passes with zero warnings, and the automated test run passes 47 of 47 tests.
- A current NuGet audit reports no vulnerable direct or transitive package. Earlier advisories for `Microsoft.OpenApi 2.0.0` and `SQLitePCLRaw.lib.e_sqlite3 2.1.11` are no longer reproducible with the current dependency graph.
- The frontend production build passes, but lint currently fails with 48 errors and 2 warnings.
- Host storage improved from an earlier 99%/approximately 3.6 GiB available reading to 94%/approximately 12.6 GiB available in the repeatable baseline snapshot. PULSE database files total less than 10 MiB; host storage remains a monitored operational risk and product-level disk protection remains required.

## Phase 0 — Baseline and release policy

**Goal:** Freeze the current working product as a measurable baseline.

**Current status:** Windows x64 validation has started. The validator supports PowerShell 7 and built-in Windows PowerShell 5.1. After its evidence is attached, remaining gate work requires a disposable representative pilot/load fixture and named Product, Engineering, Operations, and Security reviewers. Phase 1 implementation must not begin under the phase-by-phase policy until G0 passes or the project owner records an explicit sequencing exception.

**Sequencing exception:** On 2026-07-12, the project owner explicitly chose to postpone Windows validation and authorized implementation of the recommended Phase 1 engineering slice. G0 remains open and blocked; this exception changes execution order, not gate acceptance.

### Work

- [ ] Define supported operating systems, architectures, hardware, and minimum resources.
- [ ] Document supported protocol versions and tested device models.
- [ ] Define target tag count, polling rates, ingestion rate, and maximum offline duration.
- [ ] Define release numbering, support window, and upgrade compatibility policy.
- [ ] Create a representative pilot configuration and test dataset.
- [ ] Record baseline CPU, memory, disk growth, queue throughput, and delivery latency.
- [ ] Tag the accepted pilot baseline in source control.

### Gate G0 — Baseline accepted

- [x] All existing automated tests pass.
- [ ] A clean checkout builds on a second environment.
- [x] The pilot configuration exports and restores successfully.
- [ ] The hardware and support matrix is approved.
- [ ] Capacity targets and acceptance thresholds are measurable.
- [ ] Known limitations and accepted risks are documented.

**Evidence:**

- Test report: [Initial production-readiness baseline](readiness-evidence/2026-07-12-initial-baseline.md#backend-tests)
- Build records: [Initial production-readiness baseline](readiness-evidence/2026-07-12-initial-baseline.md#backend-build) and [Linux ARM64 clean-room check](readiness-evidence/2026-07-12-linux-arm64-clean-room.md)
- Backup/restore report: [Disposable backup round-trip](readiness-evidence/2026-07-12-initial-baseline.md#disposable-backup-round-trip)
- Support matrix: [Draft pilot baseline profile](PULSE_Edge_Pilot_Baseline_Profile.md#supported-deployment-profile)
- Baseline measurements: [Required measurement plan](PULSE_Edge_Pilot_Baseline_Profile.md#required-baseline-measurements) and [local operational snapshot](readiness-evidence/2026-07-12-local-operational-baseline.md); load/outage/recovery results TBD
- Accepted limitations: [Draft pilot known limitations](PULSE_Edge_Pilot_Known_Limitations.md); stakeholder acceptance pending
- Gate review packet: [G0 gate review packet](PULSE_Edge_G0_Gate_Review_Packet.md)

**Exit result:** `Pilot Baseline`

## Phase 1 — Build, dependency, and CI hygiene

**Goal:** Give every change repeatable automated validation and traceable artifacts.

### Work

- [x] Verify the current `Microsoft.OpenApi` dependency has no reported advisory.
- [x] Verify the current `SQLitePCLRaw.lib.e_sqlite3` dependency has no reported advisory.
- [x] Verify the earlier `Microsoft.OpenApi` version conflict no longer occurs after restore.
- [x] Verify the backend builds without compiler warnings after restore.
- [x] Add CI for restore, backend build, and backend tests.
- [x] Add frontend type checking, linting, initial unit tests, and production build.
- [x] Add dependency, license, and secret scanning to CI.
- [x] Produce checksummed CI artifacts with commit metadata; release-tag artifacts remain open.
- [x] Generate and archive an SPDX SBOM for each CI artifact bundle.
- [ ] Protect the main branch with required checks.

### Gate G1 — Build integrity

- [ ] A clean checkout builds without manual intervention.
- [ ] Backend and frontend pipelines pass.
- [ ] No unaccepted critical or high-severity runtime vulnerability remains.
- [ ] No unintended compiler warning remains.
- [ ] Artifacts contain version, commit, and build metadata.
- [ ] An SBOM is generated and retained.
- [ ] A failed required check prevents release creation.

**Evidence:**

- CI runs: [Initial hosted run passed](https://github.com/phynaro/pulse-edge/actions/runs/29193876254); [expanded security, test, and artifact run passed](https://github.com/phynaro/pulse-edge/actions/runs/29194077549). See [Phase 1 engineering slice evidence](readiness-evidence/2026-07-12-phase-1-engineering-slice.md).
- Implementation plan: [Phase 1 engineering plan](PULSE_Edge_Phase_1_Engineering_Plan.md)
- Vulnerability report: [Initial production-readiness baseline](readiness-evidence/2026-07-12-initial-baseline.md#nuget-vulnerability-audit)
- Artifact and checksum: TBD
- SBOM: TBD
- Warning baseline or exception record: [Phase 1 engineering slice evidence](readiness-evidence/2026-07-12-phase-1-engineering-slice.md)

**Exit result:** `Engineering Candidate`

## Phase 2 — Local security hardening

**Goal:** Protect the node, credentials, and configuration on realistic plant networks.

### Work

- [ ] Produce a threat model covering local UI, APIs, cloud communication, protocols, backups, and updates.
- [ ] Enforce TLS for external communication and define certificate trust behavior.
- [ ] Encrypt cloud keys and protocol credentials at rest.
- [ ] Redact secrets from API responses, logs, exports, and support bundles.
- [ ] Add password policy, login throttling, and temporary lockout.
- [ ] Add session expiration and secure cookie settings.
- [ ] Verify admin and read-only authorization on every endpoint.
- [ ] Add credential and certificate rotation procedures.
- [ ] Add restrictive CORS and security headers.
- [ ] Validate backup size, schema, paths, content, and integrity before import.
- [ ] Document service binding and firewall defaults.

### Gate G2 — Security review

- [ ] Anonymous clients cannot access protected endpoints.
- [ ] Read-only users cannot mutate state through direct API calls.
- [ ] Brute-force protection is verified automatically.
- [ ] No plaintext secret appears in logs, exports, or diagnostic bundles.
- [ ] Malformed, oversized, and tampered backup files are rejected safely.
- [ ] Production TLS verification cannot be bypassed.
- [ ] Dependency, static-analysis, and secret scans pass.
- [ ] The threat model has no unresolved critical finding.

**Evidence:**

- Threat model: TBD
- Endpoint authorization test report: TBD
- Security scan: TBD
- Backup abuse test report: TBD
- Security exception register: TBD

**Exit result:** `Security Candidate`

## Phase 3 — Configuration safety and auditability

**Goal:** Prevent configuration mistakes from interrupting acquisition.

### Work

- [ ] Introduce a draft, validate, apply workflow.
- [ ] Validate adapter reachability, addresses, data types, and polling settings.
- [ ] Detect duplicate addresses and conflicting stream bindings.
- [ ] Estimate polling and resource load before activation.
- [ ] Show dependency impact before destructive changes.
- [ ] Snapshot configuration before each applied change.
- [ ] Add rollback to the previous working configuration.
- [ ] Add an immutable audit trail with actor, timestamp, and old/new values.
- [ ] Add bulk tag import with row-level validation results.
- [ ] Add configuration schema versions and tested migrations.

### Gate G3 — Safe configuration

- [ ] Invalid configuration cannot become active.
- [ ] Failed activation preserves or restores the previous configuration.
- [ ] Destructive changes display affected dependencies before confirmation.
- [ ] Every privileged configuration change has an audit record.
- [ ] A backup from the previous supported version migrates successfully.
- [ ] Rollback restores acquisition without manual database editing.
- [ ] Bulk import isolates invalid rows without losing valid work.

**Evidence:**

- Validation test report: TBD
- Rollback demonstration: TBD
- Audit sample: TBD
- Migration test report: TBD
- Bulk import test report: TBD

**Exit result:** `Commissioning Candidate`

## Phase 4 — Data durability and storage protection

**Goal:** Prevent silent data loss, database corruption, and disk exhaustion.

### Work

- [ ] Define ordering, acknowledgment, retry, and delivery guarantees.
- [ ] Add stable message identifiers for cloud deduplication.
- [ ] Implement bounded exponential retry with jitter.
- [ ] Add poison-message and dead-letter handling.
- [ ] Expose oldest queued record and end-to-end delivery lag.
- [ ] Configure telemetry, event, diagnostic, and application-log retention separately.
- [ ] Add database, queue, and log size limits.
- [ ] Add disk warning, critical, and emergency thresholds.
- [ ] Define and expose the emergency shedding policy.
- [ ] Add database integrity checks and a recovery workflow.
- [ ] Test SQLite WAL checkpoint and crash recovery behavior.
- [ ] Estimate remaining storage time from current ingestion rate.

### Gate G4 — Reliability

- [ ] Abrupt process or machine termination does not corrupt acknowledged data.
- [ ] Data collected during the target cloud outage is delivered after reconnection.
- [ ] Retransmission does not create duplicate cloud records.
- [ ] Poison records cannot block healthy records indefinitely.
- [ ] Disk warnings occur before service disruption.
- [ ] Emergency disk behavior matches the approved shedding policy.
- [ ] Queue size, age, and delivery lag are visible locally and remotely.
- [ ] Database recovery is documented and has been exercised.

**Evidence:**

- Power-loss test report: TBD
- Outage recovery report: TBD
- Deduplication report: TBD
- Disk pressure report: TBD
- Recovery runbook and exercise: TBD

**Exit result:** `Reliability Candidate`

## Phase 5 — Observability and supportability

**Goal:** Let operators and support engineers diagnose incidents without database access.

### Work

- [ ] Add structured health checks for every subsystem.
- [ ] Show adapter reconnect attempts and last successful read.
- [ ] Show each tag's last-good value, age, and quality reason.
- [ ] Translate protocol error codes into actionable guidance.
- [ ] Add resource, queue, and delivery-lag trends.
- [ ] Add alerts for disk, queue age, adapter outage, and cloud outage.
- [ ] Produce a downloadable, redacted support bundle.
- [ ] Add correlation IDs from acquisition through cloud acceptance.
- [ ] Separate operator, commissioning, and diagnostic views where appropriate.
- [ ] Record service restart and update history.

### Gate G5 — Operability

- [ ] Common incidents can be diagnosed from the UI and support bundle.
- [ ] The support bundle contains no credentials or sensitive payloads by default.
- [ ] Every critical subsystem exposes health and failure reason.
- [ ] Alerts include start time, severity, and recommended response.
- [ ] A telemetry record can be traced from tag acquisition to cloud acceptance.
- [ ] Critical alerts have automated behavioral tests.
- [ ] Runbooks exist for the ten most likely field incidents.

**Evidence:**

- Health contract: TBD
- Redaction test: TBD
- Trace example: TBD
- Alert test report: TBD
- Operations runbooks: TBD

**Exit result:** `Operations Candidate`

## Phase 6 — Update, rollback, and disaster recovery

**Goal:** Safely maintain unattended nodes throughout their lifecycle.

### Work

- [ ] Produce signed installers and update packages.
- [ ] Verify signatures and checksums before installation.
- [ ] Add preflight checks for disk, compatibility, and backup readiness.
- [ ] Support staged installation and automatic rollback.
- [ ] Preserve configuration, identity, queues, and users across upgrades.
- [ ] Test forward and backward database migration behavior.
- [ ] Add recovery mode when normal startup fails.
- [ ] Document factory recovery media or procedure.
- [ ] Record update history and failure reason.
- [ ] Prevent unintended or unsupported downgrades.

### Gate G6 — Lifecycle safety

- [ ] Tampered or unsigned packages are rejected.
- [ ] Power interruption during update leaves a bootable old or new version.
- [ ] Failed post-update health checks trigger automatic rollback.
- [ ] Configuration and buffered data survive every supported upgrade.
- [ ] Migration failure preserves the original database.
- [ ] Field recovery succeeds using the documented procedure.
- [ ] The previous supported release upgrades successfully to the candidate.

**Evidence:**

- Signature verification report: TBD
- Interrupted update report: TBD
- Rollback report: TBD
- Migration report: TBD
- Recovery exercise: TBD

**Exit result:** `Release Candidate`

## Phase 7 — Fleet management

**Goal:** Operate many edge nodes consistently from PULSE Cloud.

### Work

- [ ] Add fleet inventory with version, health, and last heartbeat.
- [ ] Report queue lag, disk condition, and configuration state.
- [ ] Add desired-versus-actual configuration comparison.
- [ ] Deploy configuration with node-side validation and rollback.
- [ ] Add internal, pilot, and production rollout rings.
- [ ] Add maintenance windows and campaign pause/resume.
- [ ] Support remote redacted support-bundle requests.
- [ ] Support API-key and certificate rotation.
- [ ] Audit cloud-initiated actions in both cloud and node records.
- [ ] Define safe offline and reconnect behavior for remote commands.

### Gate G7 — Fleet readiness

- [ ] A controlled configuration reaches selected nodes with individual outcomes.
- [ ] A failed node does not stop the rest of a campaign.
- [ ] Rollout can be paused and resumed safely.
- [ ] Offline nodes reconcile safely after reconnecting.
- [ ] Configuration drift is detected and explained.
- [ ] Remote actions are authorized and fully audited.
- [ ] Compromise of one node does not expose another node's credentials.
- [ ] The pilot fleet completes its observation period without database intervention.

**Evidence:**

- Campaign report: TBD
- Offline reconciliation report: TBD
- Drift example: TBD
- Authorization test: TBD
- Fleet pilot report: TBD

**Exit result:** `Fleet Candidate`

## Phase 8 — Production validation

**Goal:** Prove the complete system under realistic load and failure conditions.

### Validation campaigns

- [ ] Maximum supported tag-count test.
- [ ] Fastest supported polling-rate test.
- [ ] Mixed-protocol load test.
- [ ] Long cloud outage and backlog recovery test.
- [ ] Network flapping, packet loss, and latency test.
- [ ] Repeated PLC disconnect and reconnect test.
- [ ] Full-disk and nearly-full-disk test.
- [ ] Process crash and machine power-loss test.
- [ ] Certificate expiry and credential-rotation test.
- [ ] Upgrade, failed-upgrade, and rollback test.
- [ ] Backup and restore across supported versions.
- [ ] Multi-day or multi-week soak test.
- [ ] Browser commissioning end-to-end tests.
- [ ] Installer, repair, and uninstall tests on supported platforms.

### Gate G8 — Production release

- [ ] Capacity targets pass with the approved safety margin.
- [ ] Soak testing shows no unexplained memory, handle, or storage growth.
- [ ] Fault injection causes no unrecoverable corruption.
- [ ] Recovery-time and data-loss objectives are met.
- [ ] Security review has no unresolved critical or high finding.
- [ ] Installation and rollback pass on all supported platforms.
- [ ] Runbooks, support process, release notes, and known issues are complete.
- [ ] Product, engineering, security, and operations owners approve release.

**Evidence:**

- Capacity report: TBD
- Soak report: TBD
- Fault-injection report: TBD
- Security approval: TBD
- Platform certification matrix: TBD
- Release approval: TBD

**Exit result:** `PULSE Edge 1.0 Production`

## Delivery sequence and milestones

```text
G0 Baseline
  -> G1 Build integrity
  -> G2 Security
  -> G3 Configuration safety
  -> G4 Data reliability
  -> G5 Operability
  -> G6 Update safety
  -> G7 Fleet readiness
  -> G8 Production validation
```

| Milestone | Required gates | Intended use |
|---|---|---|
| Pilot 0.9 | G0-G3 | Controlled commissioning and limited pilot sites |
| Hardened Pilot 0.9.5 | G4-G5 | Extended field operation with support readiness |
| Release Candidate 1.0-rc | G6 | Upgradeable production candidate |
| Fleet Pilot | G7 | Controlled multi-node operation |
| Production 1.0 | G8 | Approved production deployment |

## Gate review log

Add one row for every gate review, including unsuccessful reviews.

| Date | Gate | Decision | Reviewer(s) | Evidence summary | Open actions |
|---|---|---|---|---|---|
| 2026-07-12 | G0 | In progress | Local and Linux ARM64 clean-room builds pass; 47 tests pass, including isolated backup/restore. Draft support/capacity and limitations documents exist. A committed clean Windows x64 checkout, full fixture measurements, stakeholder approval, and baseline tag remain open. | Review the drafts, commit an accepted candidate, then validate it on Windows x64. |
| 2026-07-12 | G0 | Blocked | Autonomous/local evidence work is exhausted without overstating the gate. The Windows validation script and gate-review packet are ready, but execution needs a native Windows x64 runner, disposable load fixture, candidate commit, and authorized reviewers. | Resume from [the G0 gate review packet](PULSE_Edge_G0_Gate_Review_Packet.md) when those inputs are available. |
| 2026-07-12 | G0 | In progress | Windows x64 validation resumed. The first invocation found that PowerShell 7 (`pwsh`) was unavailable; the validator now supports built-in Windows PowerShell 5.1 through `powershell.exe`. | Run the revised validator and attach the generated report and logs. |
| 2026-07-12 | G0 | In progress | The first Windows PowerShell 5.1 parse found a missing closing parenthesis in the frontend package-path preflight. The syntax defect was corrected before any validation command ran. | Synchronize the corrected script and rerun the validator. |
| 2026-07-12 | G0 | In progress | Windows PowerShell 5.1 converted native `dotnet.exe` stderr into `NativeCommandError` under the script's stop-on-error policy. Native execution now uses the actual process exit code as authority while retaining combined output in the evidence log. | Synchronize and rerun; if a command exits nonzero, provide its named log file. |
| 2026-07-12 | G0 | Blocked | The project owner chose to postpone Windows validation. The remaining Windows, load, and stakeholder evidence stays required and no G0 check was waived. | Resume after the authorized Phase 1 engineering slice or when the Windows/load environments are ready. |
| 2026-07-12 | G1 | In progress | The project owner authorized a sequencing exception to begin toolchain pinning, blocking CI, and lint remediation before G0 passes. | Complete the slice and attach local plus clean-room evidence; do not mark G1 passed without CI/enforcement evidence. |
| 2026-07-12 | G1 | In progress | Toolchains and dependency locks are pinned, the quality workflow is implemented, frontend lint is clean, local builds and all 47 backend tests pass, and read-only browser smoke is clean. | Run the hosted workflow; then add frontend tests, secret/license scanning, artifacts, SBOMs, and branch enforcement. |
| 2026-07-12 | G1 | In progress | The first hosted workflow passed. Initial frontend unit tests plus dependency/license/secret scanning and checksummed SBOM-bearing artifacts are implemented for follow-up validation. GitHub reports branch protection unavailable for this private repository on its current plan. | Run the follow-up workflow, then upgrade the GitHub plan or make the repository public to enable and prove required-check enforcement. |

## Decision and risk log

Use this section for decisions or risks that materially change scope, sequence, or acceptance criteria.

| ID | Date | Type | Description | Owner | Due | Status |
|---|---|---|---|---|---|---|
| R-001 | 2026-07-12 | Risk | Host storage improved from 99% with approximately 3.6 GiB available to 94% with approximately 12.6 GiB available. PULSE database files total less than 10 MiB. Continue host monitoring; product thresholds and retention remain Phase 4 work. | Operations / Engineering | Ongoing | Mitigated / monitor |
| R-002 | 2026-07-12 | Risk | Earlier high-severity NuGet advisories are not present in the current restored graph; continuous scanning is still required in CI. | Engineering | 2026-07-12 | Closed |
| R-003 | 2026-07-12 | Risk | The frontend lint baseline of 48 errors and 2 warnings was remediated without disabling the rules; production build and interaction smoke checks pass. | Engineering | 2026-07-12 | Closed |
| R-004 | 2026-07-12 | Risk | Repository CI and runtime pins are now implemented, but the first hosted run and frontend automated tests remain open. This is not Windows certification evidence. | Engineering | TBD | Mitigated / open |
| R-005 | 2026-07-12 | Risk | A default macOS source archive emitted AppleDouble `._*` files that fail C# compilation on Linux. Clean-room packaging passes with `COPYFILE_DISABLE=1`; release packaging must exclude host metadata deterministically. | Engineering | TBD | Open |

## Review cadence

- **Weekly:** update phase status, next action, owners, targets, and risks.
- **At each merge:** attach relevant automated evidence to the current phase.
- **Before a gate review:** replace all applicable `TBD` evidence entries with durable links or repository paths.
- **At each release:** update the milestone, archive the evidence package, and record the gate decision.

To resume Phase 0, assign the four gate reviewers and a target date, accept or revise the baseline drafts, create an immutable candidate commit, run the Windows validation packet, and schedule the representative load/outage/recovery exercise. R-001 remains mitigated but monitored. Phase 1 implementation remains queued behind G0 unless an explicit sequencing exception is recorded.
