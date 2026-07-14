# Slice 2C — Secrets at Rest, Redaction & Rotation (Design Spec)

Third implementation slice of **Phase 2 — Local security hardening (Gate G2)**. Where 2A hardened
authorization and 2B hardened transport, 2C protects **secrets at rest**: it encrypts the cloud
credentials in the local database, hardens the backup import path, proves secrets don't leak into
logs/exports, and documents credential rotation.

Backlog items: **B-07** (encrypt cloud keys at rest — the heavy one), **B-09** (backup hardening),
**B-10** (redaction assurance), **B-12** (rotation), plus a decision recorded for **B-11**.

## Decisions made during brainstorming (2026-07-14)

1. **B-07 scope = "basic" app-level encryption.** Encrypt only the three cloud-cred fields; use a
   simple on-disk key (no TPM / `systemd-creds` machinery). Full-disk-theft protection is a
   **documented deployment control (LUKS/TPM)**, not something the app self-provides.
2. **B-07 mechanism = .NET DataProtection**, applied **transparently via an EF Core value
   converter** so no call sites change. (Standard primitive — no hand-rolled AES; gives key
   rotation for B-12.)
3. **R-008 unchanged:** device/protocol credentials stay plaintext + backup-recoverable. B-07
   covers **only** the cloud creds.
4. **B-11 accepted as a risk (R-010):** the unkeyed `config.json.sha256` integrity check is
   Windows-only, and Windows is deferred (R-006). Record it; reinstate a keyed MAC when Windows
   returns to scope.

## Honest threat scope for B-07

The edge is a **headless service** that reads the cloud key **unattended** at every boot, so the
encryption key must live where the service can read it on its own — which means a thief with the
**whole disk** can read it too. Therefore:

- **App-level encryption closes:** a leaked/copied `edge.db` **without** the key (support bundles,
  stray DB files, partial backups, casual SQLite inspection). It also satisfies the G2 gate's
  "encrypt cloud keys at rest".
- **App-level encryption does NOT close:** full-disk theft of a running/powered box — that needs
  **LUKS full-disk encryption or a TPM**, a deployment-layer control, which we **document** but do
  not ship.

This is defense-in-depth with honest limits, not security theater: it's the difference between
"cloud creds visible in any DB dump" and "not".

## Components and build sequence

Five tasks, subagent-driven (implementer + task review each, whole-branch review at the end).

### Task 1 — Secret protector + transparent field encryption (B-07 core)

**New:** `src/Pulse.Edge.Storage/Security/ISecretProtector.cs` + `SecretProtection.cs` (the plain
interface and the process-static holder — in **Storage** so the `QueueDbContext` value converter can
reference them without an ASP.NET dependency). **New:** `src/Pulse.Edge.Api/Security/DataProtectionSecretProtector.cs`
(the concrete `IDataProtector`-backed implementation — in **Api**, which has DataProtection).
`Program.cs` configures DataProtection and sets `SecretProtection.Protector = new DataProtectionSecretProtector(...)`
at startup.

- Wire **DataProtection** at startup: `AddDataProtection().PersistKeysToFileSystem(<dataDir>/dp-keys).SetApplicationName("pulse-edge")`.
  The key ring persists to a `0600` directory under `PULSE_EDGE_DATA_DIR` (reuse the 2A
  resolution). On Windows the ring is DPAPI-encrypted automatically (future); on Linux the key is
  a restricted file (the "basic" root of trust).
- `ISecretProtector` with `string Protect(string plaintext)` and `string Unprotect(string stored)`
  where **`Unprotect` returns the input unchanged if it is not valid ciphertext** (legacy
  plaintext passthrough — detected by catching `CryptographicException` from the underlying
  `IDataProtector.Unprotect`). This is what makes upgrades seamless.
- **Wiring across the non-DI `QueueDbContext`:** the context is constructed with `new
  QueueDbContext()` throughout, so the protector is exposed via a **process-static holder**
  (`SecretProtection.Protector`), configured once at startup — the same pattern the codebase
  already uses for `PULSE_EDGE_DATA_DIR`. Tests configure it with an ephemeral DataProtection
  provider.

**Modify:** `src/Pulse.Edge.Storage/QueueDbContext.cs` (`OnModelCreating`).

- Add an EF Core **value converter** on `DeviceConfig.ApiKey`, `.ClaimSecret`, `.PairingToken`:
  - **to provider (save):** `SecretProtection.Protector.Protect(value)` → ciphertext in the DB.
  - **from provider (load):** `SecretProtection.Protector.Unprotect(stored)` → plaintext in memory
    (legacy plaintext passes through).
- Every existing reader (`config.ApiKey`, dashboard, settings, sync, provisioning) is unchanged —
  it still sees plaintext.

**Tests:** protect/unprotect round-trip; `Unprotect` passes through legacy plaintext; a DB test
that saves a `DeviceConfig`, reads the **raw** column via `ExecuteSqlRaw`/a raw query and asserts
it is **not** the plaintext, then reads via EF and asserts it **is** the plaintext (proves
transparent encryption). Uses the temp-DB pattern + a test protector.

### Task 2 — Legacy-plaintext migration (B-07)

**Modify:** `src/Pulse.Edge.Api/Program.cs` (startup, after storage init).

- On startup, detect whether the existing `DeviceConfig` row holds **legacy plaintext** cloud
  creds (read the raw stored value; if `IDataProtector.Unprotect` throws, it's legacy). If so,
  force an update so the value converter re-writes them **encrypted**. Idempotent (already-encrypted
  rows are left alone). One row, negligible cost.
- **Tests:** insert a row with raw plaintext, run the migration, assert the raw column is now
  ciphertext and the EF-read value is unchanged.

> Task 1 + Task 2 together are B-07. They are split so the migration (which touches startup) can be
> reviewed independently of the storage-layer change.

### Task 3 — Backup hardening (B-09)

**Modify:** `src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs`,
`src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs`.

- **Confirm + enforce** that all three cloud creds (`ApiKey`, `ClaimSecret`, `PairingToken`) are
  **excluded from backup export** (today only `ApiKey` is verified). Add a test asserting a
  produced backup contains none of the three.
- Add a **size limit** on the restore import (reject an oversized body before parsing) and **real
  schema validation** (required fields/types, not just presence) with a clear rejection.
- (Explicit Admin authz on restore `inspect`/`apply` was already added in Slice 2A / B-02 — not
  repeated here.)
- **Tests:** export excludes the three creds; an oversized import is rejected; a malformed/invalid
  schema import is rejected with 400.

### Task 4 — Redaction assurance (B-10)

**Modify:** `src/Pulse.Edge.Api/Diagnostics/DiagnosticLogService.cs` if the sink's redaction does
not already cover the cloud-cred shapes.

- Prove the diagnostic-log sink and any export/support output **never emit** the cloud-cred
  values. Confirm the existing regex sink catches the relevant patterns (`apikey`, `token`,
  `secret`, and the raw values if logged); extend it if a shape slips through.
- **Tests:** log a message containing an API key / claim secret / pairing token value and assert
  the persisted diagnostic entry has them redacted.

### Task 5 — Rotation runbook + accepted-risk records (B-12, B-11)

**New:** `docs/PULSE_Edge_Credential_Rotation.md`. **Modify:** `docs/PULSE_Edge_Network_Hardening.md`
(LUKS/TPM note), `docs/PULSE_Edge_Pilot_Known_Limitations.md` (R-010), the roadmap risk log.

- **Rotation runbook:** cloud creds rotate by **re-pairing** (soft-reset already regenerates
  `ClaimSecret`/`PairingToken` and clears `ApiKey`); the DataProtection key ring rotates on its
  default schedule (old keys retained so existing ciphertext still decrypts); the TLS cert
  (Slice 2B) rotates by deleting `pulse-edge.pfx`. Document each path and when to use it.
- **LUKS/TPM note** in the network-hardening doc: full-disk-theft protection for the cloud creds is
  a deployment control (LUKS or TPM); app-level encryption covers DB-copy/support-bundle exfil.
- **R-010** (accept B-11): the Windows-only unkeyed `config.json` integrity hash is accepted as a
  documented risk while Windows is deferred (R-006); reinstate a keyed MAC when Windows returns.
- No automated test (docs); verify by review.

## Configuration keys introduced

| Key | Default | Purpose |
|-----|---------|---------|
| (none required) | — | DataProtection persists to `<PULSE_EDGE_DATA_DIR>/dp-keys` by convention; no new config knob needed for the basic path |

## Out of scope (later gates / accepted)

- TPM / `systemd-creds` hardware-rooted key protection → deployment recommendation only (LUKS/TPM),
  not shipped.
- Device/protocol credential encryption → **R-008** (stays plaintext + backup-recoverable).
- Keyed `config.json` MAC → **R-010** (accepted; Windows-deferred).
- The full G2 gate security-test sweep + gate review → **Slice 2D**.

## Testing summary

- **Unit:** protector round-trip + legacy passthrough; redaction of cloud-cred shapes.
- **DB/integration (temp-DB pattern):** raw column is ciphertext while EF read is plaintext; legacy
  plaintext migrates to ciphertext; backup export excludes all three cloud creds; oversized/invalid
  import rejected.
- **Manual/review:** rotation runbook accuracy; LUKS/TPM + R-010 doc notes.

## Dependencies

Builds on `main` (2A + 2B merged). Reuses the `PULSE_EDGE_DATA_DIR` resolution (2A) and the
`WebApplicationFactory` harness (2A) for the DB/integration tests.
