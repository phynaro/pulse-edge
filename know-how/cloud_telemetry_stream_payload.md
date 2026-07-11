# PULSE Cloud Telemetry Stream Payload

This document details the payload structure and processing behavior for sending live metric readings (telemetry streams) in batches from the local SQLite buffer to the PULSE Cloud orchestrator.

## Endpoint Details

- **Method:** `POST`
- **Path:** `/edge/telemetry`
- **Headers:**
  ```http
  Authorization: Bearer <ApiKey>
  Content-Type: application/json
  ```

---

## Payload Structure

The telemetry endpoint accepts a JSON array of telemetry frames. Each frame represents a snapshot of the metric readings for a specific data source stream at a single polling timestamp.

### Example Payload

```json
[
  {
    "dataSource": "DS001",
    "ts": "2026-06-17T06:20:54.123Z",
    "metrics": {
      "voltage": 230.45,
      "current": 4.82,
      "active_power": 1110.77,
      "power_factor": 0.98,
      "frequency": 50.01
    },
    "qualities": {
      "voltage": "Good",
      "current": "Good",
      "active_power": "Good",
      "power_factor": "Good",
      "frequency": "Good"
    }
  }
]
```

### Field Specifications

| Field | Type | Description |
| :--- | :--- | :--- |
| `dataSource` | `string` | The unique identifier of the telemetry data source stream (e.g., `"DS001"`). |
| `ts` | `string` | The ISO 8601 UTC timestamp of the collection moment, formatted as `yyyy-MM-ddTHH:mm:ss.fffZ`. |
| `metrics` | `object` | Key-value pairs where keys are the metric names and values are the numeric/boolean readings (e.g. `230.45`). |
| `qualities` | `object` | Key-value pairs where keys match the metrics, and values indicate the data quality (e.g. `"Good"`, `"Bad"`, or `"Uncertain"`). |

---

## Cloud Response Structure

- **Status Code:** `202 Accepted`
- **Body Example:**

```json
{
  "accepted": 1,
  "rejected": 0,
  "errors": []
}
```

### Response Field Specifications

| Field | Type | Description |
| :--- | :--- | :--- |
| `accepted` | `int` | Number of telemetry frames successfully processed and saved by the cloud database. |
| `rejected` | `int` | Number of telemetry frames rejected by the cloud (due to schema mismatches, unauthorized ids, or parsing errors). |
| `errors` | `array` | A list of errors detailing exactly why frames were rejected, including the array index of the failing frame. |

### Error Object Example
```json
{
  "index": 0,
  "reason": "Metric 'invalid_tag' not declared on DataSource 'DS001'"
}
```

---

## Store-and-Forward Sync Flow

1. **Local Buffering:** Raw metrics polled from device drivers are merged by data source ID and written to the local SQLite database (`QueueTelemetry` table).
2. **Batch Syncing:** The [SyncService](file:///Users/jirawuth/Projects/pulse-edge/src/Pulse.Edge.Cloud/Services/SyncService.cs) reads up to 100 pending rows, flags them as in-flight (`IsSending = true`), and transmits them in a single batch to `/edge/telemetry`.
3. **Completion & Clean-up:**
   - On `202 Accepted` with `rejected = 0`: The edge deletes the corresponding rows from the SQLite queue.
   - On Partial Rejection: The service logs the rejected frame indices and reasons, deleting the successfully accepted ones.
   - On Connection Failure: The agent rolls back the in-flight flag (`IsSending = false`), increments the retry counter, and waits before re-attempting transmission.
