# PULSE Edge Data Source Cloud Registration Flow

This document outlines the detailed sequence and timing of when data sources configured on the local Edge Agent are published/registered to the **PULSE Cloud Control Plane**.

---

## Overview

Data sources (such as OPC-UA, MQTT, and Modbus configurations) and their associated metric data points are published to the cloud via the `POST /edge/data-sources` endpoint. The Edge Agent sends an array of logical data source declarations:

```json
[
  {
    "externalId": "ds-opcua-01",
    "name": "OPC UA Server Main",
    "metrics": ["temperature", "pressure", "humidity"],
    "protocol": "opcua"
  }
]
```

This registration is **idempotent** and serves to declare what metrics and protocols are available on the edge to the cloud control plane.

---

## When are Data Sources Published?

There are exactly **three scenarios** where data sources are synchronized/published to the cloud:

### 1. First-Time Self-Service Provisioning Flow
When a brand-new device boots up with no cached `ApiKey`, it initiates registration and claim polling. As soon as the operator approves the device and it receives its `ApiKey` from the claim endpoint:
- It calls `GET /edge/config` to verify settings and retrieve site metadata.
- On success, it immediately compiles the list of logical data sources and pushes them to the cloud.

### 2. Device Startup (Boot Phase with Existing API Key)
When the Edge Agent starts up and finds a cached `ApiKey` in the local SQLite DB:
- It calls `GET /edge/config` to check connectivity and fetch site configurations.
- On success, it reads the local database to find all current data sources and publishes them to the cloud.

### 3. Dynamic settings update
If an operator updates the system settings (changing the target `CloudEndpoint` or the `ApiKey`) via the local Edge UI/API:
- The background agent worker detects the changes (within 2 seconds).
- It initiates a verification against `GET /edge/config` with the new endpoint/credentials.
- On success, it pushes/updates all data source declarations using the new settings.

### 4. Dynamic Data Source Configuration Changes (State Checksum Check)
When the agent is running and connected:
- It calculates a SHA256 checksum of the local data sources and their metric mappings every 5 seconds.
- If the checksum changes compared to the last successfully synced hash (e.g., when a user creates a new data source or binds/unbinds a metric to it), the agent immediately triggers a sync to the cloud.
- This keeps the cloud metadata in sync with local UI configuration changes in near-real-time without requiring a device reboot.

---

## Roundtrip Sequence Diagram

The following diagram illustrates all three phases of data source registration:

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Operator / Cloud Portal
    participant LocalDB as Local SQLite DB
    participant Agent as Edge Agent (Worker)
    participant Cloud as PULSE Cloud Control Plane

    Note over Agent, Cloud: PHASE 1: First-Time Self-Service Provisioning Flow
    Agent->>LocalDB: Get cached credentials on startup
    LocalDB-->>Agent: No API Key found
    Agent->>Agent: Generate permanent DeviceId (UUID) & ClaimSecret
    Agent->>LocalDB: Persist DeviceId & ClaimSecret
    
    Agent->>Cloud: POST /edge/register { deviceId, hostname, agentVersion, claimSecretHash }
    Cloud-->>Agent: 200 OK { edgeId, status: "pending" }
    Agent->>LocalDB: Save edgeId & CloudStatus = "PendingApproval"

    loop Poll Claim Endpoint (every 20s)
        Agent->>Cloud: POST /edge/claim { deviceId, claimSecret }
        alt Not Approved Yet
            Cloud-->>Agent: 200 OK { status: "pending" }
        else Operator Approves Device
            Operator->>Cloud: Approve device & bind to site in portal
            Cloud-->>Agent: 200 OK { status: "active", apiKey: "..." }
        end
    end

    Agent->>LocalDB: Persist apiKey & update CloudStatus = "Connected"
    
    Agent->>Cloud: GET /edge/config (Header: Bearer apiKey)
    Cloud-->>Agent: 200 OK { siteId: "...", siteName: "..." }
    Agent->>LocalDB: Update SiteId & SiteName

    Agent->>LocalDB: Query local DataSources, DataPoints & Adapters
    LocalDB-->>Agent: Return local configurations
    
    Agent->>Cloud: POST /edge/data-sources { Array of [externalId, name, metrics[], protocol] }
    Cloud-->>Agent: 200 OK (Data sources registered & mapped)

    Note over Agent, Cloud: PHASE 2: Boot with Cached API Key
    Agent->>LocalDB: Get cached credentials on boot
    LocalDB-->>Agent: API Key found
    Agent->>Cloud: GET /edge/config (Header: Bearer apiKey)
    Cloud-->>Agent: 200 OK { siteId, siteName }
    
    Agent->>LocalDB: Query local DataSources, DataPoints & Adapters
    LocalDB-->>Agent: Return local configurations
    Agent->>Cloud: POST /edge/data-sources { Array of [externalId, name, metrics[], protocol] }
    Cloud-->>Agent: 200 OK (Data sources synced)
    
    Note over Agent, Cloud: PHASE 3: Dynamic Settings Update (via Local UI / API)
    Operator->>LocalDB: Save updated CloudEndpoint or API Key
    loop Agent Main Loop (Every 2s)
        Agent->>LocalDB: Check for configuration changes
        LocalDB-->>Agent: CloudEndpoint or API Key changed
    end
    Agent->>Cloud: GET /edge/config (Header: Bearer newApiKey)
    Cloud-->>Agent: 200 OK
    Agent->>LocalDB: Query local DataSources, DataPoints & Adapters
    LocalDB-->>Agent: Return local configurations
    Agent->>Cloud: POST /edge/data-sources { Array of [externalId, name, metrics[], protocol] }
    Cloud-->>Agent: 200 OK (Data sources re-synced)
