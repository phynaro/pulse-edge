# PULSE Edge — Credential & Certificate Rotation

How to rotate each secret the edge holds.

## Cloud credentials (ApiKey / ClaimSecret / PairingToken)

These are the device's identity to PULSE Cloud. They are stored **encrypted at rest** (Slice 2C)
and are re-issuable from the cloud, so rotation is a **re-pair**:

1. In the local UI, run **Soft Reset** (Settings). This regenerates the device identity
   (`DeviceId`) along with `ClaimSecret` and `PairingToken`, clears `ApiKey`, and sets
   `CloudStatus = PendingApproval` — local adapter/tag configuration is preserved, but the
   cloud sees the re-paired device as a new edge node.
2. Re-approve the device in PULSE Cloud (the normal pairing flow) to issue a fresh `ApiKey`.

Use this if a cloud credential is suspected leaked, or when moving the device between
organizations.

## At-rest encryption key (DataProtection key ring)

The key ring under `<data dir>/dp-keys` protects the cloud credentials at rest. DataProtection
rotates its active key automatically on its default schedule; old keys are retained so existing
ciphertext still decrypts. To force a new key, delete the key ring and re-pair (the cloud creds
are re-issued, so no data is lost). **Do not** delete the key ring without re-pairing, or the
stored cloud creds become undecryptable (recover by re-pairing).

**Note:** This key ring is shared with the local UI's cookie-auth session keys. The first boot
after upgrading to a version that uses this key ring (Slice 2C) generates a fresh key ring, and
existing UI session cookies become invalid — users must log in again once (a one-time effect).
In MultiPort mode, both the Api and Agent processes read `<data dir>/dp-keys` with application
name "pulse-edge"; deleting the ring affects acquisition in both processes.

## Local TLS certificate

The self-signed UI certificate (`<data dir>/pulse-edge.pfx`, Slice 2B) rotates by deleting the
file — a fresh 5-year certificate is generated on the next start. If you supplied your own
certificate via `Tls:CertPath`, rotate it at your PKI and update the file/config.

## Local user passwords

Rotate via the local UI user management (admin resets a user's password).
