# REST API Adapter Guide

This adapter allows PULSE Edge to query JSON HTTP REST endpoints and extract metrics from the response payloads.

---

## 1. Adapter Configuration Parameters

Define the HTTP endpoint port and host (e.g. `http://api.local/metrics` or similar). The JSON config sets the poll interval:

```json
{
  "PollIntervalMs": 10000
}
```

### Key Fields:
* **`PollIntervalMs`**: Polling rate in milliseconds. Minimum floor is set to `500` ms for execution safety.

---

## 2. Address Syntax

The address field specifies the JSON path mapping to the property key. If `MqttJsonPath` is defined on the datapoint, it takes precedence; otherwise, `Address` is used:

* **Shorthand JSON Path:** `$.temperature`
* **Nested Object Property:** `$.device.status.voltage`
* **Array Property Element:** `$.sensors[0].value`

---

## 3. Execution Behavior

* **Single HTTP Fetch:** To optimize HTTP traffic, the driver fetches the JSON payload **once** per polling tick for the entire group.
* **In-Memory Parsing:** The driver then loops through the tags and uses the JSON Path parser in-memory to extract values from the response payload.
* **Batch Telemetry:** The extracted values are aggregated and committed to SQLite in a single transaction using `EnqueueTelemetryBatchAsync`.
* **String Support:** Supports string data types (reports values as `null` value but quality `"Good"`, setting text in `LastValue` diagnostic field).
* **Degradation:** If the JSON path is not found, or the payload reports `null` / `"offline"` / `"timeout"`, quality degrades to `DriverError`, `DeviceTimeout`, or `CommunicationLost`.
