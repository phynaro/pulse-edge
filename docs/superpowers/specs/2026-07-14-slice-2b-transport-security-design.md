# Slice 2B — Transport Security (Design Spec)

Second implementation slice of **Phase 2 — Local security hardening (Gate G2)**. Where Slice 2A
hardened *who can do what* through the API, Slice 2B hardens *the wire*: it encrypts the local
UI connection and the cloud uplink so credentials and data can't be sniffed or spoofed on the
plant network.

Backlog items from the [threat model](../../PULSE_Edge_Threat_Model.md): **B-03** (local UI TLS),
**B-08** (enforce HTTPS to cloud), **B-14** (binding/firewall/least-privilege), plus the
forwarded-headers follow-up carried over from Slice 2A.

## Dependency

**This slice builds on Slice 2A (PR #12).** Task 2 changes the cookie policy and the
`PulseEdgeAppFactory` integration-test harness that 2A introduced. Implement 2B only after PR #12
is merged to `main` (or branch it from the 2A branch). The design here is independent of that
ordering.

## Threats addressed

| Threat | Today | After 2B |
|--------|-------|----------|
| **T-02** — session cookie sniffed over plaintext HTTP on the LAN | UI served over `http://*:5288`; cookie `SecurePolicy = SameAsRequest` | HTTPS on `:5288`; cookie `Secure` forced |
| **T-12** — cloud MitM / bearer API key sent in the clear | cloud endpoint only prefix-checked for `http`/`https`; not enforced | `https://` required (loopback-exempt), enforced at validation **and** in `CloudClient` |
| **T-15** — edge used as an IT→OT pivot | binding/firewall undocumented; service runs as `pulse` but un-sandboxed | documented binding/firewall guidance + systemd sandboxing |

## Decisions already made (during brainstorming, 2026-07-14)

1. **Trust model:** encrypt-and-document-the-warning. Auto-generate a **self-signed** cert; the
   one-time browser "not private" warning is documented, not engineered away. (Encryption is the
   security goal; the padlock is UX.)
2. **Port strategy:** keep the single external port **`5288`, now HTTPS**. Aligns with the
   one-external-port philosophy. Breaking for existing `http://…:5288` consumers — the
   installer/monitoring `/health` check switches to `curl -k`, docs updated.
3. **HSTS:** **not sent.** HSTS makes browsers refuse the click-through on an untrusted cert
   (operator lockout). Documented as "enable only once a trusted cert is configured."
4. **Custom-cert override:** **included** — `Tls:CertPath` + `Tls:CertPassword` lets a customer
   supply a real cert from their PKI (clean padlock, no proxy).
5. **Cert params:** **RSA 2048, 5-year** validity. Maximally compatible; long life suits an
   unattended appliance with manual rotation (delete the file → regenerates on next boot).
6. **B-14 depth:** docs **plus** Linux systemd sandboxing. Windows service-account hardening
   stays deferred under **R-006**.

## Components and build sequence

Five tasks, executed subagent-driven (implementer + task review each, whole-branch review at the
end), same as Slice 2A.

### Task 1 — `LocalCertificateProvider` (B-03a)

**New:** `src/Pulse.Edge.Api/Security/LocalCertificateProvider.cs`.

Responsibility: resolve the server certificate at startup, in order:
1. If `Tls:CertPath` is configured → load the cert from that path (using `Tls:CertPassword` if
   present). Fail fast with a clear log message if the file is missing/unreadable.
2. Else if a persisted self-signed cert exists in the data dir → load it.
3. Else → generate a new self-signed cert and persist it.

Generation (pure managed .NET — identical on Windows/Linux and x86/x64/ARM64):
- `RSA` 2048-bit key; `CertificateRequest` with `X509SignatureGenerator` (SHA-256).
- Subject `CN=PULSE Edge`; **Subject Alternative Names**: `localhost`, `127.0.0.1`, `::1`, the
  machine hostname (`Dns.GetHostName()`), and every non-loopback IPv4 from
  `NetworkInterface.GetAllNetworkInterfaces()` at generation time.
- Validity: `NotBefore = now - 1 day` (clock-skew slack), `NotAfter = now + 5 years`.
- Basic constraints: end-entity (not a CA); EKU: server authentication.
- Persist as a PFX (`pulse-edge.pfx`) in the data dir (reuse the `PULSE_EDGE_DATA_DIR` resolution
  added in 2A), with restrictive file permissions (`0600` on Linux). The auto-generated cert is
  exported with an **empty** PFX password — the restrictive file permissions are the protection,
  so no separate secret file is stored. (A *custom* cert supplied via `Tls:CertPath` uses its own
  `Tls:CertPassword`.) *(Encrypting this private key with the OS keystore is Slice 2C's job; here
  it is a restricted file. Its leak value is low — it only permits impersonating the local UI on
  the LAN.)*

**Tests** (`src/Pulse.Edge.Tests/…`): generation produces a cert whose SAN contains `localhost`
and `127.0.0.1`; a second call reuses the persisted cert (same thumbprint) rather than
regenerating; a configured custom cert path is loaded in preference to generating. These are pure
unit tests over a temp directory — no web host needed.

### Task 2 — Kestrel HTTPS + forced-Secure cookie (B-03b)

**Modify:** `src/Pulse.Edge.Api/Program.cs`, `src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs`.

- Default `serverUrl` becomes `https://*:5288` (the existing `serverUrl` config override still
  works — setting it to `http://…` is the dev/back-compat escape, so no separate on/off flag).
- Configure Kestrel to use the cert from Task 1:
  `builder.WebHost.ConfigureKestrel(o => o.ConfigureHttpsDefaults(h => h.ServerCertificate = cert))`.
- Cookie: `options.Cookie.SecurePolicy = CookieSecurePolicy.Always` (was `SameAsRequest`).
- **No** `UseHsts()` / `AddHsts()`.
- `/health` is unchanged in code (still mapped); it is now served over HTTPS. The change is
  operational: the installer and monitoring health check use `curl -k`. Documented here and in the
  L-004 update (Task 5).

**Harness impact (required):** forcing `Secure` cookies means the integration harness must present
requests as HTTPS or the auth cookie won't round-trip. Set the `PulseEdgeAppFactory` client base
address to `https://localhost` (`ClientOptions.BaseAddress`). TestServer marks the request scheme
`IsHttps=true` from the URI — **no real TLS is involved**, so the Kestrel HTTPS bind itself is not
exercised in tests. Existing 2A tests otherwise unchanged.

**Tests:** an integration assertion that the auth cookie is issued with the `Secure` attribute
(inspect `Set-Cookie` on the login response through the harness). The actual Kestrel HTTPS bind is
a manual/CI smoke (like the CSP smoke) — noted as a follow-up, not automated.

### Task 3 — Enforce HTTPS to the cloud (B-08)

**Modify:** `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs`,
`src/Pulse.Edge.Cloud/Services/CloudClient.cs`.

- A shared helper `IsAcceptableCloudEndpoint(string url)`: returns true iff the scheme is `https`,
  **or** the host is a loopback address (`localhost`/`127.0.0.1`/`::1`) — the loopback exemption
  keeps dev against a local cloud working.
- Apply it in `POST /api/settings` and `POST /api/settings/validate-cloud`: reject a
  non-acceptable endpoint with `400` and a clear message ("Cloud endpoint must use https://").
  This replaces the current prefix-only check.
- Defense-in-depth in `CloudClient`: before sending, if the configured `CloudEndpoint` is not
  acceptable, refuse (log + short-circuit) rather than transmit the bearer key over cleartext.
- **Certificate trust:** keep .NET's default system trust (validates chain + hostname; no bypass
  exists today, confirmed in the threat model). Document that the edge relies on the OS trust
  store for the cloud cert. No custom-CA support this slice (YAGNI).

**Tests:** `IsAcceptableCloudEndpoint` unit tests (https ok; http-to-real-host rejected;
http-to-localhost allowed); an endpoint test that `POST /api/settings` with an `http://` cloud URL
returns 400.

### Task 4 — Forwarded headers (2A carry-over)

**Modify:** `src/Pulse.Edge.Api/Program.cs`.

- Add `app.UseForwardedHeaders(...)`, **config-gated and off by default** (`ForwardedHeaders:Enabled`,
  default `false`). When enabled, the options **must** be constrained by configured
  `ForwardedHeaders:KnownProxies` and/or `ForwardedHeaders:KnownNetworks` — otherwise a client
  could spoof `X-Forwarded-For` to escape the per-IP login throttle from Slice 2A. If enabled with
  no known proxies/networks configured, log a warning and do not trust the headers.
- Placement: before the auth middleware and the rate limiter, so `RemoteIpAddress` is corrected
  before the throttle partitions on it.

**Tests:** unit test that the options builder trusts the header only when a known proxy/network is
configured. (Full proxy behavior is hard to exercise under TestServer — assert the configuration
wiring; note the end-to-end proxy check as a manual follow-up.)

### Task 5 — Binding, firewall, least-privilege (B-14)

**Modify:** `build-deb.sh`. **New:** `docs/PULSE_Edge_Network_Hardening.md`. **Modify:** the L-004
entry in `docs/PULSE_Edge_Pilot_Known_Limitations.md`.

- **systemd sandboxing** — add to the `[Service]` block of the generated unit (which already runs
  as `User=pulse`):
  - `NoNewPrivileges=true`
  - `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`
  - `ProtectKernelTunables=true`, `ProtectKernelModules=true`, `ProtectControlGroups=true`
  - `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `RestrictNamespaces=true`,
    `LockPersonality=true`
  - `CapabilityBoundingSet=` (drop all — binding to 5288 needs no `CAP_NET_BIND_SERVICE`)
  - `ReadWritePaths=/var/lib/pulse-edge /opt/pulse-edge/logs` — because `ProtectSystem=strict`
    makes `/opt/pulse-edge` read-only, yet the app writes logs to `AppContext.BaseDirectory/logs`
    (`Program.cs:38`) and its data/cert under `HOME=/var/lib/pulse-edge`.
  - **Explicitly NOT** `MemoryDenyWriteExecute=true` — it breaks the .NET JIT (needs W+X memory).
- **`docs/PULSE_Edge_Network_Hardening.md`** — bind-address guidance (bind `serverUrl` to the
  management interface or loopback rather than `*` on flat/untrusted LANs), host firewall defaults
  (inbound only on 5288 from the management network; block the edge from routing between IT and
  OT), and a note that the Linux service runs least-privilege (dedicated `pulse` user + systemd
  sandbox). Windows service-account hardening is out of scope (R-006).
- **L-004 update:** the TLS-enforcement limitation is now addressed for the local UI (HTTPS
  default) and the cloud uplink (enforced HTTPS); note the residual (self-signed warning; HSTS
  pending a trusted cert).

## Configuration keys introduced

| Key | Default | Purpose |
|-----|---------|---------|
| `serverUrl` (existing) | `https://*:5288` | Kestrel bind; set to `http://…` for dev/back-compat |
| `Tls:CertPath` | (unset) | Path to a custom server cert (PFX or PEM); overrides self-signed |
| `Tls:CertPassword` | (unset) | Password for the custom cert, if any |
| `ForwardedHeaders:Enabled` | `false` | Trust `X-Forwarded-*` from a front proxy |
| `ForwardedHeaders:KnownProxies` | (empty) | Proxy IPs whose forwarded headers are trusted |
| `ForwardedHeaders:KnownNetworks` | (empty) | Proxy CIDR ranges whose forwarded headers are trusted |

## Out of scope (later slices / gates)

- Encrypting the cert/cloud private keys with the OS keystore → **Slice 2C** (B-07).
- Backup hardening, secret-redaction assurance, rotation → **Slice 2C**.
- Automated end-to-end HTTPS/proxy verification → the gate test sweep in **Slice 2D**.
- Windows service-account hardening, signed installers → deferred (R-006) / **G6**.
- mTLS to the cloud (B-13) → deferred beyond G2.

## Testing summary

- **Unit:** cert generation (SAN, reuse, custom-cert preference); `IsAcceptableCloudEndpoint`;
  forwarded-headers trust gating.
- **Integration (2A harness, now HTTPS base address):** login cookie carries `Secure`;
  `POST /api/settings` rejects an `http://` cloud endpoint.
- **Manual/CI smoke (follow-ups, not automated):** real Kestrel HTTPS bind + browser reaches the
  UI over `https://<ip>:5288` (self-signed warning expected); end-to-end reverse-proxy forwarded
  headers; the systemd-hardened unit starts and the service can read/write its data + logs.
