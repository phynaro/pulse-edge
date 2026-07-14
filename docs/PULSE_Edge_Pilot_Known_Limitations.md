# PULSE Edge Pilot Known Limitations

**Status:** Draft for acceptance  
**Roadmap:** Phase 0 / Gate G0  
**Last reviewed:** 2026-07-12

This register defines the known boundaries of the current pilot candidate. It is not a waiver for production. Each limitation must be accepted for the pilot, mitigated before deployment, or promoted into a roadmap work item.

## Deployment and lifecycle

### L-001 — Windows is the only defined deployment target

The deployment specification covers Windows 10/11 Pro and Windows Server 2019/2022. Linux and macOS service installation, permissions, upgrades, and recovery are not certified.

**Pilot control:** Deploy only on an approved Windows x64 profile.  
**Production disposition:** Phase 0 support-matrix approval and Phase 8 platform certification.

### L-002 — Signed update and automatic rollback are not yet proven

The Windows deployment specification requires signed packages and rollback behavior, but the current G0 evidence does not demonstrate an implemented, interruption-safe update path.

**Pilot control:** Perform attended upgrades with a verified configuration backup and documented rollback window.  
**Production disposition:** Phase 6 / G6.

### L-003 — Second-environment reproducibility is unverified

The solution builds on the current development workstation, but no clean second Windows environment has produced equivalent evidence.

**Pilot control:** Do not treat the workstation build as installer certification.  
**Production disposition:** Required before G0 passes.

## Security

### L-004 — TLS enforcement is incomplete

The API defaults to `http://*:5288`, and the onboarding contract explicitly identifies TLS enforcement as pre-pilot hardening. Session-cookie security follows the request scheme, so an HTTP deployment does not produce a secure-only cookie.

**Update (Slice 2B):** The local UI now defaults to HTTPS on `:5288` with a self-signed certificate generated on first boot, and the session cookie is forced `Secure`. The cloud uplink endpoint is enforced to HTTPS at both the settings API and the `CloudClient` chokepoint. The residual gap is the one-time self-signed browser warning (no trusted cert issued yet) and HSTS, which is intentionally withheld until a trusted certificate is configured. See `docs/PULSE_Edge_Network_Hardening.md` for deployment guidance (network placement, bind address, firewall, systemd sandboxing).

**Pilot control:** Bind the management interface to a trusted network segment and terminate TLS at an approved reverse proxy. Do not expose the node directly to an untrusted network.  
**Production disposition:** Phase 2 / G2.

### L-005 — Login protection is account-based, not a complete rate-limit control

Five failed attempts lock a known account for 15 minutes, but there is no demonstrated IP/device-wide request rate limiter. Unknown usernames can still generate repeated login work and audit records.

**Pilot control:** Restrict management-network access and monitor authentication failures.  
**Production disposition:** Phase 2 / G2.

### L-006 — Configuration backup files may contain credentials

The backup payload includes adapter `ConfigJson`, and the UI warns that protocol credentials may be included. The JSON backup is checksummed for integrity but is not encrypted.

**Pilot control:** Treat `.pulsebackup.json` files as secrets; store them in access-controlled encrypted storage and never attach them to ordinary support tickets.  
**Production disposition:** Phase 2 backup protection and Phase 5 redacted support tooling.

### L-007 — Local configuration integrity uses an unkeyed hash

The Windows configuration check compares `config.json` with a neighboring SHA-256 file. This detects accidental mismatch but does not prove authenticity if an attacker can replace both files.

**Pilot control:** Protect the PULSE ProgramData directory with Windows ACLs and monitor changes.  
**Production disposition:** Phase 2 threat-model decision and Phase 6 signed artifact/configuration design.

## Reliability and capacity

### L-008 — Capacity limits have not been measured

The proposed tag, stream, polling, outage, and recovery limits in the pilot baseline profile are starting targets, not verified limits.

**Pilot control:** Keep the pilot within the proposed envelope and capture CPU, memory, queue, polling, and delivery measurements.  
**Production disposition:** G0 baseline measurements and G8 capacity validation.

### L-009 — Disk pressure is displayed but not actively governed

The dashboard calculates disk use, and application logs are limited to 30 files of up to 10 MiB each. No current evidence demonstrates queue quotas, database size limits, remaining-time estimation, or emergency shedding behavior.

The host initially had approximately 3.6 GiB available at 99% capacity. A later repeatable snapshot showed approximately 12.6 GiB available at 94%. PULSE database files total less than 10 MiB, so current pressure is primarily external to PULSE but remains operationally significant.

**Pilot control:** Free host storage before extended testing; set an external disk alert; inspect disk and queue depth daily.  
**Production disposition:** Phase 4 / G4.

### L-010 — Backup restore coverage is not yet end-to-end

The implementation provides checksum, format, uniqueness, and reference validation and uses a database transaction when replacing configuration. An isolated automated round trip now proves current-version portable configuration restoration while identity, users, and queued records remain preserved. Browser download behavior, endpoint authorization, acquisition restart, and cross-version migration are not yet covered by that test.

**Pilot control:** Exercise the UI/API path and acquisition recovery on a disposable pilot node before field use.  
**Production disposition:** Endpoint E2E coverage continues in G1/G8; cross-version coverage continues in G3 and G6.

### L-011 — Store-and-forward guarantees are not yet an approved contract

Offline telemetry/event queues exist, but ordering, deduplication, poison-message handling, maximum outage capacity, and recovery-time guarantees have not passed G4.

**Pilot control:** Monitor queue depth and oldest-record age during every cloud interruption and preserve incident evidence.  
**Production disposition:** Phase 4 / G4.

## Protocol and data-model boundaries

### L-012 — Device interoperability is implementation-level, not certified

Protocol projects exist for OPC UA, Modbus, MQTT, EtherNet/IP, Siemens S7, BACnet, and REST, but the manufacturer/model/firmware test matrix is not yet populated.

**Pilot control:** Validate every target device and record its exact model, firmware, security mode, data types, and reconnect behavior before commissioning.  
**Production disposition:** G0 support matrix and G8 mixed-protocol validation.

### L-013 — Modbus string values are not supported

The Modbus implementation and UI explicitly reject or warn about string register data. Supported numeric/register mappings must be used.

**Pilot control:** Exclude Modbus string tags or model them as an explicitly decoded register block outside the current standard workflow.  
**Production disposition:** Product decision; implement only if required by the approved device matrix.

## Engineering and support

### L-014 — Frontend lint gate is currently red

The 2026-07-12 lint run reports 48 errors and 2 warnings. The production frontend build succeeds, but lint cannot yet act as a required green quality gate.

**Pilot control:** Require successful TypeScript/Vite builds and track lint regressions against the recorded baseline.  
**Production disposition:** Phase 1 / G1.

### L-015 — CI and automated browser commissioning evidence are absent

No repository CI workflow was found during the baseline review. Backend tests run locally, while onboarding, backup/restore, role authorization, and configuration workflows lack recorded browser E2E evidence.

**Pilot control:** Use a written commissioning checklist and archive manual test results for each pilot release.  
**Production disposition:** Phase 1 CI and Phase 8 browser E2E validation.

### L-016 — The `/health` endpoint is process-level only

The current `/health` response reports a static healthy state and does not prove database, queue, protocol, storage, or cloud readiness.

**Pilot control:** Use the dashboard and diagnostic logs in addition to process monitoring.  
**Production disposition:** Phase 5 / G5 structured health checks.

## Accepted risks

- **R-010 — Config integrity hash is unkeyed (Windows-only, accepted).** The `config.json.sha256`
  integrity check detects accidental change but not authenticated tampering. It is Windows-only,
  and Windows deployment is deferred (R-006), so this is accepted as a documented risk. Reinstate a
  keyed MAC (e.g. HMAC keyed by the DataProtection key) when Windows returns to the supported scope.

## Pilot acceptance

Acceptance means the pilot stakeholders understand the limitations and controls; it does not close the corresponding production work.

| Role | Name | Decision | Date | Notes or rejected limitations |
|---|---|---|---|---|
| Product | TBD | Pending | TBD | |
| Engineering | TBD | Pending | TBD | |
| Operations | TBD | Pending | TBD | |
| Security | TBD | Pending | TBD | |
