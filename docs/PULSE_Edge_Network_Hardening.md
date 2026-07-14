# PULSE Edge — Network & Host Hardening

Operational guidance for deploying PULSE Edge securely on a plant network. This complements the
in-product controls delivered in Phase 2 (local HTTPS, enforced cloud HTTPS, authentication).

## Network placement (prevents an IT↔OT pivot — threat T-15)

- Place the edge on a dedicated management VLAN. It must **never** route or bridge traffic between
  the IT/cloud-uplink network and the OT/PLC network.
- The edge needs: inbound `TCP 5288` (management UI/API) from the management network only, and
  outbound HTTPS to PULSE Cloud. Block everything else.

## Bind address

- By default Kestrel binds `https://*:5288` (all interfaces). On a flat or untrusted LAN, restrict
  it to the management interface or loopback via the `serverUrl` setting, e.g.
  `serverUrl = https://10.20.0.10:5288` or `serverUrl = https://127.0.0.1:5288` (with a reverse
  proxy in front).

## Host firewall defaults

- Allow inbound only `TCP 5288` from the management subnet; drop all other inbound.
- Example (Linux, ufw): `ufw default deny incoming`, `ufw allow from 10.20.0.0/24 to any port 5288 proto tcp`.

## TLS

- The local UI serves HTTPS with a self-signed certificate generated on first boot. Browsers show a
  one-time "not private" warning; this is expected — the connection is still encrypted. To remove
  the warning, either install the certificate (`pulse-edge.pfx` in the data directory) into the
  accessing machine's trust store, or supply a certificate from your own PKI via `Tls:CertPath` /
  `Tls:CertPassword`.
- HSTS is intentionally not sent while a self-signed certificate is in use (it would prevent the
  click-through). Enable it only after configuring a trusted certificate.

## Data at rest

The cloud credentials are encrypted in the local database (Slice 2C) with an on-disk key. This
protects a **copied** database (support bundle, stray file, partial backup) but **not** theft of
the whole powered device — the key lives on the same disk. For full-disk-theft protection, enable
**LUKS full-disk encryption** (or a TPM-sealed key) on the host; this is a deployment control.
Device/protocol credentials remain plaintext by design (recoverable via backup — decision R-008).

## Least-privilege service (Linux)

- The `.deb` package runs the service as a dedicated non-root user (`pulse`) under a systemd
  sandbox (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, dropped capabilities, scoped
  `ReadWritePaths`). Verify with `systemd-analyze security pulse-edge.service`.

## Windows

Windows deployment and service-account hardening are deferred (decision R-006) and must be
reinstated before a Windows-supporting release. When reinstated, the installer's health check
(`PulseEdge.iss` `/health` probe) and Dashboard shortcuts must be switched from
`http://localhost:<port>` to `https://` (with cert-error-ignore on the loopback health probe),
since the API is now HTTPS by default.
