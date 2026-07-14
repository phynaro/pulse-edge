# PULSE Edge Threat Model

This is the security threat model for the PULSE Edge appliance. It supports Phase 2 (Local
security hardening / Gate G2) of the [Production Readiness Roadmap](PULSE_Edge_Production_Readiness_Roadmap.md).

**Method:** STRIDE applied per trust boundary. For each boundary we walk the six threat
categories — **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure,
**D**enial of service, **E**levation of privilege — and record the threat, the mitigation that
*already exists in the code*, the residual risk, and the backlog item that closes it. This is the
security equivalent of an FMEA: the "components" are the interfaces where trust changes hands.

**How to read this document:**
- §1–2 model the system, its assets, and realistic adversaries.
- §3 is the threat register — the systematic per-boundary walk.
- §4 is the prioritized, decomposed hardening backlog (the real output).
- §5 groups the backlog into shippable implementation slices, each of which gets its own
  spec → plan → implement cycle.
- §6 records accepted risks and the gate-coverage map.

Status references (`file:line`) reflect the code map taken on 2026-07-13; verify before
implementing, as line numbers drift.

**Correction (2026-07-13):** an initial draft rated T-03 / B-01 as **Critical** based on an
incomplete reading of the auth middleware. On verification, `/api/dashboard` is auth-gated once
the device is commissioned (`CurrentUserValidationMiddleware.cs:51-59`) and `ClaimSecret` is
never returned to any client. T-03 / B-01 are corrected to **Medium** (restrict the pairing
fields to Admin), and the residual anonymous exposure — which exists only during the
pre-first-admin setup window — is folded into T-04 / B-06. **No Critical finding remains.**
T-04 / B-06 was subsequently **accepted** as risk **R-009** (no mechanism implemented — see §6).

---

## 1. Scope and system model

PULSE Edge is an on-premise industrial edge appliance. It polls plant-floor devices (PLCs,
meters, gateways) over multiple protocols, buffers telemetry in a local SQLite database, and
forwards it to PULSE Cloud with store-and-forward reliability. A local web UI handles
commissioning, data binding, and diagnostics. In production it runs in **SinglePort** mode: one
ASP.NET Core process (Kestrel, `:5288`) serves the REST API, hosts the acquisition Worker, and
serves the embedded React UI.

### Data flow

```text
                         ┌─────────── the appliance (one host) ───────────┐
  Browser ──cookie───────┤ Kestrel API :5288 ── Worker/DriverPollers       │
  (commissioning UI)  TB1 │        │                    │  TB4              │──TB3──> PULSE Cloud
                         │        │ TB2                │                   │  (HTTPS + bearer)
                         │   SQLite edge.db      OT devices (PLC/meter)    │
                         │   (telemetry, config,  OPC UA/Modbus/MQTT/...   │
                         │    credentials)                                 │
                         └───────────┬─────────────────────────────────────┘
                              TB5 backup files (export/import)
                              TB6 update packages / installers
```

### Trust boundaries

| ID | Boundary | What crosses it |
|----|----------|-----------------|
| **TB1** | Browser ↔ local API | Admin/ReadOnly session cookie, config changes, credentials entered during commissioning |
| **TB2** | Application ↔ SQLite (data at rest) | Cloud credentials, device credentials, telemetry, configuration, local user store |
| **TB3** | Edge ↔ PULSE Cloud (uplink) | Telemetry payloads, bearer API key, device registration |
| **TB4** | Edge ↔ OT devices (protocol drivers) | Device credentials, read/write commands on the automation network |
| **TB5** | Backup files (export/import) | Full configuration incl. device credentials, in a portable JSON file |
| **TB6** | Update packages / installers | Executable code that runs with service privileges |
| **TB7** | Host OS / process privileges | The service account's rights on the machine |

### Out of scope

- **PULSE Cloud platform security** — the cloud side is a separate product with its own threat
  model. This document ends at the edge's outbound TLS connection.
- **Physical network segmentation** (VLANs, air-gaps) — the customer owns their plant network.
  We document our *requirements* on it (§3, TB4/TB7) but cannot enforce them from the product.
- **Physical tamper-resistance of the hardware enclosure** — a deployment/procurement concern.
- **Update/rollback *implementation*** — the *threats* are enumerated here (TB6) for
  completeness per the G2 gate, but the mitigations are Phase 6 (Gate G6) work.

---

## 2. Assets and adversaries

### Assets worth protecting

| ID | Asset | Why it matters | Confidentiality need |
|----|-------|----------------|----------------------|
| **A1** | Cloud credentials — `ApiKey`, `ClaimSecret`, `PairingToken` (`DeviceConfig`) | Identity of this device to the cloud tenant. Leak → impersonate device, push forged telemetry, or claim the device. Re-issuable from cloud (low "forgotten" value). | **High** |
| **A2** | Protocol / device credentials (`DriverAdapter.ConfigJson`) | Log into PLCs/meters on the OT net. Often the only record maintenance has. | **Accepted plaintext** — see R-008 |
| **A3** | Buffered + in-transit telemetry | Plant production data; commercially sensitive. | Medium |
| **A4** | Configuration (adapters, tags, streams, users) | Loss/tamper disrupts acquisition. | Medium |
| **A5** | Local admin session & user store | Controls the whole appliance. | High |
| **A6** | The edge host as a network position | Sits astride IT (cloud) and OT (PLC) networks — a tempting pivot. | High (integrity/isolation) |
| **A7** | Audit & diagnostic logs | Incident forensics; must not themselves leak secrets. | Medium |

### Adversaries

| ID | Adversary | Capability | Realism |
|----|-----------|-----------|---------|
| **ADV1** | Careless/malicious floor insider | Local UI access, maybe an unattended logged-in browser | High — the original reason local auth exists |
| **ADV2** | Network attacker on the plant LAN | Can reach `:5288`, sniff unencrypted traffic | High on flat/shared plant networks |
| **ADV3** | Thief of the physical appliance | Offline read of the SQLite file and config | Medium — small, unattended box |
| **ADV4** | Holder of a leaked backup file | Reads an exported `.json` backup | Medium — backups get emailed/USB-copied |
| **ADV5** | Man-in-the-middle on the cloud uplink | Intercepts edge→cloud traffic | Low–Medium (depends on egress path) |
| **ADV6** | Supply-chain / tampered-update attacker | Substitutes a malicious update/installer | Low now, High impact — Phase 6 |

### Adversary goals (prioritization framing)

1. **Steal cloud credentials (A1)** → impersonate the device / forge telemetry.
2. **Seize the local admin session (A5)** → reconfigure or disable acquisition.
3. **Pivot from the edge into the OT network (A6)** → reach PLCs directly.
4. **Exfiltrate telemetry or configuration (A3/A4)**.

The register below is organized for *coverage* (every boundary × STRIDE), but severity ratings
are anchored to these goals.

---

## 3. Threat register

Severity = likelihood × impact in this deployment context (flat plant LAN, small unattended
box, HTTP default today). `B-xx` = backlog item in §4. Threats whose mitigation is a later gate
are marked with their target phase.

### TB1 — Browser ↔ local API

| ID | STRIDE | Threat | Current mitigation (code) | Residual risk | Severity | Backlog |
|----|--------|--------|---------------------------|---------------|----------|---------|
| T-01 | S | Password guessing / spray against admin login | PBKDF2-SHA256, 210k iterations, 16-byte salt, fixed-time compare (`PasswordService.cs`); 5-attempt / 15-min per-account lockout (`AuthEndpoints.cs`) | No **IP-based** throttling — an attacker can spray *many* usernames, or hammer login to cause lockouts (DoS of a real user) | Medium | B-05 |
| T-02 | I | Session cookie sniffed on the LAN | `HttpOnly` + `SameSite=Strict`; 8h sliding expiry (`Program.cs`) | `SecurePolicy = SameAsRequest` + **HTTP default** → cookie transmitted in clear on plain-HTTP deployments | High | B-03 |
| T-03 | I | Cloud/pairing fields (`PairingToken`, pairing URLs) returned by `/api/dashboard` are visible to **any authenticated user, including ReadOnly** — pairing is an Admin function | Endpoint is auth-gated once `hasUsers == true` (`CurrentUserValidationMiddleware.cs:51-59`); `ClaimSecret` is never returned to any client | A ReadOnly local operator can read the pairing token. Anonymous exposure exists **only during the pre-first-admin setup window** (see T-04) | Medium | B-01 |
| T-04 | S/E/I | Setup-window trust-on-first-use — during commissioning (`hasUsers == false`), `/api/dashboard` is anonymous (exposing the pairing token) **and** any network client can POST `/api/auth/first-admin` | Setup-status gate only; the window closes the moment the first admin exists | **Accepted (R-009):** window is brief, during install, on an operator-controlled network | Accepted | — |
| T-05 | E | Reset endpoints (factory/soft reset) rely on the middleware mutation rule, not an explicit role check | Middleware requires `Admin` for all non-GET (`CurrentUserValidationMiddleware.cs`) | Fragile defense-in-depth: a future middleware-order change silently exposes destructive endpoints | Medium | B-02 |
| T-06 | T/E | Clickjacking, MIME-sniffing, injected content | None | No `CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` | Medium | B-04 |
| T-07 | D | Flooding of unauthenticated endpoints (login, dashboard, webhooks, diagnostic ingest) | None specific | Local DoS; resource exhaustion | Low–Medium | B-05 |
| T-08 | S | Cross-origin request abuse | `SameSite=Strict` cookie; CORS limited to `localhost:8080` (`Program.cs`) | CORS origins hardcoded, not deployment-configurable | Low | B-04 |

### TB2 — Application ↔ SQLite (data at rest)

| ID | STRIDE | Threat | Current mitigation (code) | Residual risk | Severity | Backlog |
|----|--------|--------|---------------------------|---------------|----------|---------|
| T-09 | I | **Physical theft → read cloud credentials** from `edge.db` (plaintext) | None — standard `UseSqlite()`, no SQLCipher (`QueueDbContext.cs`) | ADV3 reads `ApiKey`/`ClaimSecret`/`PairingToken` (A1) offline | High | B-07 |
| T-10 | I | Physical theft → read device credentials from `ConfigJson` | None | **Accepted** (R-008): recoverability is intended | Accepted | — |
| T-11 | T | Offline tampering of config; Windows `config.json` integrity hash is **unkeyed** SHA-256 | `config.json.sha256` detects accidental change (`Program.cs`) | ADV3 can edit both file and hash together (L-007) | Low–Medium | B-11 |

### TB3 — Edge ↔ PULSE Cloud

| ID | STRIDE | Threat | Current mitigation (code) | Residual risk | Severity | Backlog |
|----|--------|--------|---------------------------|---------------|----------|---------|
| T-12 | I | MitM reads telemetry + bearer key on the uplink | Default .NET TLS chain/hostname validation; **no** cert-validation bypass found (`CloudClient.cs`) | Cloud endpoint may be configured as `http://` — only a scheme check exists, not enforcement (`SettingsEndpoints.cs`) | High (if misconfigured) | B-08 |
| T-13 | S | Stolen static bearer API key → impersonate device | Bearer sent over TLS | No mTLS; no key rotation or expiry | Medium | B-12, B-13 (deferred) |
| T-14 | R | No rotation → a leaked key stays valid indefinitely | None | Cannot cheaply invalidate a suspected-leaked key from the edge | Medium | B-12 |

### TB4 — Edge ↔ OT devices

| ID | STRIDE | Threat | Current mitigation (code) | Residual risk | Severity | Backlog |
|----|--------|--------|---------------------------|---------------|----------|---------|
| T-15 | E | Edge used as a **pivot** from IT into the OT network (A6) | Deployment-level segmentation expected (Pillar 4) | Product cannot enforce customer network topology; must *document* the requirement and default to least exposure | High (impact) | B-14 |
| T-16 | I/T | OPC UA `None` security policy permitted → device traffic unencrypted/unauthenticated | Driver-dependent | Enforcing `SignAndEncrypt` (`Basic256Sha256`) not yet mandatory | Medium | B-15 (deferred) |

### TB5 — Backup files

| ID | STRIDE | Threat | Current mitigation (code) | Residual risk | Severity | Backlog |
|----|--------|--------|---------------------------|---------------|----------|---------|
| T-17 | I | Leaked backup exposes **device** credentials (A2) | SHA-256 checksum; user warning "treat as secrets" (L-006) | **Accepted** (R-008): recoverability is intended | Accepted | — |
| T-18 | I | Leaked backup exposes **cloud** credentials (A1) | `ApiKey` excluded from restore-preserved fields (`ConfigurationBackupService.cs`) | Must **confirm** cloud creds are excluded from *export*, not just restore | High | B-09 |
| T-19 | T/D | Malicious oversized/malformed backup on import | Checksum + referential-integrity checks; transactional restore (`ConfigurationBackupService.cs`) | **No size limit**; schema validation is presence-only | Medium | B-09 |
| T-20 | E | Restore endpoints (`inspect`, `apply`) lack an explicit Admin guard | Middleware mutation rule | Same fragility as T-05 | Medium | B-02 |

### TB6 — Update packages (threats enumerated; mitigations are Phase 6 / G6)

| ID | STRIDE | Threat | Current mitigation | Residual risk | Severity | Backlog |
|----|--------|--------|--------------------|---------------|----------|---------|
| T-21 | T | Tampered/unsigned update package executes as service | None yet | ADV6 achieves code execution | High (impact) | B-16 (Phase 6) |
| T-22 | E | Update process runs with excessive privilege | None yet | Amplifies any update compromise | Medium | B-16 (Phase 6) |

### TB7 — Host OS / process privileges

| ID | STRIDE | Threat | Current mitigation | Residual risk | Severity | Backlog |
|----|--------|--------|--------------------|---------------|----------|---------|
| T-23 | E | Service runs as root/Administrator → any RCE becomes host takeover | Installer-dependent | Least-privilege service account not yet enforced (Pillar 5) | Medium | B-14 |

---

## 4. Security hardening backlog

Prioritized and decomposed. Each item names the G2 gate check(s) it advances and its target
slice (§5). Effort is rough (S/M/L).

| ID | Sev | Eff | Item | Closes threat | G2 gate check advanced |
|----|-----|-----|------|---------------|------------------------|
| **B-01** | Medium | S | Restrict the cloud/pairing fields (`PairingToken`, pairing URLs) in `/api/dashboard` to the Admin role — currently visible to any authenticated user incl. ReadOnly. (`ClaimSecret` is already never returned.) | T-03 | Read-only users cannot read pairing credentials; least-privilege on responses |
| **B-02** | High | M | Endpoint authorization audit: add explicit `IsInRole("Admin")` guards on every mutating endpoint (reset, restore) + an automated test asserting the authz matrix for every route | T-05, T-20 | Verify admin/read-only authorization on every endpoint; read-only users cannot mutate |
| **B-03** | High | M | TLS for the local UI: HTTPS binding (self-signed cert generated on install) or documented reverse-proxy TLS; force cookie `Secure`; add HSTS | T-02 | Enforce TLS; secure cookie settings; production TLS cannot be bypassed |
| **B-04** | Medium | S | Security-headers middleware (`CSP`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) + make CORS origins deployment-configurable | T-06, T-08 | Restrictive CORS and security headers |
| **B-05** | Medium | M | IP-based login throttling in addition to per-account lockout | T-01, T-07 | Add login throttling; brute-force protection verified automatically |
| ~~B-06~~ | Accepted | — | **Accepted risk (R-009)** — setup-window trust-on-first-use is accepted; no mechanism (setup token / loopback-only / bounded window) implemented | T-04 | (accepted — see R-009) |
| **B-07** | High | L | Encrypt **cloud** credentials (A1) at rest via the OS credential store (Linux keyring / `systemd-creds`; DPAPI when Windows returns). **Not** whole-DB, **not** device creds. **Open decision:** Linux key-management mechanism | T-09 | Encrypt cloud keys at rest (narrowed — see R-008) |
| **B-08** | High | S | Enforce `https://` for the cloud endpoint (reject `http://` except localhost dev) and define certificate-trust behavior | T-12 | Enforce TLS for external communication; define certificate trust |
| **B-09** | Medium | M | Backup hardening: confirm cloud creds excluded from **export**; add size limit + real schema validation; explicit Admin authz on `inspect`/`apply` | T-18, T-19 | Validate backup size, schema, content, integrity before import |
| **B-10** | Medium | S | Redaction verification: prove logs/exports/diagnostic bundles never contain **cloud** creds (device creds accepted per R-008); confirm the existing regex sink covers JSON/JWT shapes | — (assurance) | Redact secrets from logs, exports, support bundles |
| **B-11** | Low | S | Replace unkeyed config-integrity hash with a keyed MAC, **or** formally accept as a documented risk | T-11 | (defense-in-depth; may be accepted) |
| **B-12** | Medium | M | Credential + certificate rotation procedure (documented runbook + a re-key path from the edge) | T-13, T-14 | Add credential and certificate rotation procedures |
| **B-13** | — | L | **Deferred (Phase 2+):** mTLS client certificate for the cloud uplink. Large, cloud-coordinated (needs Cloud CA). Tracked, not in the G2 slice | T-13 | (future) |
| **B-14** | Medium | M | Document + default service binding, host-only/loopback option, firewall defaults, and least-privilege service account | T-15, T-23 | Document service binding and firewall defaults |
| **B-15** | — | M | **Deferred:** enforce OPC UA `SignAndEncrypt`/reject `None` policy across drivers | T-16 | (future / per-protocol) |
| **B-16** | — | L | **Deferred (Phase 6 / G6):** signed update packages + signature/checksum verification + least-privilege update | T-21, T-22 | (Gate G6) |

---

## 5. Proposed implementation slice sequence

Each slice is an independently-shippable unit that later gets its own spec → plan → implement
cycle. Ordered so the highest-severity, lowest-infrastructure work ships first.

**Slice 2A — Response & authorization hygiene** (quick wins, no new infrastructure)
> B-02, B-01, B-04, B-05 (priority order). *(B-06 was accepted as risk R-009 and dropped.)*
> Makes authorization explicit and tested (B-02), applies least-privilege to responses (B-01),
> and adds security headers/configurable CORS (B-04) + IP throttling (B-05) — all in-process
> changes. Highest risk-reduction per unit effort.

**Slice 2B — Transport security**
> B-03, B-08, B-14.
> Local UI TLS + forced-secure cookie + HSTS; enforced HTTPS to cloud; documented binding and
> firewall defaults. Establishes "TLS cannot be bypassed."

**Slice 2C — Secrets at rest, redaction & rotation**
> B-07, B-09, B-10, B-12 (and decide B-11).
> Cloud-credential encryption via the OS key store (carries the Linux key-management decision),
> backup hardening, redaction assurance, rotation procedure. The heaviest slice — B-07 is the
> single biggest item.

**Slice 2D — Verification & gate**
> Add the automated security tests the G2 gate demands (brute-force, endpoint-authz matrix,
> malformed/oversized-backup rejection, TLS-bypass negative test); confirm dependency /
> static-analysis / secret scans pass (some already run in CI from G1); re-review this threat
> model to confirm no unresolved Critical remains; request the G2 gate review.

**Deferred beyond G2:** B-13 (mTLS), B-15 (OPC UA hardening), B-16 (signed updates → Phase 6).

---

## 6. Accepted risks and gate-coverage map

### Accepted risks

| ID | Decision | Rationale | Consequence accepted |
|----|----------|-----------|----------------------|
| **R-008** | Device/protocol credentials (`DriverAdapter.ConfigJson`) remain **plaintext and backup-recoverable**; they are **not** encrypted at rest and are **not** redacted from backups | Local OT-device control credentials are frequently the only copy maintenance staff hold; encryption with a losable key would strand the entire configuration. The devices sit on the customer-controlled OT network (Pillar 4). Recoverability outweighs confidentiality for this asset class | A leaked backup (ADV4) or stolen box (ADV3) exposes **device** credentials. This **narrows the G2 gate item** "Encrypt cloud keys *and protocol credentials* at rest" to **cloud keys only** |
| **R-009** | Setup-window trust-on-first-use is **accepted** — no B-06 mechanism (setup token / loopback-only / bounded window) is implemented | The pre-first-admin window is brief, occurs during physical install, and on a network the operator controls at that moment; the mechanisms add commissioning friction not justified for this deployment context | During that window a network client (ADV2) could read the pairing token or claim the first admin. Mitigated operationally by commissioning on a controlled/isolated network |

> These decisions must also be recorded as **R-008** and **R-009** in the roadmap's Decision and
> risk log; for R-008 the G2 work item / gate wording is annotated to reflect the narrowed scope.

### G2 gate-coverage map

| G2 gate check | Covered by |
|---------------|-----------|
| Anonymous clients cannot access protected endpoints | B-01, B-02 (setup-window exposure accepted per R-009) |
| Read-only users cannot mutate state via direct API calls | B-02 (+ Slice 2D tests) |
| Brute-force protection is verified automatically | B-05 (+ Slice 2D tests) |
| No plaintext **secret** in logs/exports/bundles | B-10 (cloud creds; device creds accepted per R-008) |
| Malformed/oversized/tampered backups rejected safely | B-09 (+ Slice 2D tests) |
| Production TLS verification cannot be bypassed | B-03, B-08 |
| Dependency/static-analysis/secret scans pass | Slice 2D (builds on G1 CI) |
| Threat model has no unresolved critical finding | **No Critical finding remains** after verified review. B-06 (setup-window, was High) is accepted as R-009. Highest open (unaccepted) severity is High: T-02/B-03 (HTTP-default cookie, Slice 2B) |

---

## 7. Maintenance

Revisit this model when a new protocol driver, a new external interface, or the cloud-uplink
auth mechanism changes. Update the register and re-check the gate-coverage map before any G2
re-review. The `file:line` references are a 2026-07-13 snapshot — re-locate before implementing.
