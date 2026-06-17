# Ethernet/IP Adapter Guide

This adapter allows PULSE Edge to read program tags from Rockwell/Allen-Bradley ControlLogix, CompactLogix, and Micro800 controllers using the open-source `libplctag` library.

---

## 1. Adapter Configuration Parameters

The configuration JSON should be entered in the adapter settings:

```json
{
  "PlcType": "ControlLogix",
  "Protocol": "ab_eip",
  "Path": "1,0",
  "TimeoutMs": 5000
}
```

### Key Fields:
* **`PlcType`**: The controller model. Supported values: `ControlLogix`, `CompactLogix`, `PLC5`, `SLC500`, `Micro800`, `MicroLogix`.
* **`Protocol`**: The underlying EIP transport. Defaults to `ab_eip`.
* **`Path`**: The connection path through backplanes/bridge cards. Typically `1,0` (Backplane slot 0) for Logix controllers.
* **`TimeoutMs`**: Time limit in milliseconds for individual tag reads.

---

## 2. Address Syntax

Specify PLC tag names directly as they are configured in RSLogix/Studio 5000:

* **Controller-Scoped Tag:** `MyControllerTag` or `Part_Counter`
* **Program-Scoped Tag:** `Program:MainProgram.MyLocalTag`
* **Array Tag Element:** `TemperatureArray[0]`
* **UDT / Struct Member:** `MachineRecipe.PackPerBox`

---

## 3. Execution Behavior

* **Sequential Execution:** Due to controller connection limits, tags are read one-by-one sequentially.
* **Batch Telemetry:** Reads are aggregated in memory. Once the entire due group has been processed, all metrics are enqueued to SQLite in one batch transaction using `EnqueueTelemetryBatchAsync`.
* **Quality Degradation:** If `ReadTagAsync` throws a network or timeout exception, the tag's quality status is set to `DeviceTimeout` (for 1-2 consecutive failures) or `CommunicationLost` (for 3+ consecutive failures).
