# PULSE Edge ↔ Cloud Integration Guide (Localhost / Dev)

**Audience:** PULSE Edge development team
**Scope:** How to talk to the real PULSE Cloud **control plane** that now exists, run both sides on one machine, and migrate `CloudClient` off its mocks.
**Status date:** 2026-06-05 (self-service claim endpoint added)

> **TL;DR**
> - The cloud now has **real** endpoints for: device **register**, **claim**, **config** pull, **data-source** declaration, **heartbeat**, and **telemetry**.
> - Provisioning is **three-phase and self-service**: the edge **registers** (sending a `claimSecretHash`) and becomes `pending`; a **human approves** it in the cloud UI (assigns a site, status → `approved`); the edge then **claims** its API key by polling `POST /edge/claim` with the raw secret. **No operator copy/paste of the key** — the edge fetches it itself, once.
> - The claim secret is **device-generated** and **immutable after first registration**. Only its `sha256` hash is ever sent or stored. Keep the raw secret on the device, forever.
> - **Telemetry ingestion is live** — wire `SendTelemetryBatchAsync` to `POST /edge/telemetry`. **Events ingestion does not exist yet** — keep `SendEventsBatchAsync` mocked.
> - A real device calls the server directly at `http://localhost:3000/edge/...` — **no `/api` prefix** (that prefix only exists for the web app's dev proxy).

---

## 1. What is live today

| Capability | Method & path | Auth | Status |
|---|---|---|---|
| Self-register (bootstrap) | `POST /edge/register` | none (open) | ✅ live |
| Claim API key (proof-of-possession) | `POST /edge/claim` | claim secret (open) | ✅ live |
| Pull config (identity + site + data sources) | `GET /edge/config` | API key | ✅ live |
| Declare / update data sources | `POST /edge/data-sources` | API key | ✅ live |
| Liveness heartbeat | `POST /edge/heartbeat` | API key | ✅ live |
| **Telemetry upload** | `POST /edge/telemetry` | API key | ✅ live |
| **Event upload** | `POST /edge/events` (planned) | API key | ❌ **not built** — keep mocked |
| Data source → Work Unit → Asset binding | (cloud admin UI) | — | ❌ not built |
| OEE / insights | — | — | ❌ not built |

Admin-side (used by the **cloud web UI**, not the edge — listed so you understand the flow):

| Capability | Method & path |
|---|---|
| List sites (approval dropdown) | `GET /edge/sites` |
| List devices | `GET /edge/devices?status=pending\|approved\|active\|revoked` |
| Approve device (assign site; status → `approved`, **no key issued here**) | `POST /edge/devices/:id/approve` |
| Re-issue (reset `active` → `approved` so the edge re-claims a fresh key) | `POST /edge/devices/:id/reissue` |
| Revoke device (kills key) | `POST /edge/devices/:id/revoke` |

---

## 2. Localhost topology

Everything runs on one machine:

```
┌─────────────────────────── your dev box ───────────────────────────┐
│                                                                     │
│  PULSE Edge (.NET)            PULSE Cloud                            │
│  ─────────────────           ──────────────────────────────────    │
│  Pulse.Edge.Agent            API (Fastify)     → http://localhost:3000  │
│  Pulse.Edge.Cloud  ───HTTP──▶ Web (React)      → http://localhost:5173  │
│                              Postgres          → localhost:5432         │
│                              InfluxDB          → localhost:8086         │
└─────────────────────────────────────────────────────────────────────┘
```

- **Edge → Cloud API base URL:** `http://localhost:3000`
- **Operator approves devices in the Web UI:** `http://localhost:5173` → **Edge Devices** in the sidebar
- The Web UI calls the API through a dev proxy that rewrites `/api/edge/...` → `/edge/...`. **You (the edge) skip the proxy and call `/edge/...` directly.**

---

## 3. Bring the cloud up (one time per session)

From the cloud monorepo root (`~/Projects/pulse-project`):

```bash
# 1. Infra (Postgres + InfluxDB)
docker compose up -d postgres influxdb

# 2. Env: copy the example if you don't have a .env yet
cp .env.example .env      # localhost URLs, PORT=3000

# 3. Migrate + seed (creates the demo org, the "Bangkok Factory" site, and a seed admin user)
pnpm --filter @pulse/db migrate
pnpm --filter @pulse/db seed

# 4. Run API and Web (two terminals)
pnpm --filter api dev     # → API listening on port 3000
pnpm --filter web dev     # → http://localhost:5173
```

Sanity check:

```bash
curl -s localhost:3000/health
# {"postgres":"ok","influx":"ok"}
```

The seed gives you a working admin in the Web UI out of the box (the web app is wired to the seeded admin user), so you can approve devices immediately — no login step in dev.

API docs (Swagger) are served at `http://localhost:3000/docs`.

---

## 4. The real registration, approval & claim flow

Provisioning is **self-service**: `register` never returns a key, approval is a deliberate human gate, and the edge **claims** its key itself by polling — no operator copy/paste.

```
EDGE                                CLOUD                         OPERATOR (Web UI)
 │                                    │                                  │
 │ 1. generate deviceId (UUID) +      │                                  │
 │    a high-entropy claimSecret;     │                                  │
 │    persist BOTH forever            │                                  │
 │                                    │                                  │
 │ 2. POST /edge/register ───────────▶│ creates device, status=pending,  │
 │    {deviceId, hostname,            │ stores sha256(claimSecret)        │
 │     claimSecretHash}               │                                  │
 │ ◀──── { edgeId, status:"pending" } │                                  │
 │                                    │ 3. device appears under "Pending" │
 │                                    │ ◀──────────────────── opens "Edge Devices"
 │                                    │                       picks a Site, clicks Approve
 │                                    │ 4. status=approved, site assigned │
 │                                    │    (NO key issued here)           │
 │                                    │                                  │
 │ 5. POST /edge/claim {deviceId,     │ pending  → {status:"pending"}     │
 │    claimSecret}  (poll) ──────────▶│ approved → issue key ONCE,        │
 │ ◀── {status:"active", apiKey} ─────│            status=active          │
 │                                    │                                  │
 │ 6. GET /edge/config (Bearer key) ─▶│ returns identity + site + DS list │
 │ 7. POST /edge/data-sources ───────▶│ upserts DS by (device, externalId)│
 │ 8. POST /edge/heartbeat  ─────────▶│ updates last_seen_at              │
```

### Key facts that drive your implementation

1. **`deviceId` must be a UUID.** The cloud validates it (`z.string().uuid()`). Generate it once on first start and store it locally forever.
2. **The claim secret is yours, generated on the device.** On first start, generate a high-entropy secret (e.g. 24+ random bytes, hex/base64). At register you send **only its sha256 hash** (`claimSecretHash`, 64 lowercase hex chars). You present the **raw** secret later at `claim`. Persist the raw secret locally, forever, as securely as the API key. **The cloud never sees the raw secret except at claim, and stores only the hash.**
3. **`register` is idempotent and the claim secret is immutable after first registration.** Re-sending the same `deviceId` returns the **same** `edgeId` and updates only `hostname`/`agentVersion` — it will **not** change the stored `claimSecretHash`, status, or key. (Register is unauthenticated and `deviceId` isn't a secret, so an open re-key would be a hijack — it's blocked by design.) Safe to call on every boot. `claimSecretHash` is **required** on every register call; a missing/malformed one is `400`.
4. **`claim` is how you get the key — poll it.** After register, poll `POST /edge/claim` with `{deviceId, claimSecret}`:
   - `200 {status:"pending"}` → not approved yet; keep polling (e.g. every 15–30s).
   - `200 {status:"active", apiKey}` → **persist the key now**; this is the only time it is returned.
   - `401` → unknown device **or** wrong secret (the cloud does not distinguish, to avoid enumeration).
   - `403 {status:"revoked"}` → the device was revoked; needs operator re-approval.
   - `409 {status:"active"}` → already claimed (key not returned again). If you don't have the key, the operator must **re-issue** (Web UI) so you can claim a fresh one.
5. **Key format:** `pe_live_<48 hex chars>`. Send it as `Authorization: Bearer <key>`.
6. **Revoke / re-issue.** Revoke is immediate — every API-key call returns `401`; treat a `401` on `config`/`heartbeat`/`data-sources`/`telemetry` as "de-provisioned" and surface it. **Re-issue** (operator action) flips an active device back to `approved` and clears the key; your edge should detect the `401`, then resume polling `claim` with its existing secret to pick up the new key. This is also the recovery path if the device loses its key after claiming.

---

## 5. Endpoint reference

Base URL: `http://localhost:3000`

### `POST /edge/register` — open, no auth
Request:
```json
{ "deviceId": "4d3dbf7f-8c3a-4d44-a98b-f2c2f5f11322", "hostname": "PACKAGING-PC",
  "agentVersion": "1.0.0",
  "claimSecretHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" }
```
`agentVersion` is optional. `claimSecretHash` is **required** — the lowercase-hex sha256 of your
device-generated claim secret (64 chars; `^[a-f0-9]{64}$`). It is recorded only on first
registration and is **immutable** thereafter. Response `200`:
```json
{ "edgeId": "89da9732-4fda-4b91-92ce-a6654f93533b", "status": "pending" }
```
`status` is `pending` until approved, `approved` after approval (awaiting claim), `active` after the
key is claimed, `revoked` if revoked. `400` if `deviceId` isn't a UUID, `hostname` is empty, or
`claimSecretHash` is missing/not 64-hex.

### `POST /edge/claim` — open, secret-guarded
The edge polls this to pick up its API key. The raw secret proves possession; the cloud compares its
sha256 against the stored hash in constant time.
```json
{ "deviceId": "4d3dbf7f-8c3a-4d44-a98b-f2c2f5f11322", "claimSecret": "<the raw secret>" }
```
Responses:
- `200 { "status": "pending" }` — approved not yet; keep polling.
- `200 { "status": "active", "apiKey": "pe_live_..." }` — **the key, returned exactly once.** Persist it immediately.
- `401 { "error": "invalid device or secret" }` — unknown device or wrong secret.
- `403 { "status": "revoked" }` — device revoked; needs operator re-approval.
- `409 { "status": "active", "error": "already claimed" }` — key already issued; re-issue (operator) to claim again.

### `GET /edge/config` — `Authorization: Bearer <key>`
Response `200`:
```json
{
  "edgeId": "89da9732-...",
  "status": "active",
  "site": { "id": "00000000-0000-0000-0000-000000000002", "name": "Bangkok Factory" },
  "dataSources": [
    { "id": "bc46...", "externalId": "DS001", "name": "CasePacker Production",
      "metrics": ["good_count","run_status"], "protocol": null }
  ]
}
```
`401` if key missing/invalid/revoked. Use this as your post-approval "am I provisioned and what does the cloud already know about me" call.

### `POST /edge/data-sources` — `Authorization: Bearer <key>`
Body is an **array** (declare many at once). Upsert by `(device, externalId)` — re-sending the same `externalId` updates that row, never duplicates. `externalId` is your edge-local code (e.g. `DS001`) and is only unique **within your device** (device B may also use `DS001`).
```json
[
  { "externalId": "DS001", "name": "CasePacker Production",
    "metrics": ["good_count","run_status"], "protocol": "opcua" }
]
```
`protocol` is optional, one of `opcua | mqtt | modbus`. Response `201` with the stored rows (each gets a cloud UUID `id`).

### `POST /edge/heartbeat` — `Authorization: Bearer <key>`
```json
{ "agentVersion": "1.0.0" }
```
Response `200`: `{ "ok": true, "status": "active" }`. Updates `last_seen_at` (shown in the Web UI).

### `POST /edge/telemetry` — `Authorization: Bearer <key>`
Body is a JSON **array** of 1..5000 numeric frames. Each metric value must be a
finite number (strings/bools/NaN/Infinity → that frame is rejected). `ts` is
optional ISO-8601 UTC with an explicit `Z` or `±hh:mm` offset (defaults to
server receive time). `org`/`site`/`device` are derived from the key — never send them.

```json
[
  { "dataSource": "DS001", "ts": "2026-06-04T13:45:00.123Z",
    "metrics": { "good_count": 142, "temperature": 85.3, "run_status": 1 } }
]
```

Response `202`: `{ "accepted": <n>, "rejected": <n>, "errors": [ { "index": <i>, "reason": "..." } ] }`.
A `503` means the cloud did not accept the batch — **keep it in the outbox and retry**.
Declare data sources first via `POST /edge/data-sources` (telemetry is accepted regardless).
State/OEE events are a **separate, not-yet-built** path — keep `SendEventsBatchAsync` mocked.

---

## 6. End-to-end curl walkthrough

This is the exact sequence we smoke-test the cloud with. Run it after the stack is up.

```bash
# 1. Generate a deviceId (UUID) and a claim secret; hash the secret for register.
DEVICE_ID=$(uuidgen | tr 'A-Z' 'a-z')
CLAIM_SECRET=$(openssl rand -hex 24)
CLAIM_HASH=$(printf %s "$CLAIM_SECRET" | openssl dgst -sha256 -hex | awk '{print $2}')

# 2. Register (open). claimSecretHash is required.
curl -s -XPOST localhost:3000/edge/register \
  -H 'content-type: application/json' \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"hostname\":\"SMOKE-PC\",\"claimSecretHash\":\"$CLAIM_HASH\"}"
# → {"edgeId":"<EDGE_ID>","status":"pending"}

# 3. Approve in the Web UI:
#    open http://localhost:5173 → "Edge Devices" → device under "Pending" →
#    Approve → pick "Bangkok Factory". No key is shown — the edge claims it next.

# 4. Claim the key (poll until status flips from pending to active).
KEY=$(curl -s -XPOST localhost:3000/edge/claim \
  -H 'content-type: application/json' \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"claimSecret\":\"$CLAIM_SECRET\"}" \
  | sed -n 's/.*"apiKey":"\([^"]*\)".*/\1/p')
echo "$KEY"   # pe_live_...   (empty if still pending — approve first, then re-run)

# 5. Pull config
curl -s localhost:3000/edge/config -H "authorization: Bearer $KEY"

# 6. Declare a data source (upsert)
curl -s -XPOST localhost:3000/edge/data-sources \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '[{"externalId":"DS001","name":"CasePacker Production","metrics":["good_count","run_status"]}]'

# 7. Heartbeat
curl -s -XPOST localhost:3000/edge/heartbeat \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"agentVersion":"1.0.0"}'

# 8. (negative) a bad key is rejected
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/edge/config -H "authorization: Bearer nope"   # → 401

# 9. (negative) a wrong claim secret is rejected
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:3000/edge/claim \
  -H 'content-type: application/json' \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"claimSecret\":\"nope\"}"   # → 401
```

---

## 7. What to change in `Pulse.Edge.Cloud`

`CloudClient` currently **simulates** everything against imagined `/api/...` paths and **fakes an instant key**. Migrate the real calls; leave events mocked.

| `CloudClient` method | Today (mock) | Change to |
|---|---|---|
| `RegisterDeviceAsync` | returns `(mockApiKey, mockSiteId)` immediately | `POST /edge/register` with `{deviceId, hostname, agentVersion, claimSecretHash}` → returns `{ edgeId, status }`, **no key**. Split "register" from "I have a key". |
| (new) `ClaimKeyAsync` | — | `POST /edge/claim` with `{deviceId, claimSecret}`. Poll until `200 {status:"active", apiKey}`; persist the key. Handle `pending`/`401`/`403`/`409` per §4.4. |
| `SendHeartbeatAsync` | logs only | `POST /edge/heartbeat` with `Authorization: Bearer <key>` |
| (new) `GetConfigAsync` | — | `GET /edge/config` → site + known data sources |
| (new) `UpsertDataSourcesAsync` | — | `POST /edge/data-sources` (array body) |
| `SendTelemetryBatchAsync` | mock `POST /api/telemetry` | wire to `POST /edge/telemetry` (array body; treat any non-202 as retry) |
| `SendEventsBatchAsync` | mock `POST /api/events` | **leave mocked** — endpoint not built yet |

Suggested config / local-state keys for the edge (localhost defaults):

```jsonc
// appsettings.Development.json (or env)
{
  "Cloud": {
    "BaseUrl": "http://localhost:3000",   // NOT /api
    "HeartbeatSeconds": 30,
    "ClaimPollSeconds": 20                 // how often to poll /edge/claim while approved-pending
  }
}
```
Plus device-local **persisted state** (NOT shipped config — generated on first run and stored on the device): `DeviceId` (UUID), `ClaimSecret` (raw, kept secret), and `ApiKey` (empty until claimed). The `claimSecretHash` you send at register is `sha256(ClaimSecret)` — never store/ship the hash as your source of truth; derive it from the raw secret.

Implementation notes:
- Use one `HttpClient` with `BaseAddress = http://localhost:3000`. Set the default `Authorization: Bearer <ApiKey>` header **only after** the key is claimed.
- **First run:** generate `DeviceId` and `ClaimSecret`, persist both. 
- **On boot:**
  - If `ApiKey` is empty → call `register` (idempotent; send `sha256(ClaimSecret)` as `claimSecretHash`), then **poll `claim`** until it returns `active` + the key; persist the key. Log `pending` while waiting on the operator.
  - If `ApiKey` is present → call `config`, push `data-sources`, start the heartbeat loop.
- Treat `401` from any keyed call as "de-provisioned": stop the heartbeat loop, clear the in-memory `ApiKey`, and **resume polling `claim`** with your existing `ClaimSecret` (covers operator re-issue and recovery). If `claim` returns `403 revoked`, surface a clear operator message — it needs re-approval.
- **Never re-generate the `ClaimSecret`** on an existing device — the cloud locks it at first registration and a new secret can never claim. Lose the device's persisted secret and the operator must revoke + the device re-registers as a new identity.
- `deviceId` is yours and permanent; `edgeId` is the cloud's UUID for the same device. Persist both.

---

## 8. Gotchas / FAQ

- **404 on every call?** You're probably hitting `/api/edge/...`. The `/api` prefix is **only** the web dev proxy. Edge calls `/edge/...` directly.
- **400 `FST_ERR_CTP_EMPTY_JSON_BODY`?** You sent `Content-Type: application/json` with an **empty body** (e.g. on a bodyless POST). Only set the JSON content-type when you actually send a body.
- **400 on register?** `deviceId` isn't a valid UUID, `hostname` is empty, or `claimSecretHash` is missing / not 64 lowercase hex chars.
- **`claim` keeps returning `{status:"pending"}`.** Expected until a human approves the device in the Web UI. Keep polling.
- **`claim` returns `401`.** Wrong `claimSecret` for that `deviceId` (or the deviceId is unknown). Make sure you send the **raw** secret whose sha256 you registered — not the hash.
- **`claim` returns `409 already claimed` but I have no key.** The key was issued once and you didn't persist it. Ask the operator to **Re-issue** the device (Web UI) — it returns to `approved` and you can claim a fresh key with the same secret.
- **My device never gets a key.** Until approved, `claim` stays `pending` — that's by design. After approval the edge must actually poll `claim`.
- **`config` shows `site: null`?** The device isn't approved/assigned yet, or has been revoked.
- **Can two edges use `DS001`?** Yes. `externalId` is unique only within a device.
- **Where do telemetry frames go?** `POST /edge/telemetry` is now live — wire `SendTelemetryBatchAsync` to it. Event ingestion (`SendEventsBatchAsync`) is still a separate, not-yet-built workstream — keep that one mocked.

---

## 9. Mapping to the registration-flow doc

This guide implements **Steps 3–8** of `PULSE_Edge_Registration_and_Data_Binding_Flow.md` against the *real* cloud. Steps 9–12 (telemetry flowing, DS→Work Unit→Asset binding, OEE insights) are **future cloud work** and remain mocked on the edge for now.
