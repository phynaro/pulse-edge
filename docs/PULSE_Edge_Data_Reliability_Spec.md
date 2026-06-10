# PULSE Edge
## Data Reliability & Quality Specification
### Audience
Edge Development Team

## Objective
The Edge layer is responsible for guaranteeing that the Cloud can distinguish between:
- Valid process values
- Missing device communication (e.g., timeouts)
- Driver or parsing failures
- Local SQLite queue buffering states
- Edge agent health states (online/offline)

The Edge MUST NEVER silently hide communication problems or interpolate fake data.

---

## Data Flow

```
      Physical Devices / PLCs
                ↓
    Driver Adapters (Modbus TCP / OPC UA / MQTT)
                ↓
     Quality & Diagnostic Evaluation
                ↓ (Upsert merged metrics/qualities)
      Local Storage Buffer (SQLite: QueueTelemetry)
                ↓ (SyncService batch read)
     Cloud Sync (HTTP API: POST /edge/telemetry)
                ↓
     202 Accepted ACK from PULSE Cloud
                ↓
    Delete Local Buffered Record
```

---

## Unified Data Model (Telemetry Frame)
PULSE Edge groups metrics by Data Source (stream) and Timestamp. The payload format synchronized to the Cloud consists of a JSON array of `TelemetryFrame` objects:

```typescript
interface TelemetryFrame {
    dataSource: string;       // Data source code (e.g. "DS001"), unique to device
    ts: string;               // ISO 8601 UTC timestamp string (millisecond precision)
    metrics: {
        [metricName: string]: number; // Numeric values only (booleans encoded as 1.0/0.0)
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

Quality is mandatory for every polled metric. If a metric fails to poll:
- It is **omitted** from the `metrics` object (since the cloud telemetry ingestion endpoint strictly rejects non-numeric or `null` values).
- It is **explicitly included** in the `qualities` object with the appropriate error status (e.g., `"DeviceTimeout"`).

---

## Polling Drivers & Quality Evaluation

The polling loop evaluates communication status and updates both local diagnostics and the telemetry buffer.

### 1. Modbus TCP Driver (`ModbusDriver`)
- **Block-Read Grouping**: Polling groups are organized by `ScanIntervalMs` and Modbus `RegisterType` (Holding Registers / Input Registers). A contiguous block is read in a single operation to optimize communication.
- **Degradation / Fallback**:
  - If a block-read fails, the driver degrades to individual single-register reads for each tag in that block.
  - If a single-register read fails, it retries up to 3 times (with a 150ms delay).
- **Quality Status Assignment**:
  - **Good**: Polling succeeds. `ConsecutiveFailures` is reset to `0`, value is mapped in `MetricsJson`, quality is set to `"Good"` in `QualitiesJson`.
  - **DeviceTimeout**: Polling fails. `ConsecutiveFailures` is incremented. If `ConsecutiveFailures` is `< 3`, the value is omitted from `MetricsJson` and quality is set to `"DeviceTimeout"` in `QualitiesJson`.
  - **CommunicationLost**: If `ConsecutiveFailures` is `≥ 3` (threshold configurable), quality degrades to `"CommunicationLost"`.
  - **Exponential Backoff**: To avoid hammering failing devices, the polling interval is increased exponentially based on consecutive failures: `ScanIntervalMs * 2^(min(ConsecutiveFailures, 6))`.

### 2. OPC UA Driver (`OpcUaDriver`)
- **Batch Read**: Uses `_opcUaDriver.ReadMetricsBatch` to fetch all due NodeIDs in a single request.
- **Quality Status Assignment**:
  - If the batch read request throws an exception (e.g., PLC disconnected), the adapter status is updated to `"Error"`, and all due data points increment `ConsecutiveFailures` with quality `"DeviceTimeout"` or `"CommunicationLost"`.
  - If the batch read succeeds but specific tags are missing or report failure codes, those individual tags are assigned `"DeviceTimeout"` or `"DriverError"`.

### 3. MQTT Driver (`MqttDriver`)
- **Message Interception**: Message handler intercepts incoming packets on subscribed topics.
- **Value Extraction**: Supports `Plaintext` or `JSON` extraction (via `MqttJsonPath`).
- **Quality Status Assignment**:
  - **Good**: Successfully parsed value.
  - **DriverError**: Payload is invalid JSON or path is not found.
  - **Heartbeats**: Publishers should periodically emit heartbeats. If a heartbeat is missing, the driver sets the status to `"Stale"`.

---

## Local SQLite Storage Schema

### 1. Telemetry Queue (`QueueTelemetry` Table)
Holds the store-and-forward telemetry outbox. Uses a merged-metrics format where multiple metrics polled at the same tick share a single row.

| Column | Type | Description |
|---|---|---|
| `Id` | `INTEGER` | Primary Key, Auto-increment |
| `DataSourceId` | `TEXT` | ID of the data stream (e.g., `"DS001"`) |
| `Timestamp` | `DATETIME` | Poll-tick UTC timestamp (millisecond precision) |
| `MetricsJson` | `TEXT` | Serialized JSON dictionary of numeric values (e.g., `{"temp":85.3}`) |
| `QualitiesJson`| `TEXT` | Serialized JSON dictionary of metric qualities (e.g., `{"temp":"Good"}`) |
| `RetryCount` | `INTEGER` | Number of failed sync attempts |
| `IsSending` | `BOOLEAN` | Lock flag indicating record is in-flight to cloud |

### 2. DataPoint Config Table (`DataPoints`)
Tracks physical tag mapping, polling configurations, and live diagnostics.

- `Id`: UUID Primary Key
- `AdapterId`: Foreign Key to `DriverAdapter`
- `DataSourceId`: Mapped logical stream ID
- `Metric`: Mapped metric code name
- `Address`: Register offset, NodeID, or MQTT topic
- `DataType`: `"Float"`, `"Int32"`, `"Boolean"`, or `"String"`
- `ScanIntervalMs`: Polling rate in ms
- `ScaleFactor` / `Offset`: Linear scaling parameters
- `IsEnabled`: Flag to enable/disable polling
- **Diagnostic Columns**:
  - `LastValue`: Last successfully processed value string
  - `LastError`: Last execution error message (null if healthy)
  - `LastUpdated`: Timestamp of last poll execution
  - `ConsecutiveFailures`: Counter for backoff and quality status triggers

---

## Edge Status & Heartbeat Reporting

Rather than publishing status to an MQTT broker, the Edge Agent reports health directly to the Cloud via HTTP API:

- **Endpoint**: `POST /edge/heartbeat`
- **Interval**: Every 15 seconds
- **Authentication**: `Authorization: Bearer <ApiKey>`
- **Payload**:
  ```json
  {
      "agentVersion": "1.0.0"
  }
  ```
- **Local State Synchronization**:
  - On Success: Updates local `DeviceConfig.CloudStatus` to `"Connected"`.
  - On Revoked Key (401): Clears the api key and site bindings locally, setting `CloudStatus` to `"Revoked"`. Sync loop is paused.

---

## Design Rules

1. **Never Silently Interpolate**: Under no circumstance should the Edge generate dummy/fake values when communication fails.
2. **Explicit Bad Quality**: Missed polls MUST generate a record in `QueueTelemetry` with the timestamp, an omitted metric value (due to numeric limits), and an explicit bad quality status (`DeviceTimeout`/`CommunicationLost`) in `QualitiesJson`.
3. **Strict Data Separation**: In-flight sync errors use the store-and-forward queue mechanism, while physical connection failures degrade telemetry quality.
