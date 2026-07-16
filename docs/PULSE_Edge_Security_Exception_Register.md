# PULSE Edge — Security Exception Register

The gate-facing view of every deliberate deviation from the G2 hardening posture. The
master record is the Decision and risk log in
[PULSE_Edge_Production_Readiness_Roadmap.md](PULSE_Edge_Production_Readiness_Roadmap.md);
threat-model context is in [PULSE_Edge_Threat_Model.md](PULSE_Edge_Threat_Model.md) §6.
An exception stays in this register until the listed review trigger fires and the
mitigation lands (or the exception is re-accepted).

| ID | Accepted | Scope | Rationale | Accepted consequence | Review trigger |
|----|----------|-------|-----------|----------------------|----------------|
| R-008 | 2026-07-13 | Device/protocol credentials (`DriverAdapter.ConfigJson`) are plaintext at rest and included in backups; only cloud keys (`ApiKey`, `ClaimSecret`, `PairingToken`) are encrypted | OT-device credentials are often the only copy maintenance staff hold; an encryption key that can be lost would strand the site configuration. Devices sit on the customer-controlled OT network | A leaked backup or stolen appliance exposes device credentials | Customer/regulatory requirement for encrypted device credentials, or a key-escrow mechanism becomes available |
| R-009 | 2026-07-13 | Pre-first-admin setup window is trust-on-first-use: no setup token, loopback-only binding, or bounded window | The window is brief, occurs during physical install on an operator-controlled network; mechanisms add commissioning friction disproportionate to the risk | During the window a LAN client could read the pairing token or claim the first admin. Mitigated operationally: commission on a controlled/isolated network | A commissioning workflow change, or field evidence of setup-window abuse |
| R-010 | 2026-07-14 | Windows-only `config.json.sha256` integrity check remains an unkeyed hash (detects corruption, not authenticated tampering) | Windows deployment is deferred (R-006); a keyed MAC needs the DataProtection key ring wiring on Windows | Offline attacker with file access can edit config and hash together (threat T-11 / L-007) | Windows returns to supported scope → replace with an HMAC keyed by the DataProtection key ring |
| R-011 | 2026-07-14 | MultiPort diagnostic forwarding (Agent → local API) accepts an otherwise-invalid TLS certificate **for loopback targets only** (`LoopbackCertificateTrust`) | The local API serves a self-signed certificate (Slice 2B); the Agent must trust its own machine's cert. Scoped so no non-loopback connection can ever bypass validation; enforced by `TlsBypassGuardTests` | Traffic to 127.0.0.1 is not authenticated by certificate (it never leaves the machine; the ingest endpoint additionally requires the shared `X-Pulse-Diagnostic-Key`) | Local API certificate gains a provisioned trust chain, or MultiPort mode is dropped |
