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
| 0 | Pilot baseline | Blocked | Engineering + stakeholders | TBD | G0 | Windows validation deferred (R-006); close the Linux-target G0 items — support matrix, capacity thresholds, accepted limitations — and the load/outage fixture |
| 1 | Engineering candidate | Passed | Engineering | 2026-07-13 | G1 | Gate passed 2026-07-13 by project-owner authorization (formal multi-reviewer panel waived). Phase closed. |
| 2 | Security candidate | In progress | Engineering | TBD | G2 | Slice 2A (response & authz hygiene: B-02/B-01/B-04/B-05) merged (PR #12) and Slice 2B (transport security: B-03 local HTTPS, B-08 enforced cloud HTTPS, B-14 hardening, forwarded headers) merged (PR #13). Slice 2C (secrets at rest: B-07/B-09/B-10/B-12) designed + planned; Slice 2D (gate test sweep + review) remains before the gate. |
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
- The frontend production build and lint pass. Vitest now covers dashboard health classification, data-source formatting, and — via Testing Library + jsdom component tests — the local authentication and configuration backup/restore flows (20 tests total). Browser/device-modal coverage is deferred (testing-scope decision) alongside G8's separate browser commissioning end-to-end tests.
- Host storage improved from an earlier 99%/approximately 3.6 GiB available reading to 94%/approximately 12.6 GiB available in the repeatable baseline snapshot. PULSE database files total less than 10 MiB; host storage remains a monitored operational risk and product-level disk protection remains required.

## Phase 0 — Baseline and release policy

**Goal:** Freeze the current working product as a measurable baseline.

**Current status:** Windows x64 validation has started. The validator supports PowerShell 7 and built-in Windows PowerShell 5.1. After its evidence is attached, remaining gate work requires a disposable representative pilot/load fixture and named Product, Engineering, Operations, and Security reviewers. Phase 1 implementation must not begin under the phase-by-phase policy until G0 passes or the project owner records an explicit sequencing exception.

**Sequencing exception:** On 2026-07-12, the project owner explicitly chose to postpone Windows validation and authorized implementation of the recommended Phase 1 engineering slice. G0 remains open and blocked; this exception changes execution order, not gate acceptance.

**Windows deferral (R-006):** On 2026-07-12, the project owner chose to defer Windows deployment and certification for now and target Linux for the near-term gate work. This narrows the *current* supported-platform scope to Linux; it does not waive any G0 check. The Windows deployment matrix, `PULSE_Edge_Windows_Deployment_Specification.md` validation, and G8's Windows installer/repair/uninstall tests remain required before a Windows-supporting production release and must be reinstated when Windows returns to scope.

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
- [x] Protect the main branch with required checks.

### Gate G1 — Build integrity

- [x] A clean checkout builds without manual intervention.
- [x] Backend and frontend pipelines pass.
- [x] No unaccepted critical or high-severity runtime vulnerability remains.
- [x] No unintended compiler warning remains.
- [x] Artifacts contain version, commit, and build metadata.
- [x] An SBOM is generated and retained.
- [x] A failed required check prevents release creation.

**Evidence:**

- CI runs: [Initial hosted run passed](https://github.com/phynaro/pulse-edge/actions/runs/29193876254); [expanded PR run passed](https://github.com/phynaro/pulse-edge/actions/runs/29194592460); [post-merge `main` run passed](https://github.com/phynaro/pulse-edge/actions/runs/29195409651). See [Phase 1 engineering slice evidence](readiness-evidence/2026-07-12-phase-1-engineering-slice.md).
- Implementation plan: [Phase 1 engineering plan](PULSE_Edge_Phase_1_Engineering_Plan.md)
- Vulnerability report: [Initial production-readiness baseline](readiness-evidence/2026-07-12-initial-baseline.md#nuget-vulnerability-audit)
- Artifact and checksum: [`pulse-edge-82dd70e...` retained by the post-merge run](https://github.com/phynaro/pulse-edge/actions/runs/29195409651)
- SBOM: [`pulse-edge-sbom.spdx.json` retained by the post-merge run](https://github.com/phynaro/pulse-edge/actions/runs/29195409651)
- Branch enforcement: [deliberately failing PR was blocked](https://github.com/phynaro/pulse-edge/pull/2); [failure run](https://github.com/phynaro/pulse-edge/actions/runs/29194525820)
- Warning baseline or exception record: [Phase 1 engineering slice evidence](readiness-evidence/2026-07-12-phase-1-engineering-slice.md)
- Release pipeline: tag-triggered `release.yml` runs the reusable required checks (`guard` → `validate` → `publish`); `publish` needs `[guard, validate]`, so a red check structurally blocks it. Design: [release-tag enforcement design](superpowers/specs/2026-07-13-release-tag-enforcement-design.md).
- Release enforcement proof: [a deliberately failing check left `publish` skipped with no release created](https://github.com/phynaro/pulse-edge/actions/runs/29237934034).
- Release happy path: [a passing tag built the Linux artifacts and created a GitHub Release with the arm64 `.deb`, per-arch zips, and SHA256SUMS](https://github.com/phynaro/pulse-edge/actions/runs/29257973968).
- Deferred: MinIO/`pulse.trazor.cloud` **staging** upload is paused behind `ENABLE_STAGING_UPLOAD` — large artifacts (~90 MB zips) exceed Cloudflare's ~100s proxy timeout; re-enable via a Cloudflare-bypass upload origin or presigned MinIO URLs. Does not affect this gate item.

**Exit result:** `Engineering Candidate`

## Phase 2 — Local security hardening

**Goal:** Protect the node, credentials, and configuration on realistic plant networks.

### Work

- [x] Produce a threat model covering local UI, APIs, cloud communication, protocols, backups, and updates. Evidence: [PULSE_Edge_Threat_Model.md](PULSE_Edge_Threat_Model.md).
- [ ] Enforce TLS for external communication and define certificate trust behavior.
- [ ] Encrypt cloud keys at rest. *(Narrowed by R-008: protocol/device credentials are deliberately left plaintext and backup-recoverable; only cloud keys — `ApiKey`, `ClaimSecret`, `PairingToken` — are encrypted at rest.)*
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
- [ ] No plaintext **cloud** secret appears in logs, exports, or diagnostic bundles. *(Per R-008, protocol/device credentials are excluded from this check by design.)*
- [ ] Malformed, oversized, and tampered backup files are rejected safely.
- [ ] Production TLS verification cannot be bypassed.
- [ ] Dependency, static-analysis, and secret scans pass.
- [ ] The threat model has no unresolved critical finding.

**Evidence:**

- Threat model: [PULSE_Edge_Threat_Model.md](PULSE_Edge_Threat_Model.md) — STRIDE-per-boundary register (23 threats), decomposed hardening backlog (16 items), and the Slice 2A–2D implementation sequence. No Critical finding after verified review; B-06 (setup-window) accepted as R-009, so the highest open (unaccepted) severity is High (B-03 HTTP-default cookie, addressed in Slice 2B).
- Slice 2A (response & authorization hygiene): merged ([PR #12](https://github.com/phynaro/pulse-edge/pull/12)) — explicit Admin guards + authorization-matrix test (B-02), dashboard pairing fields restricted to Admin (B-01), security headers + configurable CORS (B-04), IP-based login throttling (B-05), on a new `WebApplicationFactory` integration-test harness. Five per-task reviews + a whole-branch review (clean); backend suite 65/65.
- Slice 2B (transport security): merged ([PR #13](https://github.com/phynaro/pulse-edge/pull/13)) — local self-signed HTTPS on :5288 + forced-Secure cookie (B-03), enforced cloud HTTPS (B-08), systemd sandboxing + network-hardening doc (B-14), config-gated anti-spoof forwarded headers. Five per-task reviews + a whole-branch review (Opus); dev-fallout fixes (Vite proxy, launchSettings, Development cookie policy). Manual smokes pending: published-build HTTPS browser check; `systemd-analyze security`.
- Slice 2C (secrets at rest, redaction & rotation): designed + planned — [design spec](superpowers/specs/2026-07-14-slice-2c-secrets-at-rest-design.md), [implementation plan](superpowers/plans/2026-07-14-slice-2c-secrets-at-rest.md); not yet executed (B-07 cloud-key encryption via DataProtection, B-09 backup hardening, B-10 redaction assurance, B-12 rotation runbook; B-11 accepted as R-010).
- Endpoint authorization test report: `AuthorizationMatrixTests` (5 endpoints × anonymous→401 / ReadOnly→403), merged in PR #12.
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
| 2026-07-12 | G1 | In progress | The repository is public; `main` protection requires all four Quality jobs and one approval. Temporary PR #2 deliberately failed frontend lint and GitHub blocked it. The proof PR and branch were removed after evidence capture. | Complete remaining frontend/auth/backup/browser coverage, release-tag metadata and release enforcement, then obtain the authorized G1 review. |
| 2026-07-12 | G0 | Blocked | The project owner chose to defer Windows deployment/certification (R-006) and target Linux for near-term gate work. No G0 check was waived; Windows validation remains required if Windows returns to the supported-platform scope. | Close the Linux-target G0 items (support matrix, capacity thresholds, accepted-limitations sign-off) and run the load/outage/recovery fixture; keep progressing G1 in parallel under the existing sequencing exception. |
| 2026-07-12 | G1 | In progress | Added Testing Library + jsdom frontend infrastructure and component tests for the local authentication (LoginScreen, AuthProvider) and configuration backup/restore (ConfigurationBackupPanel) flows; the UI suite is 20 tests and lint/build/test pass locally. Browser/device-modal coverage deferred to the G8 end-to-end scope. | Push and attach the hosted CI run as evidence, then complete release-tag metadata and the release-creation enforcement item before requesting the authorized G1 review. |
| 2026-07-13 | G1 | In progress | Tag-triggered `release.yml` gates a versioned Linux build/publish on the reusable Quality checks. Enforcement proof (run 29237934034): a failed check left `publish` skipped, no release. Happy path (run 29257973968): a passing tag produced a GitHub Release with the arm64 `.deb`, per-arch zips, and SHA256SUMS. All G1 gate checks now have evidence. MinIO staging upload is paused behind `ENABLE_STAGING_UPLOAD` pending a Cloudflare-bypass upload path. | Obtain the authorized G1 gate review to mark the phase Passed. |
| 2026-07-13 | G1 | Passed | All seven G1 checks have durable evidence (clean CI build, backend+frontend pipelines pass, no unaccepted high/critical vuln, no compiler warnings, artifacts carry version/commit/build metadata, SBOM retained, and a failed required check structurally blocks release creation — proven by run 29237934034). The project owner authorized the pass and waived the formal multi-reviewer panel. | Proceed to Phase 2 (G2). MinIO staging upload remains paused (R-007); does not affect this gate. |
| 2026-07-13 | G2 | In progress | Phase 2 opened. Threat model delivered ([PULSE_Edge_Threat_Model.md](PULSE_Edge_Threat_Model.md)): STRIDE per trust boundary, 23 threats, 16-item decomposed backlog, Slice 2A–2D sequence. One Critical finding (B-01: `PairingToken`/`ClaimSecret` returned plaintext by the anonymous `/api/dashboard`). Decision R-008 recorded (device creds stay plaintext + backup-recoverable; the "encrypt … protocol credentials" gate item is narrowed to cloud keys only). | Execute Slice 2A (B-01, B-02, B-04, B-05, B-06), starting with the Critical finding B-01. |
| 2026-07-13 | G2 | In progress | Threat-model finding reassessed against the code: the B-01 "Critical" (pairing secret readable anonymously) was overstated. `/api/dashboard` is auth-gated once the device is commissioned (`CurrentUserValidationMiddleware.cs:51-59`) and `ClaimSecret` is never returned to any client. B-01 corrected to Medium (restrict pairing fields to the Admin role); the residual anonymous exposure exists only during the pre-first-admin setup window and folds into B-06. **No Critical finding remains.** | Proceed with Slice 2A in corrected priority order: B-06, B-02, B-01, B-04, B-05. |
| 2026-07-13 | G2 | In progress | Project owner accepted the setup-window risk (R-009); B-06 is dropped, no mechanism implemented. Slice 2A trimmed to four items: B-02 (explicit authz + matrix test), B-01 (restrict pairing fields to Admin), B-04 (security headers + configurable CORS), B-05 (IP login throttling). | Write and execute the Slice 2A implementation plan. |
| 2026-07-14 | G2 | In progress | Slice 2A merged to `main` (PR #12): B-02/B-01/B-04/B-05 plus a `WebApplicationFactory` integration-test harness; five per-task reviews + a whole-branch review (Opus) clean; 65/65 backend tests. Slice 2B (transport security) designed, planned, and in execution. | Execute Slice 2B (B-03 local HTTPS + Secure cookie, B-08 enforced cloud HTTPS, forwarded headers, B-14 systemd/docs), then Slices 2C/2D. |
| 2026-07-14 | G2 | In progress | Slice 2B merged to `main` (PR #13): local HTTPS on :5288 + forced-Secure cookie (B-03), enforced cloud HTTPS (B-08), systemd sandboxing + network-hardening doc (B-14), config-gated forwarded headers; five per-task reviews + whole-branch review (Opus); HTTPS-switch dev fallout fixed (Vite proxy, launchSettings, Development cookie policy). Slice 2C (secrets at rest) designed + planned, not yet executed. | Execute Slice 2C (B-07 cloud-key encryption, B-09 backup hardening, B-10 redaction, B-12 rotation), then Slice 2D (gate test sweep + G2 review). Complete the 2B manual smokes before the gate. |

## Decision and risk log

Use this section for decisions or risks that materially change scope, sequence, or acceptance criteria.

| ID | Date | Type | Description | Owner | Due | Status |
|---|---|---|---|---|---|---|
| R-001 | 2026-07-12 | Risk | Host storage improved from 99% with approximately 3.6 GiB available to 94% with approximately 12.6 GiB available. PULSE database files total less than 10 MiB. Continue host monitoring; product thresholds and retention remain Phase 4 work. | Operations / Engineering | Ongoing | Mitigated / monitor |
| R-002 | 2026-07-12 | Risk | Earlier high-severity NuGet advisories are not present in the current restored graph; continuous scanning is still required in CI. | Engineering | 2026-07-12 | Closed |
| R-003 | 2026-07-12 | Risk | The frontend lint baseline of 48 errors and 2 warnings was remediated without disabling the rules; production build and interaction smoke checks pass. | Engineering | 2026-07-12 | Closed |
| R-004 | 2026-07-12 | Risk | Repository CI and runtime pins are now implemented, but the first hosted run and frontend automated tests remain open. This is not Windows certification evidence. | Engineering | TBD | Mitigated / open |
| R-005 | 2026-07-12 | Risk | A default macOS source archive emitted AppleDouble `._*` files that fail C# compilation on Linux. Clean-room packaging passes with `COPYFILE_DISABLE=1`; release packaging must exclude host metadata deterministically. | Engineering | TBD | Open |
| R-006 | 2026-07-12 | Decision | Defer Windows deployment and certification for now; target Linux for near-term gate work. Narrows current supported-platform scope to Linux without waiving any gate check. Windows validation (G0 matrix + `PULSE_Edge_Windows_Deployment_Specification.md`) and G8 Windows installer/repair/uninstall tests must be reinstated before any Windows-supporting production release. | Engineering + stakeholders | TBD | Open |
| R-007 | 2026-07-13 | Decision | Automated release upload to the MinIO/`pulse.trazor.cloud` staging repo is paused (gated behind repo variable `ENABLE_STAGING_UPLOAD`). Cause: self-contained artifacts (~90 MB zips, ~70 MB `.deb`) exceed Cloudflare's ~100s proxy timeout (524) when PUT through the API. Releases currently publish to GitHub Release only. Re-enable via a Cloudflare-bypass upload origin or presigned MinIO URLs (optionally drop the redundant Agent binary from SinglePort packages to shrink size). Does not affect G1 (release-creation enforcement is proven). | Engineering | TBD | Open |
| R-008 | 2026-07-13 | Decision | Protocol/device credentials (`DriverAdapter.ConfigJson` — PLC/OPC UA/Modbus/MQTT passwords) are deliberately kept **plaintext and backup-recoverable**; they are not encrypted at rest and not redacted from configuration backups. Rationale: these local OT-device credentials are frequently the only copy maintenance staff hold, and encryption with a losable key would strand the entire configuration; the devices sit on the customer-controlled OT network (edge_security_pillars.md Pillar 4). This **narrows the G2 gate item** "Encrypt cloud keys and protocol credentials at rest" to **cloud keys only** and excludes device credentials from the "no plaintext secret in logs/exports/bundles" check. Accepted consequence: a leaked backup or stolen appliance exposes device credentials. Cloud credentials (`ApiKey`, `ClaimSecret`, `PairingToken`) remain in scope for at-rest encryption and response redaction. | Engineering + project owner | Accepted | Accepted |
| R-009 | 2026-07-13 | Decision | Setup-window trust-on-first-use (threat-model T-04/B-06) is **accepted**; no hardening mechanism (setup claim token / loopback-only first-admin / bounded window) is implemented. Rationale: the pre-first-admin window is brief, occurs during physical install on an operator-controlled network, and the mechanisms add commissioning friction not justified for this deployment context. Accepted consequence: during that window a LAN client could read the pairing token or claim the first admin; mitigated operationally by commissioning on a controlled/isolated network. Removes B-06 from the Slice 2A scope. | Project owner | Accepted | Accepted |

## Review cadence

- **Weekly:** update phase status, next action, owners, targets, and risks.
- **At each merge:** attach relevant automated evidence to the current phase.
- **Before a gate review:** replace all applicable `TBD` evidence entries with durable links or repository paths.
- **At each release:** update the milestone, archive the evidence package, and record the gate decision.

To resume Phase 0 with Windows deferred (R-006), assign the four gate reviewers and a target date, accept or revise the baseline drafts, create an immutable candidate commit, and schedule the representative load/outage/recovery exercise on the Linux target. The Windows validation packet is paused and reinstated when Windows returns to scope. R-001 remains mitigated but monitored. Phase 1 implementation proceeds under the recorded sequencing exception.
