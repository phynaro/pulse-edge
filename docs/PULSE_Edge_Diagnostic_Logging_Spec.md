# PULSE Edge Diagnostic Logging Specification

## Objective

Expose safe, useful edge-agent diagnostics in the local UI without turning SQLite into a duplicate high-volume log file or interfering with telemetry buffering.

## Architecture

All ASP.NET Core `ILogger` records continue through Serilog to the console and daily rolling files. A diagnostic sink additionally:

- keeps the latest 1,000 `Information`-and-higher records in a thread-safe memory ring for immediate UI access;
- broadcasts new records to authenticated browsers with Server-Sent Events (SSE);
- queues `Warning`, `Error`, and `Fatal` incidents for asynchronous SQLite persistence;
- never blocks an application or driver thread on database I/O.

In development `MultiPort` mode, the standalone Agent uses a bounded asynchronous provider to batch records to a loopback-only API ingestion endpoint. This makes Agent and driver logs behave like in-process records without exposing ingestion to remote clients or blocking polling threads. Production `SinglePort` mode captures those records directly through Serilog.

SQLite retains at most 10,000 incidents and 30 days of history. Cleanup runs after persistence batches. The rolling text files remain the complete operational record.

## Diagnostic record

Each record contains a sequence number, UTC timestamp, level, category/source context, rendered message, sanitized exception details, event identifier, and optional adapter, data-point, and correlation identifiers supplied as structured log properties.

Messages and details are bounded in length. Property names associated with passwords, authorization, tokens, secrets, API keys, cookies, and credentials are redacted before leaving the process.

## API

- `GET /api/diagnostic-logs/recent`: latest in-memory records; supports level, category, search, and limit.
- `GET /api/diagnostic-logs/history`: paginated persisted warning-and-higher incidents.
- `GET /api/diagnostic-logs/stream`: authenticated SSE stream for live records.
- `DELETE /api/diagnostic-logs`: admin-only deletion of persisted incident history and the memory ring.

Both roles may view diagnostics. Mutation authorization remains admin-only.

## UI

The `Logs` workspace presents a compact operations console with live/pause control, severity counters, level/category filters, text search, expandable exception details, connection state, and bounded rows. New live records appear without polling. Administrators receive a clear-history action; read-only users do not.

## Failure behavior

Diagnostic persistence is best-effort. A locked or unavailable SQLite database must not interrupt the edge agent, protocol polling, cloud synchronization, or file logging. SSE clients reconnect automatically and history remains available after process restarts for persisted incidents.

## Severity criteria

- `Warning`: operation is degraded or retrying, with no confirmed data loss.
- `Error`: an operation failed, but the Edge remains able to perform its core responsibilities.
- `Critical`: the Edge cannot safely perform its core responsibility, data loss is occurring or imminent, integrity is compromised, or the process is terminating unexpectedly.

Critical events are required for database initialization/schema failure, unrecoverable telemetry-buffer writes, hard buffer-cap pruning that discards telemetry, configuration integrity/tamper detection, partial factory-reset failure, unexpected main Worker termination, required credential-store failure, and unhandled host termination. A single adapter failure, tag read failure, retryable cloud outage, heartbeat `502`, and ordinary authentication failure must not be Critical.

The UI displays a persistent global banner whenever retained Critical incidents exist. The banner shows the latest incident and links to the filtered Logs workspace. It remains present until the critical history is cleared by an administrator.
