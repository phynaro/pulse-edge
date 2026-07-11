# PULSE Edge IoT Gateway Security Pillars

This document details the architectural security pillars designed for the PULSE Edge gateway. These pillars are structured around a zero-trust model to safeguard data integrity, protect local networks, and authenticate cloud synchronizations securely.

---

## Pillar 1: Edge-to-Cloud Transit Security
Securing communications between the local gateway and the central cloud orchestrator.

*   **TLS 1.3 / HTTPS-Only (Phase 1 Standard)**
    *   *Approach*: Enforce strict TLS 1.3 encryption on all REST API and MQTT telemetry streams. Reject any insecure, unencrypted HTTP endpoints.
*   **Mutual TLS / mTLS (Phase 2 Standard)**
    *   *Approach*: Replace static `ApiKeys` (which can be leaked or stolen from configuration files) with **Client Certificates (x509)**.
    *   *Implementation*: During the onboarding phase, the device claims a unique certificate signed by the Cloud Certificate Authority (CA). Subsequent requests utilize mTLS for both authentication and encryption, completely eliminating static token lookup.
*   **VPN Tunneling (Optional/Enterprise)**
    *   *Approach*: Establish an encrypted tunnel from the gateway to a secure cloud VPC (e.g., using WireGuard). All HTTP/MQTT traffic runs over the virtual network interface, allowing public endpoints to be blocked entirely.

---

## Pillar 2: Local Administration & API Security
Hardening the local web control panel (Kestrel/Vite) and Fastify API endpoints.

*   **Local Administrator Authentication**
    *   *Approach*: Enforce secure local authentication (username and password hashed using Bcrypt in SQLite) to access settings or onboarding pages. This prevents unauthorized factory floor personnel from editing driver IPs, tags, or syncing profiles.
*   **Local TLS/HTTPS**
    *   *Approach*: Run Kestrel (the local dotnet web server) with an SSL certificate.
    *   *Implementation*: Generate a self-signed local certificate on installation to ensure local settings changes and diagnostics are encrypted on the factory intranet.
*   **Host-Only Binding**
    *   *Approach*: Restrict configuration endpoints to localhost.
    *   *Implementation*: Bind the local server to `127.0.0.1` rather than `0.0.0.0` to prevent other network nodes on the intranet from scanning or accessing the configuration portal.

---

## Pillar 3: Local Data-at-Rest Security
Safeguarding buffered queues and local SQLite database files from offline tampering.

*   **Database Encryption (SQLCipher)**
    *   *Approach*: Swap standard SQLite for **SQLCipher** to encrypt the `edge.db` database file using AES-256.
    *   *Reason*: If the physical gateway hardware is stolen or accessed locally, an unencrypted SQLite file would expose company telemetry history, configuration profiles, and cloud credentials.
*   **Platform-Native Credential Storage**
    *   *Approach*: Never write raw API keys or DB decryption keys to plain-text configuration files.
    *   *Implementation*: Secure the master key in the OS-provided credential store:
        *   **Windows**: Windows Data Protection API (**DPAPI**) via `ProtectedData`.
        *   **Linux**: Linux Keyring or `systemd-creds`.

---

## Pillar 4: Industrial Protocol Security (OT Net)
Ensuring the Edge gateway is not a pivot point into the local automation system.

*   **Network Micro-segmentation**
    *   *Approach*: The Edge gateway must reside on a separate VLAN. It should **never** bridge or route traffic between the IT network (cloud uplink) and the OT network (PLCs).
*   **Hardened OPC UA Configurations**
    *   *Approach*: Disallow `None` security policy profiles.
    *   *Implementation*: Enforce `SignAndEncrypt` with modern cipher suites (e.g., `Basic256Sha256`) and manage OPC UA client/server certificates securely on the gateway filesystem.

---

## Pillar 5: Deployment Lifecycle & OS Hardening
Security measures built directly into installers, systems, and deployment binaries.

*   **Least-Privilege Service Execution**
    *   *Approach*: Never run the background Agent daemon as `root` (Linux) or `LocalSystem/Administrator` (Windows).
    *   *Implementation*: The installer (`PulseEdge.iss`) should register the Windows Service to run under a dedicated virtual account (e.g., `NT SERVICE\PulseEdgeService`) with read/write access restricted only to `.pulse/` directories.
*   **Binary Code-Signing**
    *   *Approach*: Digitally sign the published binaries (`Pulse.Edge.exe`, `Pulse.Edge.Agent.exe`, and the setup executable) using a trusted Code Signing certificate to prevent OS tampering alerts and guarantee binary integrity.
*   **Host Firewall Profiles**
    *   *Approach*: Configure the firewall to block all unsolicited inbound traffic except the local port required by the configuration UI.
