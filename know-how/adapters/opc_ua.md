# OPC UA Adapter Guide

This adapter allows PULSE Edge to act as an OPC UA client to read variables from OPC UA servers.

---

## 1. Adapter Configuration Parameters

Define host connection details in the adapter settings. The adapter automatically prefixes `opc.tcp://` and matches configuration:
* **Host:** `192.168.1.100` or `opc.tcp://192.168.1.100:4840`
* **Port:** `4840` (Default OPC UA port)

---

## 2. Address Syntax

Specify the OPC UA Node ID string format:

* **String Node ID:** `ns=2;s=Device1.Temperature`
* **Numeric Node ID:** `ns=1;i=1002`
* **GUID Node ID:** `ns=2;g=09087a11-c96c-4b53-8b74-27920199e4f5`

---

## 3. Optimizations & Execution Behavior

### Batch Read
The OPC UA driver utilizes native batch polling. At each tick, all due NodeIDs are gathered and queried collectively in a single roundtrip batch call to the OPC UA server:
```csharp
batchResult = await _opcUaDriver.ReadMetricsBatchAsync(nodeIds, ct);
```

### Batch Database Merging
* Read values are collected in memory and written using `EnqueueTelemetryBatchAsync` at the end of the tick.
* If the server read throws a communication exception, the adapter status is flagged as `"Error"` and all due tags are marked `DeviceTimeout`/`CommunicationLost`.
* If specific nodes return status errors, those individual tags are set to `DriverError`.
