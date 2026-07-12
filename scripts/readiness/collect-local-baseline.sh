#!/usr/bin/env bash

set -euo pipefail

db_path="${PULSE_EDGE_DB_PATH:-$HOME/.pulse/edge.db}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required." >&2
  exit 1
fi

if [[ ! -f "$db_path" ]]; then
  echo "PULSE database not found at $db_path" >&2
  exit 1
fi

sql_scalar() {
  sqlite3 -readonly -batch -noheader "$db_path" "$1"
}

file_size_bytes() {
  if stat -f '%z' "$1" >/dev/null 2>&1; then
    stat -f '%z' "$1"
  else
    stat -c '%s' "$1"
  fi
}

count_table() {
  local table="$1"
  sql_scalar "SELECT COUNT(*) FROM \"$table\";"
}

queue_oldest_age() {
  local table="$1"
  sql_scalar "SELECT CASE WHEN COUNT(*) = 0 THEN 'n/a' ELSE printf('%.1f', MAX(0, (julianday('now') - julianday(MIN(Timestamp))) * 24 * 60)) END FROM \"$table\";"
}

filesystem_line="$(df -Pk "$(dirname "$db_path")" | awk 'NR==2 {print $2 "|" $3 "|" $4 "|" $5}')"
IFS='|' read -r fs_total_kib fs_used_kib fs_available_kib fs_capacity <<<"$filesystem_line"

db_bytes="$(file_size_bytes "$db_path")"
wal_bytes=0
shm_bytes=0
[[ -f "$db_path-wal" ]] && wal_bytes="$(file_size_bytes "$db_path-wal")"
[[ -f "$db_path-shm" ]] && shm_bytes="$(file_size_bytes "$db_path-shm")"

process_rows="$(ps -axo pid=,etime=,rss=,%cpu=,comm= | awk '/Pulse\.Edge(\.Agent)?$/ {print}' || true)"
process_count="$(printf '%s\n' "$process_rows" | awk 'NF {count++} END {print count+0}')"
process_rss_kib="$(printf '%s\n' "$process_rows" | awk 'NF {sum += $3} END {print sum+0}')"
process_cpu="$(printf '%s\n' "$process_rows" | awk 'NF {sum += $4} END {printf "%.1f", sum+0}')"

cat <<EOF
# PULSE Edge Local Operational Baseline

- Captured UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
- Scope: local development/pilot node, read-only snapshot
- Database integrity: $(sql_scalar 'PRAGMA quick_check;')

## Host storage

| Metric | Value |
|---|---:|
| Filesystem total | ${fs_total_kib} KiB |
| Filesystem used | ${fs_used_kib} KiB |
| Filesystem available | ${fs_available_kib} KiB |
| Filesystem capacity | ${fs_capacity} |
| SQLite database | ${db_bytes} bytes |
| SQLite WAL | ${wal_bytes} bytes |
| SQLite shared memory | ${shm_bytes} bytes |

## Current process snapshot

| Metric | Value |
|---|---:|
| Matching PULSE processes | ${process_count} |
| Combined resident memory | ${process_rss_kib} KiB |
| Combined CPU snapshot | ${process_cpu}% |

## Configuration inventory

| Entity | Count |
|---|---:|
| Adapters | $(count_table DriverAdapters) |
| Data sources | $(count_table DataSources) |
| Data points | $(count_table DataPoints) |
| MQTT devices | $(count_table MqttDevices) |
| Stream templates | $(count_table StreamTemplates) |
| Local users | $(count_table LocalUsers) |

## Queue snapshot

| Queue | Records | Oldest age (minutes) |
|---|---:|---:|
| Telemetry | $(count_table QueueTelemetry) | $(queue_oldest_age QueueTelemetry) |
| Events | $(count_table QueueEvents) | $(queue_oldest_age QueueEvents) |

## Diagnostic inventory

| Entity | Count |
|---|---:|
| Audit events | $(count_table AuditEvents) |
| Diagnostic events | $(count_table DiagnosticEvents) |
| Enabled tags | $(sql_scalar 'SELECT COUNT(*) FROM DataPoints WHERE IsEnabled = 1;') |
| Tags reporting an error | $(sql_scalar "SELECT COUNT(*) FROM DataPoints WHERE LastError IS NOT NULL AND trim(LastError) <> '';") |

This snapshot does not establish capacity. Repeat it during idle, target load, cloud outage, and backlog recovery, and combine it with poll-cycle and cloud-acknowledgment measurements.
EOF
