# BACnet/IP Adapter Guide

This adapter allows PULSE Edge to poll values from building automation and control networks using BACnet/IP protocol.

---

## 1. Adapter Configuration Parameters

Configure connection settings using JSON configuration:

```json
{
  "DeviceId": 123
}
```

### Key Fields:
* **Host:** IP address of the BACnet interface/router.
* **Port:** UDP port (typically `47808` / `0xBAC0`).
* **`DeviceId`**: Mapped BACnet Device object instance number (Default `123`).

---

## 2. Address Syntax

Specify the target BACnet object type and instance index:

* **Format:** `<object-type>:<instance-index>`
* **Analog Input:** `analog-input:1`
* **Analog Value:** `analog-value:10`
* **Binary Input:** `binary-input:2`
* **Binary Value:** `binary-value:5`

---

## 3. Execution Behavior

* **Sequential Execution:** Polled tags are executed one-by-one sequentially in an asynchronous loop to prevent BACnet UDP buffer congestion.
* **Batch Telemetry:** Reads are aggregated in memory. Once the entire due group has been processed, all metrics are enqueued to SQLite in one batch transaction using `EnqueueTelemetryBatchAsync`.
* **Quality Degradation:** If the read throws an exception, the tag's quality status is set to `DeviceTimeout` (for 1-2 consecutive failures) or `CommunicationLost` (for 3+ consecutive failures).
