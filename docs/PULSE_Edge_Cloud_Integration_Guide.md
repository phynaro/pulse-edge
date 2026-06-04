# PULSE Edge ↔ Cloud Integration Guide (Localhost / Dev)

**Audience:** PULSE Edge development team
**Scope:** How to talk to the real PULSE Cloud **control plane** that now exists, run both sides on one machine, and migrate `CloudClient` off its mocks.
**Status date:** 2026-06-04

> **TL;DR**
> - The cloud now has **real** endpoints for: device **register**, **config** pull, **data-source** declaration, and **heartbeat**.
> - Registration is **two-phase**: the edge registers and becomes `pending`; a **human approves** it in the cloud UI, which **issues the API key once**. The edge does **not** receive a key from `register`.
> - **Telemetry / events ingestion does not exist yet** — keep those mocked.
> - A real device calls the server directly at `http://localhost:3000/edge/...` — **no `/api` prefix** (that prefix only exists for the web app's dev proxy).

---

## 1. What is live today

| Capability | Method & path | Auth | Status |
|---|---|---|---|
| Self-register (bootstrap) | `POST /edge/register` | none (open) | ✅ live |
| Pull config (identity + site + data sources) | `GET /edge/config` | API key | ✅ live |
| Declare / update data sources | `POST /edge/data-sources` | API key | ✅ live |
| Liveness heartbeat | `POST /edge/heartbeat` | API key | ✅ live |
| **Telemetry upload** | `POST /edge/telemetry` (planned) | API key | ❌ **not built** — keep mocked |
| **Event upload** | `POST /edge/events` (planned) | API key | ❌ **not built** — keep mocked |
| Data source → Work Unit → Asset binding | (cloud admin UI) | — | ❌ not built |
| OEE / insights | — | — | ❌ not built |

Admin-side (used by the **cloud web UI**, not the edge — listed so you understand the flow):

| Capability | Method & path |
|---|---|
| List sites (approval dropdown) | `GET /edge/sites` |
| List devices | `GET /edge/devices?status=pending\|active\|revoked` |
| Approve device (assign site + issue key) | `POST /edge/devices/:id/approve` |
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

## 4. The real registration & approval flow

This is the part that differs most from the current mock. **`register` does not return a key.** Approval is a deliberate human gate.

```
EDGE                                CLOUD                         OPERATOR (Web UI)
 │                                    │                                  │
 │ 1. generate deviceId (UUID),       │                                  │
 │    persist it forever              │                                  │
 │                                    │                                  │
 │ 2. POST /edge/register ───────────▶│ creates device, status=pending   │
 │ ◀──── { edgeId, status:"pending" } │                                  │
 │                                    │ 3. device appears under "Pending" │
 │                                    │ ◀──────────────────── opens "Edge Devices"
 │                                    │                       picks a Site, clicks Approve
 │                                    │ 4. issue API key (shown ONCE), ───▶│
 │                                    │    status=active, site assigned    │ copies key
 │                                    │                                    │
 │ 5. operator hands the key to the edge (paste into edge config / env)   │
 │ ◀───────────────────────────────────────────────────────────────────── │
 │                                    │                                  │
 │ 6. GET /edge/config (Bearer key) ─▶│ returns identity + site + DS list │
 │ 7. POST /edge/data-sources ───────▶│ upserts DS by (device, externalId)│
 │ 8. POST /edge/heartbeat  ─────────▶│ updates last_seen_at              │
```

### Key facts that drive your implementation

1. **`deviceId` must be a UUID.** The cloud validates it (`z.string().uuid()`). Generate it once on first start and store it locally forever (you already do this — Step 2 of the registration-flow doc).
2. **`register` is idempotent.** Re-sending the same `deviceId` returns the **same** `edgeId`, updates only `hostname`/`agentVersion`, and **never** changes status or key. A revoked device stays revoked. Safe to call on every boot.
3. **The API key is issued once and shown once** (in the approve modal in the Web UI). There is **no edge endpoint to fetch the key after approval.** In v1 the operator copies it and configures it on the edge. Treat the key as a secret you receive out-of-band.
4. **Key format:** `pe_live_<48 hex chars>`. Send it as `Authorization: Bearer <key>`.
5. **Revoke is immediate.** Once revoked, every API-key call returns `401`. Your edge should treat a `401` on `config`/`heartbeat`/`data-sources` as "I have been de-provisioned" and surface that to the operator (it will need re-approval).

> **Polling note:** Because there's no "fetch my key" endpoint yet, an edge that registers and waits cannot auto-acquire its key. For dev, just approve in the UI and paste the key. If you want a smoother loop later, that's a cloud follow-up (a one-time claim endpoint) — raise it with the cloud team; don't invent it on the edge.

---

## 5. Endpoint reference

Base URL: `http://localhost:3000`

### `POST /edge/register` — open, no auth
Request:
```json
{ "deviceId": "4d3dbf7f-8c3a-4d44-a98b-f2c2f5f11322", "hostname": "PACKAGING-PC", "agentVersion": "1.0.0" }
```
`agentVersion` is optional. Response `200`:
```json
{ "edgeId": "89da9732-4fda-4b91-92ce-a6654f93533b", "status": "pending" }
```
`status` is `pending` until approved, `active` after, `revoked` if revoked.

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

---

## 6. End-to-end curl walkthrough

This is the exact sequence we smoke-test the cloud with. Run it after the stack is up.

```bash
# 1. Register (open). deviceId must be a UUID.
DEVICE_ID=$(uuidgen | tr 'A-Z' 'a-z')
curl -s -XPOST localhost:3000/edge/register \
  -H 'content-type: application/json' \
  -d "{\"deviceId\":\"$DEVICE_ID\",\"hostname\":\"SMOKE-PC\"}"
# → {"edgeId":"<EDGE_ID>","status":"pending"}

# 2. Approve in the Web UI:
#    open http://localhost:5173 → "Edge Devices" → device under "Pending" →
#    Approve → pick "Bangkok Factory" → copy the pe_live_... key shown once.
KEY=pe_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 3. Pull config
curl -s localhost:3000/edge/config -H "authorization: Bearer $KEY"

# 4. Declare a data source (upsert)
curl -s -XPOST localhost:3000/edge/data-sources \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '[{"externalId":"DS001","name":"CasePacker Production","metrics":["good_count","run_status"]}]'

# 5. Heartbeat
curl -s -XPOST localhost:3000/edge/heartbeat \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"agentVersion":"1.0.0"}'

# 6. (negative) a bad key is rejected
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/edge/config -H "authorization: Bearer nope"   # → 401
```

---

## 7. What to change in `Pulse.Edge.Cloud`

`CloudClient` currently **simulates** everything against imagined `/api/...` paths and **fakes an instant key**. Migrate the three real calls; leave telemetry/events mocked.

| `CloudClient` method | Today (mock) | Change to |
|---|---|---|
| `RegisterDeviceAsync` | returns `(mockApiKey, mockSiteId)` immediately | `POST /edge/register` → returns `{ edgeId, status }`, **no key**. The key arrives later via operator config. Split "register" from "I have a key". |
| `SendHeartbeatAsync` | logs only | `POST /edge/heartbeat` with `Authorization: Bearer <key>` |
| (new) `GetConfigAsync` | — | `GET /edge/config` → site + known data sources |
| (new) `UpsertDataSourcesAsync` | — | `POST /edge/data-sources` (array body) |
| `SendTelemetryBatchAsync` | mock `POST /api/telemetry` | **leave mocked** — endpoint not built yet |
| `SendEventsBatchAsync` | mock `POST /api/events` | **leave mocked** — endpoint not built yet |

Suggested config keys for the edge (localhost defaults):

```jsonc
// appsettings.Development.json (or env)
{
  "Cloud": {
    "BaseUrl": "http://localhost:3000",   // NOT /api
    "ApiKey": "",                          // empty until operator pastes the issued key
    "HeartbeatSeconds": 30
  }
}
```

Implementation notes:
- Use one `HttpClient` with `BaseAddress = http://localhost:3000` and a default `Authorization: Bearer <ApiKey>` header set **after** the key is configured.
- On boot: if `ApiKey` is empty → call `register` (idempotent), log `edgeId` + `pending`, and wait for the operator to provide the key. If `ApiKey` is present → call `config`, push `data-sources`, start the heartbeat loop.
- Treat `401` from any keyed call as "de-provisioned/revoked": stop the heartbeat loop, clear the in-memory key, and surface a clear operator message.
- `deviceId` is yours and permanent; `edgeId` is the cloud's UUID for the same device. Persist both.

---

## 8. Gotchas / FAQ

- **404 on every call?** You're probably hitting `/api/edge/...`. The `/api` prefix is **only** the web dev proxy. Edge calls `/edge/...` directly.
- **400 `FST_ERR_CTP_EMPTY_JSON_BODY`?** You sent `Content-Type: application/json` with an **empty body** (e.g. on a bodyless POST). Only set the JSON content-type when you actually send a body.
- **400 on register?** `deviceId` isn't a valid UUID, or `hostname` is empty.
- **My device never gets a key.** That's expected until a human approves it in the Web UI. No approval = no key, by design.
- **`config` shows `site: null`?** The device isn't approved/assigned yet, or has been revoked.
- **Can two edges use `DS001`?** Yes. `externalId` is unique only within a device.
- **Where do telemetry frames go for now?** Nowhere real — keep `SendTelemetryBatchAsync` mocked. Ingestion (Step 9) is a separate, not-yet-built cloud workstream. Don't point it at a guessed endpoint.

---

## 9. Mapping to the registration-flow doc

This guide implements **Steps 3–8** of `PULSE_Edge_Registration_and_Data_Binding_Flow.md` against the *real* cloud. Steps 9–12 (telemetry flowing, DS→Work Unit→Asset binding, OEE insights) are **future cloud work** and remain mocked on the edge for now.
