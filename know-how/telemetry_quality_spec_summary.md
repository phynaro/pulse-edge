# PULSE Edge: Telemetry Data Quality & Reliability Specification

This document summarizes the system design and implementation rules regarding how data quality is evaluated, stored, and reported from the Edge layer to PULSE Cloud.

---

## 1. Core Objectives
To ensure the integrity of industrial process monitoring, the Edge layer must guarantee that the Cloud can explicitly distinguish between:
* **Valid process values** (active PLC reads)
* **Temporary communication drops** (individual packet timeouts)
* **Total connection failures** (adapter/socket loss)
* **Data parsing/driver errors** (JSON path issues, payload corruption)

> [!IMPORTANT]
> **Rule of Edge Data Integrity:** The Edge agent **must never** silently interpolate fake/dummy values, repeat the last known value indefinitely (except when explicitly flagged as `Stale` in MQTT), or hide communication failures.

---

## 2. Telemetry Data Model
PULSE Edge groups metrics by logical **Data Source** (data stream) and **Timestamp** (truncated to millisecond precision).

The payload sent to the cloud is an array of `TelemetryFrame` objects:

```typescript
interface TelemetryFrame {
    dataSource: string;       // Unique ID for the logical stream (e.g. "DS001")
    ts: string;               // ISO 8601 UTC timestamp string (e.g. "2026-06-17T03:41:54.123Z")
    metrics: {
        [metricName: string]: number; // Numeric values ONLY. Booleans encoded as 1.0 (True) / 0.0 (False).
    };
    qualities: {
        [metricName: string]:
            | "Good"
            | "Uncertain"
            | "DeviceTimeout"
            | "CommunicationLost"
            | "DriverError"
            | "Stale"
            | "Heartbeat";
    };
}
```

### Omission Rule for Failed Polls
If a metric fails to poll:
1. It **must be omitted** from the `metrics` object (since the cloud ingestion strictly rejects `null` or non-numeric values).
2. It **must be explicitly present** in the `qualities` object with the appropriate error status (e.g., `"DeviceTimeout"`).

---

## 3. Quality Status Assignment Rules

The Edge Agent continuously tracks the health of each tag using a `ConsecutiveFailures` counter. The quality states are assigned dynamically:

| Quality State | Criteria | Behavior |
| :--- | :--- | :--- |
| **`Good`** | Polling succeeds | Value is mapped in `MetricsJson`. `ConsecutiveFailures` is reset to `0`. Quality is set to `"Good"`. |
| **`DeviceTimeout`** | Polling fails, but `ConsecutiveFailures < 3` | Value is omitted from `MetricsJson`. Quality is set to `"DeviceTimeout"`. |
| **`CommunicationLost`**| Polling fails, and `ConsecutiveFailures >= 3` | Value is omitted from `MetricsJson`. Quality degrades to `"CommunicationLost"`. |
| **`DriverError`** | Parse errors or driver exceptions | Value is omitted. Quality is set to `"DriverError"`. |
| **`Stale`** | Event-driven drivers (MQTT) receive no new message | Value is reported as last-known. Quality is set to `"Stale"`. |

---

## 4. Exponential Backoff & Degradation
To prevent the Edge agent from flooding a struggling device or PLC with network traffic, the system implements:

### Exponential Backoff
For any data point experiencing failures, its effective poll interval is scaled exponentially:
$$\text{EffectiveInterval} = \text{BaseInterval} \times 2^{\min(\text{ConsecutiveFailures},\, 6)}$$

*For example, a tag configured with a $1000\text{ms}$ poll interval that has failed 4 times will back off to $1000\text{ms} \times 2^4 = 16000\text{ms}$ ($16$ seconds) before its next read attempt.*

### Modbus Block Read Degradation
* Modbus TCP reads contiguous holding or input registers in single block-read commands to optimize speed.
* If a block-read fails, the driver degrades to individual single-register reads for every tag in that block.
* If a single read fails, it retries up to $3$ times (with a $150\text{ms}$ delay) before marking the tag as failed.

---

## 5. Local Database Store-and-Forward Schema
Buffered data is stored in the local SQLite table `QueueTelemetry`:

```sql
CREATE TABLE IF NOT EXISTS QueueTelemetry (
    Id            INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    DataSourceId  TEXT    NOT NULL,
    Timestamp     TEXT    NOT NULL,
    MetricsJson   TEXT    NOT NULL DEFAULT '{}',
    QualitiesJson TEXT    NOT NULL DEFAULT '{}',
    RetryCount    INTEGER NOT NULL DEFAULT 0,
    IsSending     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (DataSourceId, Timestamp)
);
```

### Dynamic Batch Merging
To prevent race conditions with the background `SyncService` (where the sync worker grabs a row before all sequential tag reads under the same timestamp are completed), drivers aggregate all readings in memory and call:
`await _storageService.EnqueueTelemetryBatchAsync(dataSourceId, now, metrics);`

This writes the entire tick's dataset (both successful metrics and bad qualities) in a single atomic database operation, ensuring they are sent to the cloud as a unified, complete frame.
