# PULSE Edge Product Specification

## Vision
PULSE Edge is a lightweight industrial edge agent that securely collects OT data, buffers it locally, and synchronizes it with PULSE Cloud.

Core responsibilities:

- Collect
- Normalize
- Buffer
- Transmit
- Manage

Analytics remain in the cloud.

---

# Architecture

PLC / Sensor / MQTT / OPC UA
↓
PULSE Edge
↓
PULSE Cloud

---

# Technology Stack

## Runtime
- .NET 9 Worker Service

## Local Database
- SQLite

## Local UI
- ASP.NET Core
- React

Access:
- http://localhost:8080

---

# Core Objects

## EdgeDevice
Represents one installed runtime.

Fields:
- DeviceId (UUID)
- SerialNumber
- Version
- SiteId

## DataSource
Logical industrial data stream.

Examples:
- CasePacker Production
- CasePacker Energy
- Palletizer Production
- Line Energy Meter

## DataPoint
Individual measurements inside a DataSource.

Production:
- good_count
- reject_count
- run_status
- fault_code

Energy:
- voltage
- current
- power
- energy

---

# Registration Flow

1. Generate DeviceId (UUID) on first startup
2. Register with cloud
3. Receive API Key and configuration
4. Begin heartbeat and synchronization

---

# Communication

## Events Endpoint

POST /api/events

Examples:
- Production Count
- Machine State
- Downtime
- Alarm
- Batch Event

## Telemetry Endpoint

POST /api/telemetry

Examples:
- Temperature
- Pressure
- Current
- Voltage
- Power

---

# Store and Forward

SQLite queues:

- EventQueue
- TelemetryQueue

Requirements:

- No event loss during internet outage
- Automatic retry
- Sequence tracking
- Duplicate protection

---

# Heartbeat

Default interval:
- 60 seconds

Reports:
- Version
- CPU
- Memory
- Disk
- Last Seen

---

# Protocol Drivers

## Phase 1
- OPC UA
- MQTT

## Phase 2
- Modbus TCP
- EtherNet/IP
- REST API

---

# Local Web UI

## Dashboard
- Connection Status
- Cloud Status
- Buffer Status
- Version
- Last Sync

## Data Sources
- Source Name
- Type
- Status
- Data Rate

## Protocols
- OPC UA
- MQTT

## Buffer
- Pending Events
- Pending Telemetry
- Retry Status

## Settings
- Cloud Endpoint
- Edge Serial
- Diagnostics

---

# Security

Phase 1:
- API Key Authentication
- HTTPS Only

Phase 2:
- Mutual TLS

---

# Repository Structure

```text
pulse-edge/
├── src/
│   ├── Pulse.Edge.Agent/
│   ├── Pulse.Edge.Api/
│   ├── Pulse.Edge.UI/
│   ├── Pulse.Edge.Storage/
│   ├── Pulse.Edge.Protocols.OpcUa/
│   ├── Pulse.Edge.Protocols.Mqtt/
│   └── Pulse.Edge.Cloud/
├── installers/
├── scripts/
├── docs/
└── docker/
```

---

# MVP Roadmap

1. Device Registration
2. Heartbeat
3. SQLite Storage
4. Event Queue
5. Telemetry Queue
6. Cloud Connector
7. OPC UA Driver
8. React UI
9. Data Source Management
10. Installer Script
