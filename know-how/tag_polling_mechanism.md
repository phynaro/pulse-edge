# PULSE Edge: Polling Engine & Tag Polling Mechanism

This document details the scheduling, thread safety, and execution rules of the PULSE Edge polling engine. It explains how poll intervals are enforced, how latency affects scheduling, and how database write operations are coordinated.

---

## 1. Concurrent Execution Architecture

The polling engine is designed with a hybrid concurrent/sequential model:

```
               Worker Loop Tick
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   Modbus Adapter  OPC UA Adapter  Ethernet/IP Adapter  (Parallel execution via Task.WhenAll)
       │               │               │
  Block Read       Batch Read   Sequential Tags
       │               │        ┌──────┴──────┐
       │               │        ▼             ▼
       │               │      Tag 1   ──►   Tag 2       (Sequential tag polling)
       └───────────────┼───────────────┘
                       ▼
            Batch Enqueue to SQLite
```

### Parallel Adapter Execution
The main worker loop (`Worker.cs`) processes all active and enabled driver adapters in parallel. In every tick, it launches the adapter polling tasks and awaits them collectively:
```csharp
var pollTasks = activeAdaptersForPolling.Select(async adapter => { ... });
await Task.WhenAll(pollTasks);
```
* **Isolation:** A delay, timeout, or block on one PLC or connection will **never** slow down or block the polling cycles of other adapters.

### Sequential Tag Polling (Within Adapter)
To protect PLC communication channels and network card resources, tags within a single adapter group are read sequentially (one-by-one) inside the poller loop using asynchronous network requests:
```csharp
foreach (var dp in dueDps)
{
    double rawVal = await _driver.ReadTagAsync(dp.Address, dp.DataType, ct);
    // ...
}
```
* **Safety:** This prevents socket exhaustion and keeps the PLC CPU utilization low.

---

## 2. Self-Adapting Scheduling & Latency Handling

The polling engine dynamically adapts to network conditions and device performance:

### No Overlapping Polls
Because the main worker loop awaits the completion of all adapter tasks before beginning the next tick (`await Task.WhenAll`), **a new polling cycle will never start while the previous one is still in-progress**. 
* This prevents overlapping requests, out-of-order data, and device congestion.

### Handling High Latency (Latency > Poll Interval)
When the time required to read all tags sequentially is greater than the configured poll interval (e.g. interval is configured to $100\text{ms}$ but network latency causes the read loop to take $500\text{ms}$):
1. **Loop Stretching:** The polling engine delays the next tick automatically. The tick time stretches to:
   $$\text{ActualTickTime} = \text{AdapterPollDuration} + \text{DefaultLoopSleep (100ms)}$$
   *In this case, the tick will run every $500\text{ms} + 100\text{ms} = 600\text{ms}$.*
2. **Immediate Catch-up:** During the next loop, the scheduling check determines that the time since the last update ($600\text{ms}$) is greater than the target interval ($100\text{ms}$). All tags are marked "due" and read **immediately** without additional delay.

---

## 3. Atomic Batch Enqueuing to Database

Previously, the polling loop enqueued metrics individually as they were read. Because of sequential read delays, the background sync worker could interleave, select a partially-filled row, lock it for cloud sync (`IsSending = 1`), and cause later tag reads to be discarded.

The engine now uses an atomic batch-enqueuing mechanism:

1. **In-Memory Accumulation:** The poller loop collects all read results (and their corresponding quality states) in a dictionary first:
   ```csharp
   var readings = new Dictionary<string, (double? Value, string Quality)>();
   ```
2. **Atomic SQLite Merge:** At the end of the polling cycle, the poller writes the entire batch to the database in a single SQLite transaction:
   ```csharp
   await _storageService.EnqueueTelemetryBatchAsync(dataSourceId, now, readings);
   ```
This guarantees that all metrics for a given polling tick are saved together under a unified timestamp, preventing the sync worker from splitting or locking out telemetry.
