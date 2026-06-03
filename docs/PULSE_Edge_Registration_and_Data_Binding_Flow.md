# PULSE Edge Registration and Data Binding Flow

## Overview

PULSE Edge only knows about Data Sources.

PULSE Cloud manages:
- Enterprise
- Site
- Area
- Line
- Work Unit
- Asset

This design decouples data collection from business hierarchy and asset lifecycle.

---

# Step 1 - Install PULSE Edge

Install PULSE Edge on IPC, Industrial PC, Server, or Linux Gateway.

```bash
curl -fsSL https://install.pulseedge.io/install.sh | bash
```

---

# Step 2 - Generate Device Identity

Generate UUID on first startup and store locally forever.

Example:

deviceId:
4d3dbf7f-8c3a-4d44-a98b-f2c2f5f11322

---

# Step 3 - Register with Cloud

POST /api/edge/register

Payload:

{
  "deviceId":"4d3dbf7f-8c3a-4d44-a98b-f2c2f5f11322",
  "hostname":"PACKAGING-PC"
}

---

# Step 4 - Cloud Creates Edge Record

Cloud creates:

PULSE Edge #12
Status: Pending Approval

---

# Step 5 - User Approves Edge

Assign edge to Site A.

Cloud returns:
- Edge ID
- API Key
- Configuration

---

# Step 6 - Edge Authenticates

All future communication uses API Key authentication.

---

# Step 7 - Configure Protocols

Configure:
- OPC UA
- MQTT

Example OPC UA Endpoint:

opc.tcp://192.168.1.10:4840

---

# Step 8 - Create Data Sources

DS001 - CasePacker Production
DS002 - CasePacker Energy
DS003 - Palletizer Production

DS001:
- RunStatus
- GoodCount
- RejectCount
- FaultCode

DS002:
- Voltage
- Current
- Power
- Energy

DS003:
- RunStatus
- GoodCount
- RejectCount

Edge only knows Data Sources.
Edge does not know Assets, Locations, OEE, or ISA-95 hierarchy.

---

# Step 9 - Data Starts Flowing

{
  "dataSourceId":"DS001",
  "metric":"good_count",
  "value":1
}

Cloud stores against DS001.

---

# Step 10 - Bind Data Source

Administrator assigns:

DS001 -> CasePacker Work Unit

DS002 -> Packaging Line Energy Meter

---

# Step 11 - Bind Asset

Create Asset AB123.

Assign:

CasePacker Work Unit -> Asset AB123

Relationship:

DS001
 -> CasePacker
 -> Asset AB123

---

# Step 12 - Cloud Generates Insights

Incoming Event:

{
  "dataSourceId":"DS001",
  "metric":"good_count",
  "value":1
}

Cloud resolves:

DS001
 -> CasePacker
 -> Line 1
 -> Site A

Then calculates:

- Production
- Availability
- Performance
- Quality
- OEE

---

# Asset Replacement Example

Today:

CasePacker -> Asset AB123

Next Year:

CasePacker -> Asset XY789

Only asset assignment changes.

No changes required for:
- Edge Device
- Data Sources
- Historical Data
- Production Data
- OEE History

Everything still references DS001.

---

# Final Mental Model

PULSE Edge
    ↓
Data Source
    ↓
Cloud Metadata
    ↓
Location
    ↓
Asset
    ↓
Insights

Key Principle:

Data Sources are immutable identities of where data originates.

Assets and Locations are business context that may change over time.
