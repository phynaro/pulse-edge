# PULSE Edge Pilot Baseline Profile

**Status:** Draft for approval  
**Roadmap:** Phase 0 / Gate G0  
**Last reviewed:** 2026-07-12

This profile defines the proposed pilot support boundary and the measurements required to turn it into an approved baseline. Values marked **Proposed** are acceptance targets, not verified product limits.

## Supported deployment profile

The existing Windows deployment specification defines the initial production target as:

- Windows 10 or 11 Pro
- Windows Server 2019 or 2022
- Windows Service deployment
- x64 architecture
- Local web administration with outbound cloud connectivity

Linux and macOS are development environments only until they receive their own installation, service-management, upgrade, recovery, and certification evidence.

## Minimum pilot hardware

The following is the proposed minimum pilot profile and requires measurement in the target Windows environment:

| Resource | Proposed minimum | Validation required |
|---|---:|---|
| CPU | 2 x64 cores | Mixed-protocol load test |
| Memory | 1 GiB available to PULSE services | 72-hour pilot soak |
| Free disk at installation | 10 GiB | Installer preflight and outage-capacity calculation |
| Network | 100 Mbps Ethernet | Cloud outage/recovery and protocol latency tests |
| Clock | OS time synchronization enabled | Timestamp and reconnect validation |

The UI's current 512 MiB agent memory budget is an operational display convention and does not by itself prove the system-level minimum.

## Protocol implementation baseline

| Capability | Current implementation reference | Pilot status |
|---|---|---|
| OPC UA | `OPCFoundation.NetStandard.Opc.Ua.Client 1.5.378.145` | Implemented; device matrix TBD |
| Modbus TCP/RTU | `FluentModbus 5.3.2`, `System.IO.Ports 9.0.0` | Implemented; device matrix TBD |
| MQTT | `MQTTnet 5.1.0.1559` | Implemented; broker matrix TBD |
| EtherNet/IP | `libplctag 1.5.2` | Implemented; PLC matrix TBD |
| Siemens S7 | `S7netplus 0.20.0` | Implemented; PLC matrix TBD |
| BACnet | `BACnet 3.0.2` | Implemented; device matrix TBD |
| REST API/Webhook | PULSE REST protocol project | Implemented; contract matrix TBD |

Package versions identify the tested software baseline, not the full industrial protocol conformance level. Each pilot site must record the manufacturer, model, firmware, connection mode, security mode, and test result for attached equipment.

## Proposed pilot capacity envelope

These conservative starting values must be replaced by measured limits before G0 approval:

| Dimension | Proposed pilot target | G0 evidence |
|---|---:|---|
| Configured tags | 1,000 per node | Stable mixed-protocol acquisition test |
| Minimum polling interval | 1 second for a limited fast group | CPU, latency, and protocol load measurements |
| Default polling interval | 5 seconds | 72-hour soak |
| Logical streams | 100 per node | Configuration and cloud-binding test |
| Continuous cloud outage | 24 hours at target ingestion rate | Disk forecast plus replay test |
| Backlog recovery | Clear within 4 hours without starving live acquisition | Reconnection test |
| Local UI users | 10 | Authorization and session test |

Capacity is a combined envelope. Passing 1,000 tags at a five-second interval does not prove 1,000 tags at a one-second interval.

## Release and compatibility proposal

- Use semantic versions: `MAJOR.MINOR.PATCH`.
- Support upgrades from the immediately previous minor release to the current release.
- Never change the persistent schema without a versioned migration and preserved pre-migration backup.
- A patch release must not intentionally break configuration or cloud contracts.
- A minor release may add backward-compatible capability.
- A major release may change contracts only with an explicit migration plan.
- Retain the previous signed installer until the current release completes its observation period.
- Record application version, commit, schema version, and build date in every artifact and diagnostic bundle.

## Representative pilot fixture

The baseline test fixture should contain:

- One OPC UA adapter with healthy, bad-quality, and disconnected tags.
- One Modbus TCP adapter with multiple numeric types and an intentional timeout case.
- One MQTT adapter or device with reconnect and retained-message coverage.
- At least three streams: generic, electricity, and template-based.
- Bound and unbound template parameters.
- Telemetry and event queue data.
- Admin and read-only local users.
- A portable configuration export with documented secret-handling expectations.

The fixture must contain synthetic credentials and non-customer data so it can be stored and exercised safely.

## Required baseline measurements

Record these at idle, normal load, target load, cloud-disconnected load, and backlog recovery:

- Agent and API CPU usage
- Working set and memory trend
- Database, WAL, diagnostic log, and total PULSE disk growth
- Successful reads, failed reads, and tag-quality distribution
- Poll-cycle duration and missed/late polls
- Queue depth, oldest-record age, and ingestion rate
- Cloud delivery throughput and acknowledgment latency
- UI/API response latency
- Restart recovery time

## Approval record

| Role | Name | Decision | Date | Notes |
|---|---|---|---|---|
| Product | TBD | Pending | TBD | Approve pilot capacity and support promise |
| Engineering | TBD | Pending | TBD | Approve technical feasibility and fixture |
| Operations | TBD | Pending | TBD | Approve hardware and recovery assumptions |
| Security | TBD | Pending | TBD | Approve connectivity and credential assumptions |

