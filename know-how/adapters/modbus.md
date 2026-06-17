# Modbus Adapter Guide (TCP & RTU)

This adapter supports polling Modbus TCP (over Ethernet) and Modbus RTU (over Serial Port/USB interface) devices.

---

## 1. Adapter Configuration Parameters

### Modbus TCP:
For Ethernet-based communication, define the host (IP) and port. The JSON configuration can define the target device slave ID (Unit ID):

```json
{
  "UnitId": 1
}
```

### Modbus RTU (Serial):
If the adapter protocol is set to `MODBUS_RTU`, the adapter's host field should specify the serial port (e.g. `COM3` on Windows, `/dev/ttyUSB0` on Linux/macOS) and port specifies the baud rate (e.g. `9600`). Custom settings are parsed from JSON:

```json
{
  "UnitId": 1,
  "Parity": "None",
  "DataBits": 8,
  "StopBits": "One",
  "Handshake": "None"
}
```

---

## 2. Address Syntax

Modbus registers are resolved by register type and offset address. You can write either the numeric prefix address or shorthand notations:

| Register Type | Prefix Notation | Shorthand |
| :--- | :--- | :--- |
| **Coil Status** | `00001` - `09999` | `c1`, `c2` |
| **Discrete Input** | `10001` - `19999` | `di1`, `di2` |
| **Input Register** | `30001` - `39999` | `ir1`, `ir2` |
| **Holding Register**| `40001` - `49999` | `hr1`, `hr2` |

---

## 3. Optimizations & Degradation Rules

Modbus TCP/RTU has specialized performance handling:

### 1. Block Read Grouping
Contiguous Input/Holding registers with matching scan intervals are dynamically merged and read in a single network request to minimize roundtrip overhead.

### 2. Degraded Read Mode
If a contiguous block-read fails (e.g. one register in the block is invalid/unconfigured on the PLC):
1. The driver catches the error.
2. It degrades automatically to individual single-register reads for every tag inside that block.
3. For individual reads, the driver retries up to $3$ times (with a $150\text{ms}$ delay) before marking the single register as offline.

### 3. Batch Telemetry
All polled metrics (both block-read successes and single-read fallbacks) are aggregated in memory and written to SQLite in a single transaction at the end of the tick.
