# PULSE Cloud Data Source and Metric Registration

This document details the payload structure and sync mechanism used by the PULSE Edge Agent to register its data sources (telemetry streams) and their metric configurations with the PULSE Cloud orchestrator.

## Endpoint Details

- **Method:** `POST`
- **Path:** `/edge/data-sources`
- **Headers:**
  ```http
  Authorization: Bearer <ApiKey>
  Content-Type: application/json
  ```

---

## Payload Structure

The payload consists of a JSON array containing data source declarations. Each data source contains its metrics (bound physical tags) along with the specific adapter connection metadata.

### Example Payload

```json
[
  {
    "externalId": "DS001",
    "name": "Factory Line 1 Energy",
    "metrics": [
      {
        "name": "active_power",
        "protocol": "modbus",
        "metadata": {
          "adapterId": "modbus-tcp-1",
          "mqttDeviceId": null,
          "address": "40001",
          "dataType": "Float",
          "scanIntervalMs": 1000,
          "scaleFactor": 1.0,
          "offset": 0.0,
          "byteOrder": "ABCD",
          "mqttParseMode": "Plaintext",
          "mqttJsonPath": null
        }
      },
      {
        "name": "voltage",
        "protocol": "modbus",
        "metadata": {
          "adapterId": "modbus-tcp-1",
          "mqttDeviceId": null,
          "address": "40003",
          "dataType": "Float",
          "scanIntervalMs": 1000,
          "scaleFactor": 1.0,
          "offset": 0.0,
          "byteOrder": "ABCD",
          "mqttParseMode": "Plaintext",
          "mqttJsonPath": null
        }
      }
    ]
  },
  {
    "externalId": "DS002",
    "name": "Machine Status",
    "metrics": [
      {
        "name": "status_code",
        "protocol": "mqtt",
        "metadata": {
          "adapterId": "mqtt-broker-1",
          "mqttDeviceId": "cnc-machine-1",
          "address": "factory/cnc1/status",
          "dataType": "Int32",
          "scanIntervalMs": 2000,
          "scaleFactor": 1.0,
          "offset": 0.0,
          "byteOrder": "ABCD",
          "mqttParseMode": "Json",
          "mqttJsonPath": "$.status.code"
        }
      }
    ]
  }
]
```

---

## Field Specifications

### Root Objects (Data Sources)

| Field | Type | Description |
| :--- | :--- | :--- |
| `externalId` | `string` | The unique identifier of the telemetry data source stream (e.g., `"DS001"`). |
| `name` | `string` | User-defined name of the data source stream. |
| `metrics` | `array` | A list of metrics registered/bound under this data source. |

### Metric Objects

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | The unique name of the metric tag (e.g., `"voltage"`). |
| `protocol` | `string` | The normalized protocol name recognized by the cloud (e.g. `"modbus"`, `"opcua"`, `"mqtt"`, `"ethernetip"`, `"siemenss7"`, `"bacnet"`, `"webhook"`, `"restapi"`, `"simulator"`). |
| `metadata` | `object` | An object containing detailed driver-specific acquisition settings. |

### Metric Metadata Details (`metadata`)

| Field | Type | Description |
| :--- | :--- | :--- |
| `adapterId` | `string` | The unique local identifier of the driver connection adapter. |
| `mqttDeviceId` | `string?` | The device identifier if using an MQTT broker (otherwise `null`). |
| `address` | `string` | The hardware register address, topic, tag path, or endpoint (e.g., `"40001"`, `"ns=2;s=Temp"`, `"factory/cnc1/status"`). |
| `dataType` | `string` | Data type format parsed from the hardware register (e.g., `"Float"`, `"Int32"`, `"Boolean"`, `"Int16"`). |
| `scanIntervalMs` | `int` | Ingestion polling interval rate in milliseconds. |
| `scaleFactor` | `double` | Scaling factor applied to raw register values. |
| `offset` | `double` | Offsets applied to raw values. |
| `byteOrder` | `string` | Modbus register endianness ordering pattern (e.g. `"ABCD"`, `"CDAB"`). |
| `mqttParseMode` | `string` | MQTT parsing logic instruction (`"Plaintext"` or `"Json"`). |
| `mqttJsonPath` | `string?` | JSONPath search expression for extracting metric data from payload (e.g. `"$.status.code"`). |

---

## Synchronization Triggers

This configuration payload is pushed to the cloud using the following lifecycles:
1. **Onboarding:** Fired immediately upon successful token creation and agent activation.
2. **Dynamic Polling Change:** Fired when any changes to enqueued metrics, tag bindings, driver configurations, or stream definitions are saved locally.
3. **Startup:** Fired at system boot to guarantee sync registry alignment.
