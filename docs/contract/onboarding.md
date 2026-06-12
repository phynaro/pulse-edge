# Edge Onboarding Contract — PULSE Direct-Pairing-Link Flow

**Audience:** Edge-box software team (separate codebase)
**Cloud API base URL:** configured per deployment (e.g. `https://cloud.pulse.io`)
**Status:** Authoritative contract for `feat/direct-pairing-link` branch

---

## Overview

This document specifies the complete interface between the edge-box onboarding wizard and the PULSE cloud API. The flow has two phases:

1. **Pairing phase** — open endpoints, no pre-existing credentials. The edge registers itself, displays a link or short code, and polls until an org admin clicks Confirm & Link.
2. **Data-plane phase** — API-key-authenticated endpoints. The edge sends heartbeats, declares its data sources, and streams telemetry.

The cloud admin side (`POST /edge/pairing/preview` and `POST /edge/pairing/confirm`) is operated by the PULSE web app and is documented here for background only; the edge never calls those endpoints.

---

## 1. Identity Generation at First Boot

On the very first boot, before calling any API, the edge agent MUST generate and persist three values:

| Value | Generation | Size |
|---|---|---|
| `deviceId` | UUID v4 | 36 chars (canonical hyphenated form) |
| `claimSecret` | `randomBytes(24).toString('hex')` | 48 hex chars |
| `pairingToken` | `randomBytes(24).toString('hex')` | 48 hex chars |

### Persistence rules

- All three values MUST survive agent process restarts and agent software upgrades.
- If the operator performs a full factory reset (intentional re-onboarding), the agent MAY generate new values. Under any other circumstance the persisted values MUST be re-used.
- If the agent config is reinstalled or updated but the device has not been factory-reset, the same values MUST be re-sent on every `POST /edge/register` call. Replacing them breaks the ongoing claim (new hashes do not match stored hashes; see section 2.4).

### What leaves the device

Only sha256 hex hashes of `claimSecret` and `pairingToken` are sent to the cloud API. The raw `pairingToken` is embedded in the pairing link URL (this is intentional — see section 3). The raw `claimSecret` is sent only once, directly to `POST /edge/claim`, over TLS.

**Security rules the edge MUST follow:**
- Never log the raw `claimSecret`.
- Never include the raw `claimSecret` in any URL, link, or QR code.
- Never persist the raw `apiKey` in a location accessible to untrusted processes; treat it with the same care as a private key.
- TLS is required on all API calls. (Note: TLS enforcement is a tracked pre-pilot hardening item; the API will enforce it before the first production deployment.)

Compute both hashes before the first API call:

```
claimSecretHash  = sha256(claimSecret).hexDigest()   // 64 lowercase hex chars
pairingTokenHash = sha256(pairingToken).hexDigest()  // 64 lowercase hex chars
```

---

## 2. `POST /edge/register`

**Auth:** none (open endpoint)
**Rate limiting:** tracked pre-pilot hardening item (not yet enforced server-side)

Call this endpoint on every agent boot. It is fully idempotent on `deviceId`: a retry after a lost response always returns the same `edgeId`, and when the pairing token hash matches and the code is still valid the same code and expiry are returned unchanged (no sliding window). A fresh code and a new 60-minute expiry are generated only when the stored code is absent or already expired (`needsFreshCode` path in the repo).

### 2.1 Request

```http
POST /edge/register
Content-Type: application/json
```

```json
{
  "deviceId":        "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "hostname":        "PACK-LINE-01",
  "agentVersion":    "1.4.2",
  "claimSecretHash": "a3f1c2...e9b0",
  "pairingTokenHash": "7d4e8a...f001"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `deviceId` | UUID v4 string | yes | Stable device identity; persisted from first boot |
| `hostname` | string (min 1) | yes | Human-readable machine name; may be updated on each call |
| `agentVersion` | string | no | Semver string; omit if unknown |
| `claimSecretHash` | 64-char lowercase hex | yes | sha256 of `claimSecret` |
| `pairingTokenHash` | 64-char lowercase hex | yes | sha256 of `pairingToken` |

### 2.2 Response — first registration

HTTP 200

```json
{
  "edgeId":          "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status":          "pending",
  "shortCode":       "821-492",
  "pairingExpiresAt": "2026-06-12T11:00:00.000Z",
  "pairingBaseUrl":  "https://cloud.pulse.io/pair"
}
```

| Field | Type | Always present | Description |
|---|---|---|---|
| `edgeId` | UUID string | yes | Cloud-side row id; store this for log correlation only — `deviceId` is the primary pairing key |
| `status` | string | yes | `"pending"` at registration |
| `shortCode` | `NNN-NNN` string | when pairing is armed | 6-digit display code for manual entry in the cloud UI |
| `pairingExpiresAt` | ISO 8601 UTC string | when pairing is armed | Expiry of the current `shortCode` and pairing link; 60 minutes from first issue or last regeneration (not a sliding window — a still-valid code keeps its original expiry) |
| `pairingBaseUrl` | string URL | when pairing is armed | Cloud URL prefix for the pairing link (ends with `/pair`) |

### 2.3 Token-hash-match rule (re-register / idempotency)

On every subsequent call with the same `deviceId`:

- If the presented `pairingTokenHash` **matches** the stored hash: the response includes `shortCode`, `pairingExpiresAt`, and `pairingBaseUrl`. If the stored code was absent or already expired, a fresh code is generated and `pairingExpiresAt` is reset to 60 minutes from now. If the code is still valid, it is returned unchanged with its **original** expiry — there is no sliding window.
- If the presented `pairingTokenHash` **does not match** the stored hash: the response contains only `{ "edgeId": "...", "status": "..." }` — no pairing fields are returned and no stored values are changed.

This is the anti-hijack guard. It means only the device that presented the original `pairingTokenHash` can ever retrieve its short code or refresh it.

**Hostname and agentVersion behaviour on re-register:** `hostname` is overwritten on every call, regardless of whether the pairing token hash matches — only pairing fields are gated behind the hash check. `agentVersion`, if omitted, preserves the previously stored value.

### 2.4 Re-arm rule (after device removal)

If a device was previously active and was removed by an operator, re-calling `POST /edge/register` with the same `deviceId` resurrects it to `pending`. If the stored `pairingTokenHash` has been cleared (it is cleared when pairing is consumed), the presented `pairingTokenHash` is adopted as the new armed hash and a fresh short code is issued. The `claimSecretHash` is immutable — the device's existing claim secret continues to work and cannot be replaced.

### 2.5 Status codes

| HTTP | Meaning |
|---|---|
| 200 | OK (registration created or idempotent update applied) |
| 400 | Validation failure (missing required field, malformed UUID, hash not 64 hex chars) |

---

## 3. The Pairing Link and Short Code

After a successful `POST /edge/register` the wizard has two ways to hand off to the cloud admin.

### 3.1 Direct link (primary path)

Construct the URL as:

```
{pairingBaseUrl}?deviceId={deviceId}&token={pairingToken}
```

Example:

```
https://cloud.pulse.io/pair?deviceId=f47ac10b-58cc-4372-a567-0e02b2c3d479&token=7d4e8a1b3c2f9e05a6b4c8d3e1f20a9b7c5d2e4f1a3b6c8d9e0f2a4b5c6d7e8
```

- `pairingBaseUrl` comes from the register response (do not hardcode the cloud origin).
- `token` is the **raw `pairingToken`** — the 48-char hex string generated at first boot. This is the only place the raw token leaves the device, and it is by design: the token is single-use, 60-minute-expiring, and pairing additionally requires an authenticated admin session in the cloud UI.
- Open this URL in a new browser tab so the installer can complete it on a phone or nearby laptop.

### 3.2 Manual fallback (short code)

Display the `shortCode` from the register response alongside an expiry countdown derived from `pairingExpiresAt`. The admin types `NNN-NNN` directly into the cloud UI's /pair page.

When the countdown reaches zero, call `POST /edge/register` again with the same credentials. If the hash matches, a fresh `shortCode` and updated `pairingExpiresAt` are returned; update the display.

> **Important:** `pairingExpiresAt` governs the code's validity for the admin UI lookup — it does **not** gate `POST /edge/claim`. The edge may continue polling `POST /edge/claim` past the 60-minute mark; if the admin confirms after the code expired, the claim still succeeds. If the code lapsed before the admin used it, re-call `POST /edge/register` to get a fresh code, then keep polling the same `POST /edge/claim` endpoint.

---

## 4. `POST /edge/claim` — Polling for the API Key

**Auth:** none (open endpoint; the `claimSecret` is the credential)

After displaying the link / short code, start polling `POST /edge/claim` every 3–5 seconds until a terminal state is reached.

### 4.1 Request

```http
POST /edge/claim
Content-Type: application/json
```

```json
{
  "deviceId":    "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "claimSecret": "7d4e8a1b3c2f..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `deviceId` | UUID v4 string | yes | The same `deviceId` generated at first boot |
| `claimSecret` | string | yes | The raw `claimSecret` (48-char hex); this is its only use |

### 4.2 Response status table

| HTTP | Body | Action |
|---|---|---|
| 200 | `{ "status": "pending" }` | Admin has not confirmed yet. Keep polling every 3–5 s. |
| 200 | `{ "status": "active", "apiKey": "pe_live_...", "organization": { "id": "...", "name": "Integra HQ" }, "site": { "id": "...", "name": "Bangkok Plant 1" } }` | Pairing complete. Persist the `apiKey` and stop polling. |
| 401 | `{ "error": "invalid device or secret" }` | `deviceId` unknown or `claimSecret` does not match the stored hash. Stop polling. This requires operator intervention (device may need to be re-provisioned). |
| 403 | `{ "status": "revoked" }` | An admin has revoked this device. Stop polling. Contact the operator. |
| 409 | `{ "status": "active", "error": "already claimed" }` | Device is already active. This fires both when the key was previously issued (and potentially not persisted) and on any benign duplicate poll after a successful claim. **If you already persisted the key, simply proceed — this is a no-op.** Only request an operator re-issue if the key was lost before it could be persisted. |

### 4.3 On `status: "active"` — what to do

The `apiKey` field contains the Bearer token for all subsequent data-plane API calls (format: `pe_live_` followed by 48 hex chars). This is the **only time the key is returned**. The device MUST:

1. Persist the key securely before acknowledging success.
2. Display "Linked to {organization.name} / {site.name}" in the wizard UI.
3. Stop all claim polling.

The `organization` and `site` objects may be `null` if org/site data was unavailable at claim time (should not happen in normal flow); guard against null before rendering.

---

## 5. Post-Onboarding Data Plane

All data-plane endpoints require:

```http
Authorization: Bearer pe_live_<48-hex-chars>
Content-Type: application/json
```

A missing `Authorization` header returns HTTP 401 `{ "error": "Missing API key" }`. A key that is bad, revoked, or has been superseded by a re-issue returns HTTP 401 `{ "error": "Invalid or revoked API key" }`.

### 5.1 `GET /edge/config`

Pull identity and known data-source list on boot.

**Response (200)**

```json
{
  "edgeId":       "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status":       "active",
  "organization": { "id": "org-uuid", "name": "Integra HQ" },
  "site":         { "id": "site-uuid", "name": "Bangkok Plant 1" },
  "dataSources":  [
    {
      "id":           "c2a1f3e0-11bb-4b8d-9f4c-7a2e1d0b3c5a",
      "orgId":        "org-uuid",
      "edgeDeviceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "externalId":   "DS001",
      "name":         "PLC-01 (Packaging Line)",
      "metrics":      [ ... ],
      "createdAt":    "2026-06-12T08:00:00.000Z",
      "updatedAt":    "2026-06-12T08:00:00.000Z",
      "deletedAt":    null
    }
  ]
}
```

The edge correlates data sources by `externalId` (its own local code) or `id` (the cloud-assigned UUID returned from `POST /edge/data-sources`).

### 5.2 `POST /edge/data-sources`

Declare or update the full set of data sources this device exposes. Call on every boot. Re-sending an identical payload is idempotent (no audit noise).

**Request body** — array of data-source objects:

```json
[
  {
    "externalId": "DS001",
    "name":       "PLC-01 (Packaging Line)",
    "metrics": [
      {
        "name":     "good_count",
        "protocol": "opcua",
        "metadata": {
          "adapterId":     "adp-1",
          "address":       "ns=2;s=PLC.GoodCount",
          "dataType":      "float32",
          "scanIntervalMs": 1000,
          "scaleFactor":   1,
          "offset":        0,
          "byteOrder":     "ABCD",
          "mqttParseMode": "Plaintext",
          "mqttDeviceId":  null,
          "mqttJsonPath":  null
        }
      }
    ]
  }
]
```

| Field | Type | Required |
|---|---|---|
| `externalId` | string (min 1) | yes |
| `name` | string (min 1) | yes |
| `metrics` | array of metric descriptor objects | no — omitting `metrics` defaults to `[]` |

> **Strict schema:** the data-source object uses Zod `.strict()`. Any unknown or extra fields (e.g. a top-level `protocol` key, or string-array `metrics`) cause an immediate HTTP 400. Legacy payload shapes are rejected — do not send fields not listed in this table.

Each metric descriptor:

| Field | Type | Required |
|---|---|---|
| `name` | string (min 1) | yes |
| `protocol` | `"opcua"` \| `"mqtt"` \| `"modbus"` | yes |
| `metadata.adapterId` | string (min 1) | yes |
| `metadata.address` | string | yes |
| `metadata.dataType` | string (min 1) | yes |
| `metadata.scanIntervalMs` | non-negative integer | yes |
| `metadata.scaleFactor` | number | yes |
| `metadata.offset` | number | yes |
| `metadata.byteOrder` | string (min 1) | yes |
| `metadata.mqttParseMode` | string (min 1) | yes |
| `metadata.mqttDeviceId` | string \| null | no |
| `metadata.mqttJsonPath` | string \| null | no |

**Response:** HTTP 201, array of persisted data-source rows. Each element has the shape:

```json
{
  "id":           "c2a1f3e0-11bb-4b8d-9f4c-7a2e1d0b3c5a",
  "orgId":        "org-uuid",
  "edgeDeviceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "externalId":   "DS001",
  "name":         "PLC-01 (Packaging Line)",
  "metrics":      [ ... ],
  "createdAt":    "2026-06-12T08:00:00.000Z",
  "updatedAt":    "2026-06-12T08:00:00.000Z",
  "deletedAt":    null
}
```

The edge may use the returned `id` (cloud UUID) or its own `externalId` for subsequent correlation.

### 5.3 `POST /edge/heartbeat`

Liveness ping. Call periodically (recommended: every 30–60 s).

**Request body:**

```json
{ "agentVersion": "1.4.2" }
```

`agentVersion` is optional. Body may be `{}`.

**Response (200):**

```json
{ "ok": true, "status": "active" }
```

### 5.4 `POST /edge/telemetry`

Upload a batch of numeric telemetry frames. Frames with non-numeric metric values are rejected per-frame; the rest are accepted. The endpoint returns 202 even with partial rejections.

**Request body** — array of 1–5000 frame objects:

| Frame field | Type | Required | Description |
|---|---|---|---|
| `dataSource` | non-empty string | yes | Matches the `externalId` declared in `POST /edge/data-sources` |
| `metrics` | object `{ metricName: number }` | yes | All values must be finite numbers |
| `ts` | ISO-8601 string | no | Timestamp with explicit UTC/offset designator (`Z` or `±hh:mm`). Omitting it assigns the server receive time. **Buffered or delayed batches MUST include `ts`** — omitting it collapses all historical frames to the receive time and loses temporal fidelity. A malformed `ts` rejects the whole frame. |
| `qualities` | object `{ metricName: quality }` | no | Quality status per metric. Allowed values: `Good`, `Uncertain`, `DeviceTimeout`, `CommunicationLost`, `DriverError`, `Stale`, `Heartbeat`. Omitting `qualities` defaults every metric to `Good`. If `qualities` is present, **every key in `metrics` must have a corresponding quality entry** — a partially populated map rejects the frame. |

Example with all fields:

```json
[
  {
    "dataSource": "DS001",
    "ts":         "2026-06-12T08:30:00.000Z",
    "metrics":    { "good_count": 142, "run_hours": 7.3 },
    "qualities":  { "good_count": "Good", "run_hours": "Good" }
  },
  {
    "dataSource": "DS002",
    "ts":         "2026-06-12T08:30:00.000Z",
    "metrics":    { "kw": 18.5 },
    "qualities":  { "kw": "Uncertain" }
  }
]
```

**Response (202):**

```json
{
  "accepted": 2,
  "rejected": 0,
  "errors":   []
}
```

When one or more frames are rejected the response still returns 202 (partial acceptance). Each element of `errors` identifies the rejected frame by its **zero-based position in the submitted batch** (`index`) and explains why it was rejected (`reason`):

```json
{
  "accepted": 1,
  "rejected": 1,
  "errors": [
    { "index": 1, "reason": "metric 'run_status' is not a finite number" }
  ]
}
```

Here `index: 1` means the second frame in the array was rejected. The first frame (index 0) was accepted and written. The edge SHOULD log all error entries so the operator can identify malformed payloads.

If the telemetry store is temporarily unavailable the server returns HTTP 503. The edge MUST NOT acknowledge the batch as sent; retry after a backoff.

---

## 6. Operator-Initiated Recovery Flows

These flows are triggered via the PULSE cloud admin UI and do not require any direct action from the edge agent beyond resuming normal polling or re-registering.

| Scenario | Cloud action | Edge behavior |
|---|---|---|
| Key lost (agent crashed before persisting) | Admin triggers re-issue via `POST /edge/devices/:id/reissue` | Device status returns to `approved`. The existing `claimSecret` continues to work. Resume polling `POST /edge/claim` — a fresh `apiKey` will be returned. |
| Device revoked | Admin triggers `POST /edge/devices/:id/revoke` | `POST /edge/claim` returns HTTP 403 `{ "status": "revoked" }`. `GET /edge/config` (and all other data-plane calls) return HTTP 401. Contact operator. |
| Device removed and re-deployed | Admin triggers `DELETE /edge/devices/:id` | Re-call `POST /edge/register` on the next boot; the device resurrects to `pending` and pairing is re-armed. The original `claimSecret` is preserved (see section 2.4). |
