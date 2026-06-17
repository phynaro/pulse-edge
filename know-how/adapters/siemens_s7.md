# Siemens S7 Adapter Guide

This adapter allows PULSE Edge to read variables from Siemens S7-300, S7-400, S7-1200, and S7-1500 programmable logic controllers using the native Siemens S7 Protocol (via the `S7.Net` library).

---

## 1. Adapter Configuration Parameters

Configure S7 connection details using the following JSON parameters:

```json
{
  "CpuType": "S71200",
  "Rack": 0,
  "Slot": 1,
  "TimeoutMs": 5000
}
```

### Key Fields:
* **`CpuType`**: The model family of the Siemens PLC. Supported values: `S7200`, `S7300`, `S7400`, `S71200`, `S71500`.
* **`Rack`**: Physical rack number where the CPU sits (typically `0`).
* **`Slot`**: Physical slot number where the CPU sits (typically `1` for S7-1200/1500, or `2` for S7-300).
* **`TimeoutMs`**: Read transaction timeout in milliseconds.

---

## 2. Address Syntax

The address field maps S7 DBs, Merker flags, inputs, or outputs. Use standard S7.Net address parsing syntax:

* **Data Block Bit:** `DB1.DBX0.0` (DB 1, Offset 0, Bit 0)
* **Data Block Word (16-bit):** `DB5.DBW2` (DB 5, Offset 2)
* **Data Block DWord (32-bit Integer):** `DB10.DBD4` (DB 10, Offset 4)
* **Data Block Real (Float):** `DB20.DBD8` (DB 20, Offset 8)
* **Merker Memory:** `M100` or `MD20`
* **Inputs/Outputs:** `I0.0` (Input) or `Q0.0` (Output)

---

## 3. Execution Behavior

* **Sequential Execution:** Polled tags are executed one-by-one sequentially in an asynchronous loop to prevent S7 socket exhaustion.
* **Batch Telemetry:** Reads are aggregated in memory. Once the entire due group has been processed, all metrics are enqueued to SQLite in one batch transaction using `EnqueueTelemetryBatchAsync`.
* **Quality Degradation:** If `ReadTagAsync` throws a network or timeout exception, the tag's quality status is set to `DeviceTimeout` (for 1-2 consecutive failures) or `CommunicationLost` (for 3+ consecutive failures).
