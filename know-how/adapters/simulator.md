# Simulator Adapter Guide

This adapter provides simulated data points to facilitate offline testing and local UI demonstration.

---

## 1. Adapter Configuration Parameters

Configure simulated templates using the JSON setting:

```json
{
  "Template": "energy"
}
```

### Supported Templates:
* **`energy`**: Generates voltage, current, active power, and power factor readings.
* **`hvac`**: Generates temperature, humidity, setpoints, and compressor status readings.

---

## 2. Address Syntax

Specify the target simulated property name:

* **Energy template:** `Voltage`, `Current`, `ActivePower`, `PowerFactor`.
* **HVAC template:** `Temperature`, `Humidity`, `SetPoint`, `CompressorState`.

---

## 3. Execution Behavior

* **Local Simulator Engine:** Uses a local math generator in-memory (`SimulatorDriver`) to compute fluctuating values (simulating sine waves, random noise, and heat cycles).
* **Batch Telemetry:** Simulated metrics are aggregated and written in batch using `EnqueueTelemetryBatchAsync` at the end of each tick.
* **Always Online:** The simulator remains online with quality `"Good"` and is not subject to network communication dropouts.
