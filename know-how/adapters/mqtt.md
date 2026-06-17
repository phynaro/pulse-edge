# MQTT Adapter Guide

Unlike polling drivers, the MQTT driver is purely **event-driven**. It subscribes to an MQTT broker topic and processes incoming messages asynchronously.

---

## 1. Adapter Configuration Parameters

Configure broker connection endpoints in the adapter settings. Broker topics, parse modes (`Plaintext` or `JSON`), and device bindings are managed in the database schema.

---

## 2. Address Syntax & Parsing Modes

Each data point maps to an MQTT topic. Supported payload modes:

* **`Plaintext` Mode:** The message payload is read directly as a raw numeric value (e.g. topic `devices/temp` receives payload `23.5`).
* **`JSON` Mode:** The payload is parsed as JSON, and a JSON Path (e.g. `$.value`) extracts the target metric.

---

## 3. Data Reliability & Heartbeats (Stale Status)

MQTT lacks regular polling, so data status is maintained using heartbeats and Last Will and Testament (LWT) topics:

### 1. Last Will and Testament (LWT)
* Devices publish online/offline status packets (e.g. topic `devices/status` with payload `Offline`).
* The MQTT driver intercepts these messages and immediately sets all metrics mapped to that device to `DeviceTimeout` or `CommunicationLost` in the telemetry buffer.

### 2. Stale Evaluation
* If a publisher stops transmitting and does not emit a heartbeat packet, the driver flags the last known value as `Stale`.
* Values are still reported to the SQLite database, but their quality is explicitly marked as `"Stale"`.
