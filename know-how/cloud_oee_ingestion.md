# Edge OEE Ingestion Contract — Pulse Edge → PULSE Cloud

**Audience:** Edge-box software team (separate codebase)
**Cloud API base URL:** configured per deployment (e.g. `https://cloud.pulse.io`)
**Status:** Authoritative, v1 — implemented and live on the cloud API (`POST /edge/oee/channels`, `POST /edge/oee/events`)
**Prerequisite:** a paired, claimed device with an API key — see `docs/edge-contract/onboarding.md`. This document covers only the OEE data plane.
**Design authority:** `docs/superpowers/specs/2026-07-18-oee-module-v1-design.md` §2

---

## Overview

The edge observes machines and reports two things per monitored machine ("channel"): **state transitions** and **cumulative production counters**. The cloud does everything else — classification (planned vs unplanned, reasons), interval building, OEE math. This split is deliberate:

- **The edge is a dumb, reliable observer.** No business logic, no per-customer configuration in the edge. It reports what the PLC signals say, buffers when offline, and replays.
- **Everything is replayable.** Every message carries a per-channel sequence number; the cloud deduplicates on it. Re-sending anything already sent is always safe. When in doubt, re-send.
- **OEE data does NOT use `/edge/telemetry`.** These are semantic events, not numeric telemetry frames. Do not route OEE data through data sources / signal bindings.

```
boot ──► declare channels ──► [ state events on transition + sync every 60 s ] ──► outbox until 202
```

---

## 1. Authentication

Both endpoints require the device API key obtained from `POST /edge/claim`:

```
Authorization: Bearer <apiKey>
Content-Type: application/json
```

| Status | Meaning | Edge action |
|---|---|---|
| `401` | Missing/invalid/revoked API key | Stop sending; re-enter onboarding/claim flow |
| `409` | Device not paired to a site (defensive; a claimed device normally always has a site) | Stop sending; re-enter pairing |

---

## 2. Channel Declaration — `POST /edge/oee/channels`

A **channel** is one monitored machine, identified by an edge-local stable id (`externalId`). The edge never learns cloud UUIDs; the cloud maps channels to its asset tree via its own configuration.

### 2.1 Request

JSON array, **1–500 items**:

```json
[
  {
    "externalId": "line1.filler",
    "name": "Line 1 — Filler",
    "capabilities": ["state", "counters"]
  }
]
```

| Field | Type | Rules |
|---|---|---|
| `externalId` | string | Required, non-empty. **Stable forever** for this machine on this device — it is the channel's identity. Changing it creates a new channel and orphans history. MUST be unique within one declaration. |
| `name` | string | Required, non-empty. Human label; MAY change between declarations (cloud updates it). |
| `capabilities` | string[] | Subset of `["state", "counters"]`. Declare only what is actually wired. A state-only channel (no counter signals) declares `["state"]` and never sends `counters` — the cloud then treats counts as *unknown*, not zero. |

Unknown fields on an item are rejected. Any invalid item fails the **entire** declaration with `400` (unlike events, which fail per-message).

### 2.2 Rules

- **Declare on every boot, before sending any events**, and after any channel configuration change on the edge.
- Idempotent: identical re-declarations are harmless (`201` both times, same channel identities). The cloud updates `name`/`capabilities` and its last-declared timestamp on re-declaration.
- Events referencing an undeclared `externalId` are rejected per-message (§3.5) — declaration order matters.

### 2.3 Response

`201` with the cloud's channel rows (JSON array). The edge MAY ignore the body entirely; it does not need cloud ids.

---

## 3. Event Upload — `POST /edge/oee/events`

### 3.1 Envelope

JSON array, **1–5000 messages**, oldest first. `400` if empty, oversized, or not an array.

> **Recommended batch size ≤ 1000 messages.** The cloud's JSON body limit is ~1 MB; 1000 messages stays comfortably under it and matches the cloud's internal insert chunking.

### 3.2 Message types

Two types in v1, discriminated by `type`. **Both carry the same fields**; they differ only in meaning:

- **`state`** — a transition the edge observed. Sent at the moment the machine's state changes. These are the boundaries of downtime/runtime intervals, so timestamp accuracy matters most here.
- **`sync`** — a periodic assertion of the current state. Heartbeat + repair: it tells the cloud "nothing changed, the machine is still in state X, counters are now Y."

```json
{ "type": "state", "channel": "line1.filler", "seq": 4102,
  "ts": "2026-07-18T06:14:03.250Z", "state": "fault", "code": "E17",
  "counters": { "good": 182440, "reject": 3121 } }

{ "type": "sync", "channel": "line1.filler", "seq": 4103,
  "ts": "2026-07-18T06:15:00.000Z", "state": "fault", "code": "E17",
  "counters": { "good": 182440, "reject": 3121 } }
```

### 3.3 Field rules

| Field | Type | Rules |
|---|---|---|
| `type` | `"state"` \| `"sync"` | Required. Any other value → that message is rejected (this is how the contract evolves additively — see §7). |
| `channel` | string | Required. A declared `externalId` (§2). |
| `seq` | integer ≥ 0 | Required. **Per-channel, strictly monotonic increasing, persisted across edge restarts, never reused.** The cloud's dedup key is `(channel, seq)`. Prefer contiguous values: the cloud flags unfilled gaps as suspect data. |
| `ts` | string | Required. ISO-8601 with milliseconds; UTC `Z` preferred (numeric offsets accepted, normalized to UTC on store). This is the **observation time at the edge**, not the send time. |
| `state` | `"running"` \| `"stopped"` \| `"fault"` | Required. Machine-observable vocabulary only (§3.4). |
| `code` | string ≤ 64 chars | Optional. Opaque PLC state/fault/reason code passed through verbatim. The cloud maps codes to reasons via its own configuration — send whatever the PLC provides, don't interpret it. |
| `counters` | object | Optional; only for channels that declared the `counters` capability. `{ "good": int ≥ 0, "reject": int ≥ 0 (optional) }`. See §3.6. |

Unknown fields on a message → that message is rejected. All validation is **per-message**: one bad message never fails the batch.

### 3.4 State semantics — edge obligations

- `running` — the machine is producing (run signal true).
- `stopped` — not running, no distinct fault indication.
- `fault` — not running **and a real fault signal/word from the PLC says so**. Emit `fault` only where such a signal exists; a channel without one simply always uses `stopped` (+ `code` if available). Never infer faults.
- Debounce at the edge so signal chatter doesn't produce transition storms; the debounce window is an edge implementation detail (suggested 1–5 s).
- Classification — planned vs unplanned, micro-stops, downtime reasons — is **cloud-side**. The edge never needs to know shift calendars or reason lists.

### 3.5 Response — `202`

```json
{ "accepted": 3, "rejected": 1, "duplicates": 2, "errors": [ { "index": 2, "reason": "unknown channel 'ghost.channel'" } ] }
```

| Field | Meaning |
|---|---|
| `accepted` | Messages that validated and resolved to a channel — **including duplicates**. These are acknowledged: remove them from the outbox. |
| `duplicates` | Of the accepted, how many were already stored (same `(channel, seq)`). Informational; they are acknowledged like any accepted message. |
| `rejected` | Messages that failed. Each has an entry in `errors` with its zero-based `index` in the batch. |
| `errors[].reason` | `"invalid message"` (validation failure — **terminal**, fix the producer and drop the message, retrying can never succeed) or `"unknown channel '…'"` (ordering/config error — MAY be retried **after** re-declaring channels). |

### 3.6 Counters — cumulative totalizers only

- `good` / `reject` are **lifetime cumulative counts (totalizers), never deltas**. The cloud computes deltas, and handles PLC counter resets and rollovers itself — report the raw value as-is, even after a reset.
- Include `counters` on **every** `state` and `sync` message for counter-capable channels. Counter values captured at the exact transition moment are what make per-interval count attribution exact.
- If the counter read fails transiently, omit `counters` on that message rather than sending stale or zero values.

---

## 4. Delivery protocol — outbox until 202

The edge MUST implement a durable outbox:

1. Every generated message is appended to a persistent queue (survives process restart and power loss) with its assigned `seq`.
2. Send batches in order. A batch is removed from the outbox **only when a `202` is received** (accepted messages only; rejected ones are logged and dropped/held per §3.5).
3. On `503`, network error, timeout, or any non-2xx except `400`/`401`/`409`: keep the batch and **re-send the whole batch** after backoff (suggested: exponential, 5 s → 5 min cap). Duplicate re-sends are always safe — dedup makes replay a no-op.
4. `503` semantics: the cloud acknowledged nothing. Some rows MAY already be durably stored server-side — that is invisible and harmless; the full-batch re-send reconciles it.
5. `400` on the envelope (empty/oversized/not-an-array) is an edge bug: split or fix the batch; do not retry unchanged.

---

## 5. Sync cadence and liveness

- Emit `sync` per channel **every 60 seconds**, and immediately on boot and on reconnect (it re-asserts current state so an interval spanning an edge restart continues correctly — e.g. a fault that persisted through a reboot).
- Cloud liveness rule: after **~180 s without any message for a channel** (≈3 missed syncs), the cloud closes the open interval and records honest *no-data* time until messages resume. Buffered-and-replayed history repairs this retroactively — another reason the outbox matters.
- A `sync` whose `state` disagrees with what the cloud believes is treated as a repair: the cloud closes the old interval at the sync's `ts` and opens the asserted state (logged as an anomaly). Correct edges should rarely trigger this; frequent repairs indicate missed `state` events.

---

## 6. Edge obligations — compliance checklist

1. ☐ Persist per-channel monotonic `seq` across restarts; never reuse a value.
2. ☐ Durable outbox; a message leaves it only on `202` acknowledgment.
3. ☐ `sync` every 60 s per channel, plus on boot/reconnect.
4. ☐ Counters are cumulative totalizers, sent on every message where wired.
5. ☐ `fault` only from a real PLC fault signal; otherwise `stopped` + `code`.
6. ☐ Declare channels on every boot before sending events; `externalId` stable forever.
7. ☐ `ts` = observation time, ISO-8601 UTC with ms, from a clock disciplined by NTP where possible (the cloud records receive time and flags large skew).
8. ☐ Treat `"invalid message"` rejections as terminal (log + alert), `"unknown channel"` as re-declare-then-retry.

---

## 7. Reserved for future versions

- **`type: "job"`** — production run / SKU context (`{ type, channel, seq, ts, event: "start"|"end", jobRef, skuRef? }`) is reserved for phase 2. **Do not send it yet** — today it is rejected per-message like any unknown type. Because unknown `type` values are rejected per-message (never per-batch), a newer edge talking to an older cloud degrades gracefully, and vice versa.
- Additional `capabilities` values may be introduced; declare only values from this document's list.

---

## 8. Quick reference

| | |
|---|---|
| Declare channels | `POST /edge/oee/channels` — array 1–500, `201`, idempotent, whole-batch validation |
| Upload events | `POST /edge/oee/events` — array 1–5000 (recommend ≤1000), `202 {accepted, rejected, duplicates, errors}`, per-message validation |
| Auth | `Authorization: Bearer <apiKey>` (from onboarding claim) |
| Dedup key | `(channel, seq)` — replays are no-ops |
| States | `running` · `stopped` · `fault` (+ optional `code` ≤64 chars) |
| Counters | cumulative totalizers `{good, reject?}`, ints ≥ 0 |
| Sync cadence | 60 s per channel; cloud marks no-data after ~180 s silence |
| Retry statuses | `503`/network/timeout → re-send whole batch; `400` envelope → fix; `401`/`409` → re-onboard |

### Worked scenario — outage and replay

1. `10:00:00` machine faults → edge emits `state` seq 500 (`fault`, code `E17`, counters at that instant). Network is down → outbox holds it.
2. `10:01–10:20` edge keeps emitting `sync` seq 501–520 every 60 s into the outbox.
3. `10:20` network returns → edge sends one batch (seq 500–520) → `202 {accepted: 21, duplicates: 0}` → outbox cleared. Cloud rebuilds the fault interval retroactively, replacing the provisional no-data gap.
4. If the `202` response was lost in transit, the edge re-sends the same batch → `202 {accepted: 21, duplicates: 21}` → outbox cleared. Nothing double-counts.
