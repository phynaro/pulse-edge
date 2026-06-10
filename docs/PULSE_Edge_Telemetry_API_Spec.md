# PULSE Edge → Cloud Telemetry API Specification

**Audience:** PULSE Edge development team
**Owner:** PULSE Cloud team
**Status:** Live (implemented & verified) · **Version:** 1.0 · **Date:** 2026-06-05

This is the authoritative contract for how a PULSE Edge device sends **numeric
telemetry** to the cloud. Implement `CloudClient.SendTelemetryBatchAsync` against
this document. The endpoint is built and live; the contract below will not change
without a version bump.

---

## 1. Scope

- **In scope:** uploading batches of **numeric** telemetry samples (counts, rates,
  analog readings, numerically-encoded states) for storage and trending.
- **Out of scope (do NOT send here):** machine state-change events / downtime
  intervals / exact OEE inputs, and any non-numeric values. A separate
  events endpoint is planned but **does not exist yet** — keep
  `SendEventsBatchAsync` mocked.

---

## 2. Endpoint

| | |
|---|---|
| Method | `POST` |
| URL (dev) | `http://localhost:3000/edge/telemetry` |
| Path | `/edge/telemetry` — **no `/api` prefix** (the `/api` prefix only exists for the web app's browser proxy; a device calls the server directly) |
| Auth | `Authorization: Bearer <api_key>` |
| Content-Type | `application/json` |
| Body | JSON **array** of telemetry frames |

The base host/port is environment-specific; everything else is fixed.

---

## 3. Authentication

- Send the device API key as `Authorization: Bearer <api_key>`.
- Key format: `pe_live_` followed by 48 hex characters.
- The key is issued **once**, out-of-band, when an operator approves the device in
  the cloud UI (see the registration flow). There is no endpoint to fetch it; the
  operator configures it on the edge.
- A missing/invalid/revoked key → **`401`** (see §6). Treat a `401` on telemetry as
  "this device has been de-provisioned" — stop sending, keep data queued, and
  surface it to the operator (the device needs re-approval).
- **Scope is server-derived.** The cloud resolves `org`, `site`, and `edge_device`
  from the API key. The edge **must not** send those fields — any attempt to put
  them in the body is ignored. You only ever send the data source code, timestamp,
  and metric values.

---

## 4. Request payload

The body is a JSON **array** of 1 to **5000** *frames*. Each frame is one snapshot
of one data source at one instant, carrying one or more numeric metrics.

```json
[
  {
    "dataSource": "DS001",
    "ts": "2026-06-05T13:45:00.123Z",
    "metrics": { "good_count": 142, "temperature": 85.3, "run_status": 1 }
  },
  {
    "dataSource": "DS002",
    "ts": "2026-06-05T13:45:00.250Z",
    "metrics": { "current": 18.4, "power": 4.1 }
  }
]
```

### 4.1 Frame fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `dataSource` | **yes** | string | Non-empty. The edge-local data-source code, identical to the `externalId` you declared via `POST /edge/data-sources` (e.g. `DS001`). Unique only within this device. |
| `ts` | no | string | ISO-8601 UTC timestamp **with a time part and an explicit zone designator** — `Z` or a numeric offset like `+00:00`/`+07:00`. If omitted, the server stamps its receive time. Stored at **millisecond** precision. See §4.3. |
| `metrics` | **yes** | object | A map of `metricName → number`. Must have **≥ 1** entry. **Every value must be a finite JSON number.** See §4.2. |

### 4.2 Metric value rules (numeric-only)

- Every metric value **must be a finite number** (integer or float).
- **Rejected** (causes that frame to be rejected — see §6): strings (`"RUNNING"`),
  booleans (`true`), `null`, `NaN`, `+Infinity`/`-Infinity`, nested objects, and
  **arrays** (`metrics` must be a JSON object, not an array).
- **Encode states numerically.** Represent discrete states as numbers, e.g.
  `run_status`: `0`=stopped, `1`=running, `2`=fault. Keep the same encoding
  forever. (The *authoritative* state/OEE-event path is a separate future endpoint;
  numeric `run_status` here is for trending only.)
- All values are stored as **floating-point** fields. Don't rely on integer-vs-float
  distinction; `142` and `142.0` are equivalent.
- **Keep a metric name's meaning and unit stable.** A given metric name should
  always carry the same physical quantity and unit (e.g. `temperature` is always °C).
  Do the unit conversion on the edge; the cloud stores the number as-is.

### 4.3 Timestamps — read this carefully

- Use **UTC** with `Z` (e.g. `2026-06-05T13:45:00.123Z`) or a correct numeric offset.
- The timestamp must be the **actual sample time**, with **millisecond** resolution.
- **The device clock must be accurate (NTP-synced).** A wrong clock writes data at
  the wrong time and makes trends/correlation incorrect — a future-dated or
  past-dated sample lands outside the window operators look at.
- **De-duplication is last-write-wins** on the tuple
  *(device, dataSource, exact timestamp)*. Two samples for the same data source with
  the **identical** timestamp will overwrite each other. Ensure each sample for a
  given data source has a distinct timestamp.
- Multiple metrics for the same data source **at the same instant** belong in **one
  frame** (one `metrics` object). Don't split them into separate frames with the same
  `ts`.

### 4.4 Batch rules

- 1 ≤ array length ≤ **5000** frames per request. An empty array, a non-array body,
  or > 5000 frames → **`400`** (the whole request is rejected; nothing is stored).
- Frames within a batch are independent: a malformed frame is rejected individually
  without affecting the others (§6).
- A batch may mix multiple `dataSource` codes and multiple timestamps freely.

---

## 5. Prerequisite: declare your data sources first

Before (or alongside) sending telemetry, declare each data source via
`POST /edge/data-sources` (array of `{ externalId, name, metrics[], protocol? }`).
This makes the data source visible to operators for later asset binding.

Telemetry is **accepted regardless** of whether the data source was declared (the
ingest path does not block on it), but declaring is expected and keeps the system
coherent.

---

## 6. Responses & required edge behavior

| Status | Meaning | What the edge must do |
|---|---|---|
| **`202 Accepted`** | Batch processed. Body reports per-frame outcome (see §6.1). | Treat the batch as delivered. Inspect `rejected`/`errors` for frames the edge should fix (they will **never** succeed on retry as-is — they are malformed, not transient). Remove the accepted frames from the outbox. |
| **`400 Bad Request`** | The body wasn't a valid array of 1..5000 items. | **Do not retry as-is** — this is a client bug (wrong shape/oversized). Fix the request. Split oversized batches to ≤ 5000. |
| **`401 Unauthorized`** | Missing/invalid/revoked key. | **Stop sending**, keep data queued, alert the operator. Device likely needs re-approval. Do not hammer-retry. |
| **`503 Service Unavailable`** | Cloud could not accept the batch for storage right now. | **Transient — keep the batch in the outbox and retry** with backoff. |
| Network error / timeout / other `5xx` | Delivery uncertain. | Treat like `503`: keep in outbox and retry with backoff. |

**Delivery model is at-least-once.** Because last-write-wins de-dup is keyed on
*(device, dataSource, timestamp)*, retrying a batch with the same timestamps is
**safe and idempotent** — a duplicate just overwrites with the same values. Always
keep frames in a durable outbox until you receive a `202`.

### 6.1 The `202` body

```json
{
  "accepted": 1,
  "rejected": 1,
  "errors": [
    { "index": 1, "reason": "metric 'run_status' is not a finite number" }
  ]
}
```

- `accepted` — number of frames stored.
- `rejected` — number of frames rejected (still returns `202`; good frames were stored).
- `errors[]` — one entry per rejected frame: `index` is the frame's position in the
  request array; `reason` is a human-readable cause. Possible reasons include:
  `frame is not an object`, `dataSource must be a non-empty string`,
  `ts is not a valid ISO-8601 timestamp`, `metrics must be a non-empty object`,
  `metric '<name>' is not a finite number`.
- A rejected frame is a **data defect** on the edge side — log it; do not blindly
  retry it (it will be rejected again until the data is corrected).

---

## 7. How the cloud stores it (for your understanding)

Each frame becomes one InfluxDB point:

```
measurement: telemetry
tags:        org_id, site_id, edge_device_id, data_source   (all server-derived)
fields:      one float field per metric in the frame
time:        the frame's ts (or server receive time)
```

You don't need to act on this — it's here so you understand why `dataSource` and
`ts` matter (they define the series and the point identity) and why metrics must be
numeric (they become float fields).

---

## 8. Worked example (curl)

```bash
KEY=pe_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

curl -s -XPOST http://localhost:3000/edge/telemetry \
  -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '[
        {"dataSource":"DS001","ts":"2026-06-05T13:45:00.123Z",
         "metrics":{"good_count":142,"temperature":85.3,"run_status":1}},
        {"dataSource":"DS001","metrics":{"run_status":"RUNNING"}}
      ]'
# → {"accepted":1,"rejected":1,
#    "errors":[{"index":1,"reason":"metric 'run_status' is not a finite number"}]}
```

---

## 9. Edge implementation checklist

- [ ] Send to `POST {baseUrl}/edge/telemetry` — **no `/api`** prefix.
- [ ] `Authorization: Bearer <api_key>`; `Content-Type: application/json`.
- [ ] Body is a JSON **array** of frames; cap each request at **≤ 5000** frames (split larger).
- [ ] Each frame: `dataSource` (string, = declared `externalId`), optional `ts` (ISO-8601 UTC, `Z`/offset, ms), `metrics` (object of `name → finite number`, ≥ 1 entry).
- [ ] **Never** send `org`/`site`/`device` in the body.
- [ ] Encode states as numbers; convert units on the edge; keep metric names/units stable.
- [ ] **NTP-sync the device clock**; use real sample timestamps with distinct values per data source.
- [ ] Merge same-instant metrics of one data source into a single frame.
- [ ] Durable outbox; retry on `503`/`5xx`/network with backoff (idempotent by timestamp); stop and alert on `401`; fix-don't-retry on `400` and on per-frame `errors`.
- [ ] Declare data sources via `POST /edge/data-sources` first.

---

## 10. Limits & versioning

- Max **5000** frames per request. (No documented per-metric-count limit; keep
  frames reasonable.)
- This is **v1** of the telemetry contract. Backward-incompatible changes will be
  announced with a new version number. Additive fields may appear; ignore unknown
  response fields gracefully.
- Open cloud-side hardening (does not change this contract): buffer flush on
  shutdown and observable flush-failure logging.
```
