# PULSE Edge Local Operational Baseline

- Captured UTC: 2026-07-12T07:34:00Z
- Scope: local development/pilot node, read-only snapshot
- Collector: `scripts/readiness/collect-local-baseline.sh`
- Database integrity: `ok`

## Host storage

| Metric | Value |
|---|---:|
| Filesystem total | 239,362,496 KiB |
| Filesystem used | 180,447,864 KiB |
| Filesystem available | 13,185,324 KiB |
| Filesystem capacity | 94% |
| SQLite database | 5,316,608 bytes |
| SQLite WAL | 4,161,232 bytes |
| SQLite shared memory | 32,768 bytes |

## Current process snapshot

| Metric | Value |
|---|---:|
| Matching PULSE processes | 2 |
| Combined resident memory | 38,896 KiB |
| Combined CPU snapshot | 8.7% |

This CPU value is a point-in-time `ps` sample, not an average or capacity result.

## Configuration inventory

| Entity | Count |
|---|---:|
| Adapters | 3 |
| Data sources | 3 |
| Data points | 57 |
| MQTT devices | 0 |
| Stream templates | 2 |
| Local users | 2 |

## Queue snapshot

| Queue | Records | Oldest age |
|---|---:|---:|
| Telemetry | 2 | 2.1 minutes |
| Events | 0 | n/a |

## Diagnostic inventory

| Entity | Count |
|---|---:|
| Audit events | 16 |
| Diagnostic events | 1,656 |
| Enabled tags | 57 |
| Tags reporting an error | 12 |

## Interpretation

- SQLite quick-check passed.
- PULSE persistent database and WAL total less than 10 MiB, so PULSE is not the primary source of host disk consumption in this snapshot.
- Host storage improved from the earlier approximately 3.6 GiB available/99% reading to approximately 12.6 GiB available/94%, but remains above a prudent operating threshold.
- Twelve of 57 enabled tags report an error; the snapshot is not a healthy acquisition-capacity baseline.
- Two queued telemetry records were present, with the oldest approximately 2.1 minutes old.

This evidence establishes a repeatable local snapshot, not capacity. G0 still requires measurements during idle, target load, cloud outage, and backlog recovery, including poll-cycle and cloud-acknowledgment latency.

