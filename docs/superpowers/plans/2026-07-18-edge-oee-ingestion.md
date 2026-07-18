# Edge OEE Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Edge OEE Ingestion Contract (`know-how/cloud_oee_ingestion.md`) — channel declaration + state/sync events through a durable per-channel-sequenced outbox — and remove the dead legacy event subsystem.

**Architecture:** New `OeeChannel`/`OeeOutboxMessage` SQLite tables (durable, never dropped); an `OeeStateEngine` singleton fed by the Worker's poll loop derives running/stopped/fault with debounce and appends messages with atomically-assigned per-channel seq; a dedicated `OeeSyncService` BackgroundService declares channels and drains the outbox to `POST /edge/oee/channels` / `POST /edge/oee/events` with exponential backoff, independent of the telemetry `SyncService`. Spec: `docs/superpowers/specs/2026-07-18-edge-oee-ingestion-design.md`.

**Tech Stack:** .NET 10 (Minimal APIs, EF Core + SQLite, BackgroundService, xunit), React 19 + Vite + vitest (PULSE design system).

## Global Constraints

- Build must pass `dotnet build Pulse.Edge.slnx --warnaserror` — zero warnings.
- `pnpm lint:ui` must report zero errors; `pnpm test:ui` green.
- Never hand-edit `packages.lock.json` / `pnpm-lock.yaml`. No new NuGet/npm dependencies are needed for this plan.
- Never hardcode secrets in tests — use `TestCredentials` (`src/Pulse.Edge.Tests/Integration/TestCredentials.cs`).
- Contract values (from `know-how/cloud_oee_ingestion.md`): states `running|stopped|fault`; `code` ≤ 64 chars; batch ≤ 1000 messages; dedup key `(channel, seq)`; sync every 60 s per channel; backoff 5 s → 5 min; counters are cumulative totalizers, ints ≥ 0; `ts` ISO-8601 UTC with milliseconds (`yyyy-MM-ddTHH:mm:ss.fffZ`).
- The OEE outbox tables are durable — never `DROP` them on boot (unlike `QueueTelemetry`).
- All work on branch `feature/edge-oee-ingestion`; never push to `main`.
- Run backend tests from repo root: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~<ClassName>`.
- **Deviation from spec §3 (approved rationale):** the reading tap is a single call in `Worker.ExecuteAsync` after the poll fan-out — NOT an `ITagReadingSink` implemented by all eight pollers. `Worker.cs:250` already polls every enabled DataPoint regardless of stream binding and pollers mutate `DataPoint.LastValue` in-memory on the instances Worker fetched, so one call site delivers scan-fresh values for every protocol with zero poller changes. Values read from `DataPoint.LastValue` may lag up to ~1 s for sub-second scan intervals (poller DB-write throttling); the ≥ 2 s debounce absorbs this.

## File Structure

| File | Responsibility |
|---|---|
| `src/Pulse.Edge.Storage/Models/OeeChannel.cs` (new) | Channel entity: identity, role bindings, NextSeq, live-state columns |
| `src/Pulse.Edge.Storage/Models/OeeOutboxMessage.cs` (new) | Durable outbox row |
| `src/Pulse.Edge.Storage/QueueDbContext.cs` | Add OEE DbSets; (Task 7) remove QueueEvents DbSet |
| `src/Pulse.Edge.Storage/Services/QueueStorageService.cs` | OEE DDL in `InitializeAsync`; (Task 7) drop legacy event methods/table |
| `src/Pulse.Edge.Storage/Services/OeeStorageService.cs` (new) | Channel CRUD, atomic seq enqueue, drain lifecycle, cap |
| `src/Pulse.Edge.Cloud/Services/CloudClient.cs` | OEE DTOs + `DeclareOeeChannelsAsync` + `SendOeeEventsBatchAsync`; testable ctor; (Task 7) remove mock `SendEventsBatchAsync` |
| `src/Pulse.Edge.Cloud/Services/SyncService.cs` | (Task 7) remove dead event branch |
| `src/Pulse.Edge.Agent/Services/OeeStateEngine.cs` (new) | State derivation, debounce, sync cadence, emission |
| `src/Pulse.Edge.Agent/Services/OeeSyncService.cs` (new) | Declaration + outbox drain BackgroundService |
| `src/Pulse.Edge.Agent/Worker.cs` | Call engine after poll fan-out |
| `src/Pulse.Edge.Agent/SimulatorDriver.cs` | Add reject counter address |
| `src/Pulse.Edge.Agent/Program.cs`, `src/Pulse.Edge.Api/Program.cs` | Registrations (both hosting modes) |
| `src/Pulse.Edge.Api/Endpoints/OeeEndpoints.cs` (new) | `/api/oee/*` channel CRUD + status + outbox |
| `src/Pulse.Edge.Api/Endpoints/{Buffer,Dashboard,Settings}Endpoints.cs` | Remove events route; OEE queue count; clear-buffer target |
| `src/Pulse.Edge.Tests/Oee*.cs` (new) | Unit + integration tests |
| `src/Pulse.Edge.UI/src/components/{BufferTab,OeeTab}.tsx`, `types.ts`, `context/*`, `hooks/useBufferStatus.ts`, `App.tsx` | UI |

---

### Task 1: OEE storage schema (models, DbSets, DDL, crash-reset)

**Files:**
- Create: `src/Pulse.Edge.Storage/Models/OeeChannel.cs`
- Create: `src/Pulse.Edge.Storage/Models/OeeOutboxMessage.cs`
- Modify: `src/Pulse.Edge.Storage/QueueDbContext.cs` (DbSets, after line 34)
- Modify: `src/Pulse.Edge.Storage/Services/QueueStorageService.cs` (`InitializeAsync` DDL before the Telemetry Queue Migration block at ~line 410; `ResetSendingStatusAsync` at ~line 873)
- Test: `src/Pulse.Edge.Tests/OeeStorageSchemaTests.cs`

**Interfaces:**
- Produces: `OeeChannel` (int `Id`, string `ExternalId`, string `Name`, bool `Enabled`, string `RunDataPointId`, string? `FaultDataPointId`, string? `CodeDataPointId`, string? `GoodDataPointId`, string? `RejectDataPointId`, int `DebounceSeconds`=2, long `NextSeq`, string? `LastState`, DateTime? `LastStateChangedAt`, string? `LastCode`, DateTime `UpdatedAt`); `OeeOutboxMessage` (int `Id`, int `ChannelId`, long `Seq`, string `Type`, DateTime `Ts`, string `State`, string? `Code`, long? `GoodCount`, long? `RejectCount`, bool `IsSending`, int `RetryCount`, DateTime `CreatedAt`); `db.OeeChannels`, `db.OeeOutboxMessages`.

- [ ] **Step 1: Write the failing test**

```csharp
// src/Pulse.Edge.Tests/OeeStorageSchemaTests.cs
using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public class OeeStorageSchemaTests
{
    [Fact]
    public async Task Initialize_CreatesOeeTables_AndDuplicateSeqIsRejected()
    {
        var service = new QueueStorageService();
        await service.InitializeAsync();

        var externalId = "schema-test-" + Guid.NewGuid().ToString("N");
        int channelId;
        using (var db = new QueueDbContext())
        {
            var channel = new OeeChannel
            {
                ExternalId = externalId,
                Name = "Schema Test",
                RunDataPointId = "dp-run",
                UpdatedAt = DateTime.UtcNow,
            };
            db.OeeChannels.Add(channel);
            await db.SaveChangesAsync();
            channelId = channel.Id;

            db.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = channelId, Seq = 0, Type = "sync", Ts = DateTime.UtcNow,
                State = "running", CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        try
        {
            using var db2 = new QueueDbContext();
            db2.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = channelId, Seq = 0, Type = "sync", Ts = DateTime.UtcNow,
                State = "running", CreatedAt = DateTime.UtcNow,
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => db2.SaveChangesAsync());
        }
        finally
        {
            using var cleanup = new QueueDbContext();
            await cleanup.OeeOutboxMessages.Where(m => m.ChannelId == channelId).ExecuteDeleteAsync();
            await cleanup.OeeChannels.Where(c => c.Id == channelId).ExecuteDeleteAsync();
        }
    }

    [Fact]
    public async Task Initialize_ResetsStuckInFlightOutboxRows()
    {
        var service = new QueueStorageService();
        await service.InitializeAsync();

        int channelId;
        using (var db = new QueueDbContext())
        {
            var channel = new OeeChannel
            {
                ExternalId = "stuck-test-" + Guid.NewGuid().ToString("N"),
                Name = "Stuck", RunDataPointId = "dp-run", UpdatedAt = DateTime.UtcNow,
            };
            db.OeeChannels.Add(channel);
            await db.SaveChangesAsync();
            channelId = channel.Id;
            db.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = channelId, Seq = 0, Type = "state", Ts = DateTime.UtcNow,
                State = "fault", IsSending = true, CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        try
        {
            await service.InitializeAsync(); // simulated restart

            using var db3 = new QueueDbContext();
            var row = await db3.OeeOutboxMessages.SingleAsync(m => m.ChannelId == channelId);
            Assert.False(row.IsSending);
        }
        finally
        {
            using var cleanup = new QueueDbContext();
            await cleanup.OeeOutboxMessages.Where(m => m.ChannelId == channelId).ExecuteDeleteAsync();
            await cleanup.OeeChannels.Where(c => c.Id == channelId).ExecuteDeleteAsync();
        }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStorageSchemaTests`
Expected: FAIL to compile — `OeeChannel` / `OeeOutboxMessages` not defined.

- [ ] **Step 3: Create the two model files**

```csharp
// src/Pulse.Edge.Storage/Models/OeeChannel.cs
using System;

namespace Pulse.Edge.Storage.Models;

/// <summary>
/// One monitored machine for OEE ingestion. ExternalId is the contract identity
/// (know-how/cloud_oee_ingestion.md §2) — stable forever; the API refuses to change it.
/// NextSeq is the persistent per-channel sequence counter; it is only ever incremented,
/// inside the same transaction that inserts the outbox row (never reset, never reused).
/// </summary>
public class OeeChannel
{
    public int Id { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;

    // Role bindings reference DataPoint.Id (string UUID). Run is required; the rest optional.
    public string RunDataPointId { get; set; } = string.Empty;
    public string? FaultDataPointId { get; set; }
    public string? CodeDataPointId { get; set; }
    public string? GoodDataPointId { get; set; }   // binding this derives the "counters" capability
    public string? RejectDataPointId { get; set; }

    public int DebounceSeconds { get; set; } = 2;
    public long NextSeq { get; set; }

    // Live-state snapshot for the UI/status endpoint (works across processes in MultiPort mode).
    public string? LastState { get; set; }
    public DateTime? LastStateChangedAt { get; set; }
    public string? LastCode { get; set; }

    // Bumped on every create/update; OeeSyncService re-declares when it sees a newer stamp.
    public DateTime UpdatedAt { get; set; }
}
```

```csharp
// src/Pulse.Edge.Storage/Models/OeeOutboxMessage.cs
using System;

namespace Pulse.Edge.Storage.Models;

/// <summary>
/// Durable OEE outbox row. Deleted ONLY on a 202 acknowledgment (or terminal
/// "invalid message" rejection). Unique (ChannelId, Seq) mirrors the cloud dedup key.
/// </summary>
public class OeeOutboxMessage
{
    public int Id { get; set; }
    public int ChannelId { get; set; }
    public long Seq { get; set; }
    public string Type { get; set; } = string.Empty;   // "state" | "sync"
    public DateTime Ts { get; set; }                    // observation time, UTC
    public string State { get; set; } = string.Empty;  // "running" | "stopped" | "fault"
    public string? Code { get; set; }
    public long? GoodCount { get; set; }               // null = counters omitted on this message
    public long? RejectCount { get; set; }
    public bool IsSending { get; set; }
    public int RetryCount { get; set; }
    public DateTime CreatedAt { get; set; }
}
```

- [ ] **Step 4: Add DbSets to `QueueDbContext.cs`**

After line 34 (`DiagnosticCaptureConfigs`), add:

```csharp
    public DbSet<OeeChannel> OeeChannels => Set<OeeChannel>();
    public DbSet<OeeOutboxMessage> OeeOutboxMessages => Set<OeeOutboxMessage>();
```

And in `OnModelCreating` (after the secret converter registrations, before the closing brace) add the unique indexes so `EnsureCreatedAsync` builds them on fresh databases:

```csharp
        modelBuilder.Entity<OeeChannel>().HasIndex(x => x.ExternalId).IsUnique();
        modelBuilder.Entity<OeeOutboxMessage>().HasIndex(x => new { x.ChannelId, x.Seq }).IsUnique();
```

- [ ] **Step 5: Add idempotent DDL for existing databases**

In `QueueStorageService.InitializeAsync()`, immediately BEFORE the `// ── Telemetry Queue Migration ──` comment (~line 410), add (matching the existing try/catch convention; these tables are durable — no DROP):

```csharp
        // ── OEE tables (durable — never dropped; see docs/superpowers/specs/2026-07-18-edge-oee-ingestion-design.md) ──
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS OeeChannels (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ExternalId TEXT NOT NULL UNIQUE,
                    Name TEXT NOT NULL,
                    Enabled INTEGER NOT NULL DEFAULT 1,
                    RunDataPointId TEXT NOT NULL,
                    FaultDataPointId TEXT,
                    CodeDataPointId TEXT,
                    GoodDataPointId TEXT,
                    RejectDataPointId TEXT,
                    DebounceSeconds INTEGER NOT NULL DEFAULT 2,
                    NextSeq INTEGER NOT NULL DEFAULT 0,
                    LastState TEXT,
                    LastStateChangedAt TEXT,
                    LastCode TEXT,
                    UpdatedAt TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS OeeOutboxMessages (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ChannelId INTEGER NOT NULL,
                    Seq INTEGER NOT NULL,
                    Type TEXT NOT NULL,
                    Ts TEXT NOT NULL,
                    State TEXT NOT NULL,
                    Code TEXT,
                    GoodCount INTEGER,
                    RejectCount INTEGER,
                    IsSending INTEGER NOT NULL DEFAULT 0,
                    RetryCount INTEGER NOT NULL DEFAULT 0,
                    CreatedAt TEXT NOT NULL,
                    UNIQUE (ChannelId, Seq)
                );
                CREATE INDEX IF NOT EXISTS idx_oee_outbox_pending
                    ON OeeOutboxMessages (IsSending, Id);
            ");
        }
        catch {}
```

- [ ] **Step 6: Extend `ResetSendingStatusAsync`**

In `ResetSendingStatusAsync()` (~line 873), after the `stuckEvents` block, add:

```csharp
        var stuckOee = await db.OeeOutboxMessages.Where(x => x.IsSending).ToListAsync();
        foreach (var m in stuckOee)
        {
            m.IsSending = false;
        }
```

and change the save condition to `if (stuckTelemetry.Any() || stuckEvents.Any() || stuckOee.Any())`. (Task 7 removes the `stuckEvents` block again — that is expected.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStorageSchemaTests`
Expected: PASS (2 tests).

- [ ] **Step 8: Build clean and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Storage/ src/Pulse.Edge.Tests/OeeStorageSchemaTests.cs
git commit -m "feat(oee): durable OeeChannel/OeeOutboxMessage schema with crash-reset"
```

---

### Task 2: OeeStorageService — channel CRUD + atomic sequence enqueue

**Files:**
- Create: `src/Pulse.Edge.Storage/Services/OeeStorageService.cs`
- Test: `src/Pulse.Edge.Tests/OeeStorageServiceTests.cs`

**Interfaces:**
- Consumes: Task 1 models/DbSets.
- Produces: `OeeStorageService` (register as Singleton later) with:
  - `Task<List<OeeChannel>> GetChannelsAsync()`
  - `Task<OeeChannel?> GetChannelAsync(int id)`
  - `Task<OeeChannel> CreateChannelAsync(OeeChannel channel)`
  - `Task<bool> UpdateChannelAsync(OeeChannel updated)` — updates Name/Enabled/bindings/Debounce, bumps `UpdatedAt`; never touches `ExternalId`/`NextSeq`
  - `Task<bool> DeleteChannelAsync(int id)` — deletes channel + its outbox rows in one transaction
  - `Task<long?> EnqueueMessageAsync(int channelId, string type, DateTime tsUtc, string state, string? code, long? goodCount, long? rejectCount)` — returns assigned seq, or null if the channel no longer exists

- [ ] **Step 1: Write the failing tests**

```csharp
// src/Pulse.Edge.Tests/OeeStorageServiceTests.cs
using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public class OeeStorageServiceTests : IAsyncLifetime
{
    private readonly QueueStorageService _queueStorage = new();
    private readonly OeeStorageService _oee = new();
    private int _channelId;

    public async Task InitializeAsync()
    {
        await _queueStorage.InitializeAsync();
        var channel = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "svc-test-" + Guid.NewGuid().ToString("N"),
            Name = "Service Test",
            RunDataPointId = "dp-run",
        });
        _channelId = channel.Id;
    }

    public async Task DisposeAsync()
    {
        await _oee.DeleteChannelAsync(_channelId);
    }

    [Fact]
    public async Task Enqueue_AssignsMonotonicSeq_PersistedAcrossServiceInstances()
    {
        var s1 = await _oee.EnqueueMessageAsync(_channelId, "state", DateTime.UtcNow, "running", null, 100, 2);
        var s2 = await _oee.EnqueueMessageAsync(_channelId, "sync", DateTime.UtcNow, "running", null, 101, 2);
        Assert.Equal(0, s1);
        Assert.Equal(1, s2);

        // "Restart": a brand-new service instance must continue from the persisted counter.
        var fresh = new OeeStorageService();
        var s3 = await fresh.EnqueueMessageAsync(_channelId, "sync", DateTime.UtcNow, "running", null, 102, 2);
        Assert.Equal(2, s3);

        using var db = new QueueDbContext();
        var channel = await db.OeeChannels.SingleAsync(c => c.Id == _channelId);
        Assert.Equal(3, channel.NextSeq);
    }

    [Fact]
    public async Task Enqueue_UpdatesLiveStateSnapshot_OnStateChangeOnly()
    {
        var ts1 = new DateTime(2026, 7, 18, 6, 0, 0, DateTimeKind.Utc);
        await _oee.EnqueueMessageAsync(_channelId, "state", ts1, "fault", "E17", null, null);

        using (var db = new QueueDbContext())
        {
            var c = await db.OeeChannels.SingleAsync(x => x.Id == _channelId);
            Assert.Equal("fault", c.LastState);
            Assert.Equal("E17", c.LastCode);
            Assert.Equal(ts1, DateTime.SpecifyKind(c.LastStateChangedAt!.Value, DateTimeKind.Utc));
        }

        // A sync asserting the same state must NOT move LastStateChangedAt.
        var ts2 = ts1.AddMinutes(1);
        await _oee.EnqueueMessageAsync(_channelId, "sync", ts2, "fault", "E17", null, null);
        using (var db = new QueueDbContext())
        {
            var c = await db.OeeChannels.SingleAsync(x => x.Id == _channelId);
            Assert.Equal(ts1, DateTime.SpecifyKind(c.LastStateChangedAt!.Value, DateTimeKind.Utc));
        }
    }

    [Fact]
    public async Task Enqueue_ReturnsNull_WhenChannelDeleted()
    {
        var doomed = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "doomed-" + Guid.NewGuid().ToString("N"),
            Name = "Doomed", RunDataPointId = "dp-run",
        });
        await _oee.DeleteChannelAsync(doomed.Id);
        var seq = await _oee.EnqueueMessageAsync(doomed.Id, "sync", DateTime.UtcNow, "running", null, null, null);
        Assert.Null(seq);
    }

    [Fact]
    public async Task DeleteChannel_RemovesItsOutboxRows()
    {
        var victim = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "victim-" + Guid.NewGuid().ToString("N"),
            Name = "Victim", RunDataPointId = "dp-run",
        });
        await _oee.EnqueueMessageAsync(victim.Id, "sync", DateTime.UtcNow, "running", null, null, null);
        await _oee.DeleteChannelAsync(victim.Id);

        using var db = new QueueDbContext();
        Assert.Equal(0, await db.OeeOutboxMessages.CountAsync(m => m.ChannelId == victim.Id));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStorageServiceTests`
Expected: FAIL to compile — `OeeStorageService` not defined.

- [ ] **Step 3: Implement `OeeStorageService` (CRUD + enqueue)**

```csharp
// src/Pulse.Edge.Storage/Services/OeeStorageService.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Storage.Services;

/// <summary>
/// Storage layer for the OEE data plane (know-how/cloud_oee_ingestion.md).
/// Seq assignment and outbox insertion happen in ONE SQLite transaction so a
/// sequence number can never be handed out twice, even across a crash —
/// SQLite serializes writers, making assign-and-persist atomic.
/// </summary>
public class OeeStorageService
{
    // Disk safety valve: ~69 days of 1/min syncs for one channel. Rows normally leave
    // the outbox only on 202 acknowledgment; this cap only bites during a very long
    // cloud outage, and pruning is surfaced as an OEE_DATA_LOSS diagnostic.
    private const int MaxOutboxRows = 100_000;
    private static long _lastOutboxLossCriticalTicks;

    // ── Channels ─────────────────────────────────────────────────────────────

    public async Task<List<OeeChannel>> GetChannelsAsync()
    {
        using var db = new QueueDbContext();
        return await db.OeeChannels.AsNoTracking().OrderBy(c => c.Name).ToListAsync();
    }

    public async Task<OeeChannel?> GetChannelAsync(int id)
    {
        using var db = new QueueDbContext();
        return await db.OeeChannels.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);
    }

    public async Task<OeeChannel> CreateChannelAsync(OeeChannel channel)
    {
        using var db = new QueueDbContext();
        channel.NextSeq = 0;
        channel.UpdatedAt = DateTime.UtcNow;
        db.OeeChannels.Add(channel);
        await db.SaveChangesAsync();
        return channel;
    }

    /// <summary>Updates mutable fields only. ExternalId and NextSeq are never changed here.</summary>
    public async Task<bool> UpdateChannelAsync(OeeChannel updated)
    {
        using var db = new QueueDbContext();
        var existing = await db.OeeChannels.FirstOrDefaultAsync(c => c.Id == updated.Id);
        if (existing == null) return false;

        existing.Name = updated.Name;
        existing.Enabled = updated.Enabled;
        existing.RunDataPointId = updated.RunDataPointId;
        existing.FaultDataPointId = updated.FaultDataPointId;
        existing.CodeDataPointId = updated.CodeDataPointId;
        existing.GoodDataPointId = updated.GoodDataPointId;
        existing.RejectDataPointId = updated.RejectDataPointId;
        existing.DebounceSeconds = updated.DebounceSeconds;
        existing.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteChannelAsync(int id)
    {
        using var db = new QueueDbContext();
        await using var tx = await db.Database.BeginTransactionAsync();
        var existing = await db.OeeChannels.FirstOrDefaultAsync(c => c.Id == id);
        if (existing == null) return false;
        await db.OeeOutboxMessages.Where(m => m.ChannelId == id).ExecuteDeleteAsync();
        db.OeeChannels.Remove(existing);
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        return true;
    }

    // ── Outbox enqueue (atomic seq) ──────────────────────────────────────────

    /// <summary>
    /// Appends a message with the channel's next sequence number and updates the
    /// live-state snapshot. Returns the assigned seq, or null when the channel is gone.
    /// </summary>
    public async Task<long?> EnqueueMessageAsync(
        int channelId, string type, DateTime tsUtc, string state,
        string? code, long? goodCount, long? rejectCount)
    {
        using var db = new QueueDbContext();
        await using var tx = await db.Database.BeginTransactionAsync();

        var channel = await db.OeeChannels.FirstOrDefaultAsync(c => c.Id == channelId);
        if (channel == null) return null;

        var seq = channel.NextSeq;
        channel.NextSeq = seq + 1;

        if (channel.LastState != state)
        {
            channel.LastStateChangedAt = tsUtc;
        }
        channel.LastState = state;
        channel.LastCode = code;

        db.OeeOutboxMessages.Add(new OeeOutboxMessage
        {
            ChannelId = channelId,
            Seq = seq,
            Type = type,
            Ts = tsUtc,
            State = state,
            Code = code,
            GoodCount = goodCount,
            RejectCount = rejectCount,
            CreatedAt = DateTime.UtcNow,
        });

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await EnforceOutboxCapAsync(db);
        return seq;
    }

    private static async Task EnforceOutboxCapAsync(QueueDbContext db)
    {
        var count = await db.OeeOutboxMessages.CountAsync();
        if (count <= MaxOutboxRows) return;

        int excess = count - MaxOutboxRows;
        var toDelete = await db.OeeOutboxMessages
            .Where(x => !x.IsSending)
            .OrderBy(x => x.Id)
            .Take(excess)
            .ToListAsync();
        if (!toDelete.Any()) return;

        db.OeeOutboxMessages.RemoveRange(toDelete);
        var now = DateTime.UtcNow;
        var lastTicks = Interlocked.Read(ref _lastOutboxLossCriticalTicks);
        if (now.Ticks - lastTicks >= TimeSpan.FromMinutes(15).Ticks)
        {
            Interlocked.Exchange(ref _lastOutboxLossCriticalTicks, now.Ticks);
            db.DiagnosticEvents.Add(new DiagnosticEvent
            {
                TimestampUtc = now,
                Level = "Critical",
                Category = typeof(OeeStorageService).FullName ?? nameof(OeeStorageService),
                EventCode = "OEE_DATA_LOSS",
                Message = $"OEE outbox exceeded {MaxOutboxRows:N0} rows. {toDelete.Count:N0} oldest message(s) were discarded.",
                Details = "The cloud has been unreachable long enough to overflow the OEE outbox. Sequence gaps will be flagged as suspect data by the cloud.",
            });
        }
        await db.SaveChangesAsync();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStorageServiceTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/Pulse.Edge.Storage/Services/OeeStorageService.cs src/Pulse.Edge.Tests/OeeStorageServiceTests.cs
git commit -m "feat(oee): OeeStorageService with atomic per-channel sequence assignment"
```

---

### Task 3: OeeStorageService — drain lifecycle

**Files:**
- Modify: `src/Pulse.Edge.Storage/Services/OeeStorageService.cs`
- Test: `src/Pulse.Edge.Tests/OeeStorageServiceTests.cs` (append)

**Interfaces:**
- Produces (append to `OeeStorageService`):
  - `Task<List<OeeOutboxMessage>> GetPendingBatchAsync(int batchSize = 1000)` — oldest-first by `Id`, marks `IsSending=true`
  - `Task CompleteBatchAsync(IEnumerable<int> ids)` — deletes rows (ack or terminal drop)
  - `Task ReleaseBatchAsync(IEnumerable<int> ids)` — `IsSending=false`, `RetryCount+1`
  - `Task<int> GetOutboxDepthAsync()`
  - `Task<List<OeeOutboxMessage>> GetRecentOutboxAsync(int take = 50)` — newest-first (UI)

- [ ] **Step 1: Append the failing test**

```csharp
    [Fact]
    public async Task DrainLifecycle_LocksCompletesAndReleases()
    {
        await _oee.EnqueueMessageAsync(_channelId, "state", DateTime.UtcNow, "running", null, 1, null);
        await _oee.EnqueueMessageAsync(_channelId, "sync", DateTime.UtcNow, "running", null, 2, null);

        var batch = (await _oee.GetPendingBatchAsync(batchSize: 1000))
            .Where(m => m.ChannelId == _channelId).ToList();
        Assert.Equal(2, batch.Count);
        Assert.True(batch.All(m => m.IsSending));
        Assert.True(batch[0].Seq < batch[1].Seq); // oldest (lowest seq) first

        // Locked rows must not be handed out again.
        var second = (await _oee.GetPendingBatchAsync(batchSize: 1000))
            .Where(m => m.ChannelId == _channelId).ToList();
        Assert.Empty(second);

        // Release → visible again with RetryCount bumped.
        await _oee.ReleaseBatchAsync(batch.Select(m => m.Id));
        var third = (await _oee.GetPendingBatchAsync(batchSize: 1000))
            .Where(m => m.ChannelId == _channelId).ToList();
        Assert.Equal(2, third.Count);
        Assert.True(third.All(m => m.RetryCount == 1));

        // Complete → gone.
        await _oee.CompleteBatchAsync(third.Select(m => m.Id));
        Assert.Equal(0, (await _oee.GetPendingBatchAsync(batchSize: 1000))
            .Count(m => m.ChannelId == _channelId));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStorageServiceTests`
Expected: FAIL to compile — `GetPendingBatchAsync` not defined.

- [ ] **Step 3: Implement the drain methods**

Append to `OeeStorageService` (mirrors `GetPendingTelemetryBatchAsync` at `QueueStorageService.cs:762`, but ordered by `Id` — insertion order preserves per-channel seq order):

```csharp
    // ── Outbox drain (called by OeeSyncService) ──────────────────────────────

    public async Task<List<OeeOutboxMessage>> GetPendingBatchAsync(int batchSize = 1000)
    {
        using var db = new QueueDbContext();
        var items = await db.OeeOutboxMessages
            .AsNoTracking()
            .Where(x => !x.IsSending)
            .OrderBy(x => x.Id)
            .Take(batchSize)
            .ToListAsync();

        if (items.Any())
        {
            var ids = items.Select(x => x.Id).ToList();
            await db.OeeOutboxMessages
                .Where(x => ids.Contains(x.Id))
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsSending, true));
            foreach (var item in items)
            {
                item.IsSending = true;
            }
        }
        return items;
    }

    public async Task CompleteBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        await db.OeeOutboxMessages.Where(x => ids.Contains(x.Id)).ExecuteDeleteAsync();
    }

    public async Task ReleaseBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        await db.OeeOutboxMessages
            .Where(x => ids.Contains(x.Id))
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.RetryCount, x => x.RetryCount + 1)
                .SetProperty(x => x.IsSending, false));
    }

    public async Task<int> GetOutboxDepthAsync()
    {
        using var db = new QueueDbContext();
        return await db.OeeOutboxMessages.CountAsync();
    }

    public async Task<List<OeeOutboxMessage>> GetRecentOutboxAsync(int take = 50)
    {
        using var db = new QueueDbContext();
        return await db.OeeOutboxMessages
            .AsNoTracking()
            .OrderByDescending(x => x.Id)
            .Take(take)
            .ToListAsync();
    }
```

- [ ] **Step 4: Run tests, build, commit**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStorageServiceTests` → PASS.

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Storage/Services/OeeStorageService.cs src/Pulse.Edge.Tests/OeeStorageServiceTests.cs
git commit -m "feat(oee): outbox drain lifecycle (lock/complete/release) and cap"
```

---

### Task 4: CloudClient — OEE endpoints + testable HTTP

**Files:**
- Modify: `src/Pulse.Edge.Cloud/Services/CloudClient.cs`
- Test: `src/Pulse.Edge.Tests/CloudClientOeeTests.cs`

**Interfaces:**
- Produces:
  - ctor overload `CloudClient(ILogger<CloudClient> logger, HttpMessageHandler handler)` (test injection; existing ctor unchanged)
  - `public enum OeeSyncResult { Success, TransientError, EnvelopeError, Unauthorized, NotPaired }`
  - `public record OeeChannelDeclarationDto(string ExternalId, string Name, string[] Capabilities);`
  - `public class OeeCountersDto { public long Good { get; set; } public long? Reject { get; set; } }`
  - `public class OeeEventMessageDto { public string Type; public string Channel; public long Seq; public string? Ts; public string State; public string? Code; public OeeCountersDto? Counters; }` (properties, defaults `string.Empty` where non-null)
  - `public class OeeEventsResponseError { public int Index; public string Reason; }`, `public class OeeEventsResponse { public int Accepted; public int Rejected; public int Duplicates; public List<OeeEventsResponseError>? Errors; }`
  - `Task<OeeSyncResult> DeclareOeeChannelsAsync(string baseUrl, string apiKey, List<OeeChannelDeclarationDto> channels)`
  - `Task<(OeeSyncResult Result, OeeEventsResponse? Response)> SendOeeEventsBatchAsync(string baseUrl, string apiKey, List<OeeEventMessageDto> messages)`

- [ ] **Step 1: Write the failing tests**

```csharp
// src/Pulse.Edge.Tests/CloudClientOeeTests.cs
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Cloud.Services;
using Xunit;

namespace Pulse.Edge.Tests;

/// <summary>Scripted HttpMessageHandler: records the request, returns a canned response.</summary>
internal sealed class ScriptedHandler : HttpMessageHandler
{
    private readonly HttpStatusCode _status;
    private readonly string _body;
    public HttpRequestMessage? LastRequest;
    public string? LastRequestBody;

    public ScriptedHandler(HttpStatusCode status, string body = "{}")
    {
        _status = status;
        _body = body;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        LastRequest = request;
        LastRequestBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
        return new HttpResponseMessage(_status)
        {
            Content = new StringContent(_body, System.Text.Encoding.UTF8, "application/json"),
        };
    }
}

public class CloudClientOeeTests
{
    private const string BaseUrl = "http://localhost:3000"; // loopback http is an acceptable endpoint

    private static CloudClient MakeClient(ScriptedHandler handler) =>
        new(NullLogger<CloudClient>.Instance, handler);

    [Fact]
    public async Task Declare_PostsCamelCaseArray_WithBearerAuth_And201IsSuccess()
    {
        var handler = new ScriptedHandler(HttpStatusCode.Created, "[]");
        var client = MakeClient(handler);

        var result = await client.DeclareOeeChannelsAsync(BaseUrl, "key-123", new List<CloudClient.OeeChannelDeclarationDto>
        {
            new("line1.filler", "Line 1 — Filler", new[] { "state", "counters" }),
        });

        Assert.Equal(OeeSyncResult.Success, result);
        Assert.Equal("/edge/oee/channels", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.Equal("Bearer", handler.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("key-123", handler.LastRequest.Headers.Authorization.Parameter);

        using var doc = JsonDocument.Parse(handler.LastRequestBody!);
        var item = doc.RootElement[0];
        Assert.Equal("line1.filler", item.GetProperty("externalId").GetString());
        Assert.Equal("state", item.GetProperty("capabilities")[0].GetString());
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, OeeSyncResult.EnvelopeError)]
    [InlineData(HttpStatusCode.Unauthorized, OeeSyncResult.Unauthorized)]
    [InlineData(HttpStatusCode.Conflict, OeeSyncResult.NotPaired)]
    [InlineData(HttpStatusCode.ServiceUnavailable, OeeSyncResult.TransientError)]
    public async Task Declare_MapsStatusCodes(HttpStatusCode status, OeeSyncResult expected)
    {
        var client = MakeClient(new ScriptedHandler(status));
        var result = await client.DeclareOeeChannelsAsync(BaseUrl, "k", new List<CloudClient.OeeChannelDeclarationDto>
        {
            new("x", "X", new[] { "state" }),
        });
        Assert.Equal(expected, result);
    }

    [Fact]
    public async Task SendEvents_SerializesContract_OmitsNulls_ParsesPerMessageErrors()
    {
        var handler = new ScriptedHandler(HttpStatusCode.Accepted,
            "{\"accepted\":1,\"rejected\":1,\"duplicates\":1,\"errors\":[{\"index\":1,\"reason\":\"unknown channel 'ghost'\"}]}");
        var client = MakeClient(handler);

        var messages = new List<CloudClient.OeeEventMessageDto>
        {
            new()
            {
                Type = "state", Channel = "line1.filler", Seq = 4102,
                Ts = "2026-07-18T06:14:03.250Z", State = "fault", Code = "E17",
                Counters = new CloudClient.OeeCountersDto { Good = 182440, Reject = 3121 },
            },
            new() { Type = "sync", Channel = "ghost", Seq = 0, Ts = "2026-07-18T06:15:00.000Z", State = "running" },
        };

        var (result, response) = await client.SendOeeEventsBatchAsync(BaseUrl, "k", messages);

        Assert.Equal(OeeSyncResult.Success, result);
        Assert.Equal("/edge/oee/events", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.Equal(1, response!.Accepted);
        Assert.Equal(1, response.Duplicates);
        Assert.Equal("unknown channel 'ghost'", response.Errors![0].Reason);
        Assert.Equal(1, response.Errors[0].Index);

        using var doc = JsonDocument.Parse(handler.LastRequestBody!);
        var first = doc.RootElement[0];
        Assert.Equal("state", first.GetProperty("type").GetString());
        Assert.Equal(4102, first.GetProperty("seq").GetInt64());
        Assert.Equal(182440, first.GetProperty("counters").GetProperty("good").GetInt64());
        // Null fields must be omitted entirely (contract: unknown/absent, not null).
        var second = doc.RootElement[1];
        Assert.False(second.TryGetProperty("code", out _));
        Assert.False(second.TryGetProperty("counters", out _));
    }

    [Fact]
    public async Task SendEvents_NetworkFailure_IsTransient()
    {
        var throwingHandler = new ThrowingHandler();
        var client = new CloudClient(NullLogger<CloudClient>.Instance, throwingHandler);
        var (result, response) = await client.SendOeeEventsBatchAsync(BaseUrl, "k",
            new List<CloudClient.OeeEventMessageDto>
            {
                new() { Type = "sync", Channel = "c", Seq = 0, Ts = "2026-07-18T00:00:00.000Z", State = "running" },
            });
        Assert.Equal(OeeSyncResult.TransientError, result);
        Assert.Null(response);
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => throw new HttpRequestException("connection refused");
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~CloudClientOeeTests`
Expected: FAIL to compile — missing ctor/DTOs/methods.

- [ ] **Step 3: Implement in `CloudClient.cs`**

Add the ctor overload right after the existing ctor (line 88–92):

```csharp
    /// <summary>Test seam: inject a scripted HttpMessageHandler. Production uses the default ctor.</summary>
    public CloudClient(ILogger<CloudClient> logger, HttpMessageHandler handler)
    {
        _logger = logger;
        _httpClient = new HttpClient(handler);
    }
```

Add the enum at namespace level (next to `TelemetrySyncResult`, line 14):

```csharp
public enum OeeSyncResult
{
    Success,
    TransientError,   // 503 / network / timeout / unexpected status → keep batch, backoff, re-send
    EnvelopeError,    // 400 on the envelope → edge bug; never retry unchanged
    Unauthorized,     // 401 → key revoked; re-enter claim flow
    NotPaired         // 409 → device not paired to a site; re-enter pairing
}
```

Add DTOs + methods at the end of the class (before the closing brace; `SendEventsBatchAsync` is still present until Task 7):

```csharp
    // ── OEE ingestion (know-how/cloud_oee_ingestion.md) ──────────────────────

    public record OeeChannelDeclarationDto(string ExternalId, string Name, string[] Capabilities);

    public class OeeCountersDto
    {
        public long Good { get; set; }
        public long? Reject { get; set; }
    }

    public class OeeEventMessageDto
    {
        public string Type { get; set; } = string.Empty;     // "state" | "sync"
        public string Channel { get; set; } = string.Empty;  // declared externalId
        public long Seq { get; set; }
        public string? Ts { get; set; }                      // ISO-8601 UTC with ms
        public string State { get; set; } = string.Empty;    // "running" | "stopped" | "fault"
        public string? Code { get; set; }
        public OeeCountersDto? Counters { get; set; }
    }

    public class OeeEventsResponseError
    {
        public int Index { get; set; }
        public string Reason { get; set; } = string.Empty;
    }

    public class OeeEventsResponse
    {
        public int Accepted { get; set; }
        public int Rejected { get; set; }
        public int Duplicates { get; set; }
        public List<OeeEventsResponseError>? Errors { get; set; }
    }

    /// <summary>
    /// Declares OEE channels (POST /edge/oee/channels). Idempotent on the cloud;
    /// 201 = success. Whole-batch validation: any invalid item fails the entire call with 400.
    /// </summary>
    public async Task<OeeSyncResult> DeclareOeeChannelsAsync(
        string baseUrl, string apiKey, List<OeeChannelDeclarationDto> channels)
    {
        _logger.LogInformation("[OEE Sync] Declaring {Count} OEE channel(s) (POST /edge/oee/channels)...", channels.Count);
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Post, GetUri(baseUrl, "/edge/oee/channels"))
            {
                Content = JsonContent.Create(channels, options: JsonOptions)
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var response = await _httpClient.SendAsync(request);
            switch (response.StatusCode)
            {
                case HttpStatusCode.Created:
                    return OeeSyncResult.Success;
                case HttpStatusCode.BadRequest:
                    _logger.LogError("[OEE Sync] Channel declaration rejected with 400: {Error}", await response.Content.ReadAsStringAsync());
                    return OeeSyncResult.EnvelopeError;
                case HttpStatusCode.Unauthorized:
                    _logger.LogError("[OEE Sync] Channel declaration rejected with 401. API key may be revoked.");
                    return OeeSyncResult.Unauthorized;
                case HttpStatusCode.Conflict:
                    _logger.LogError("[OEE Sync] Channel declaration rejected with 409. Device is not paired to a site.");
                    return OeeSyncResult.NotPaired;
                default:
                    _logger.LogWarning("[OEE Sync] Channel declaration failed with status {Status}.", response.StatusCode);
                    return OeeSyncResult.TransientError;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during OEE channel declaration to {BaseUrl}", baseUrl);
            return OeeSyncResult.TransientError;
        }
    }

    /// <summary>
    /// Uploads an OEE event batch (POST /edge/oee/events). 202 = per-message result in the
    /// response body; duplicates are acknowledged like any accepted message (dedup on (channel, seq)).
    /// </summary>
    public async Task<(OeeSyncResult Result, OeeEventsResponse? Response)> SendOeeEventsBatchAsync(
        string baseUrl, string apiKey, List<OeeEventMessageDto> messages)
    {
        _logger.LogInformation("[OEE Sync] Uploading {Count} OEE event(s) (POST /edge/oee/events)...", messages.Count);
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Post, GetUri(baseUrl, "/edge/oee/events"))
            {
                Content = JsonContent.Create(messages, options: JsonOptions)
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var response = await _httpClient.SendAsync(request);
            switch (response.StatusCode)
            {
                case HttpStatusCode.Accepted:
                    var body = await response.Content.ReadFromJsonAsync<OeeEventsResponse>(JsonOptions);
                    _logger.LogInformation("[OEE Sync] Batch processed. Accepted: {A}, Rejected: {R}, Duplicates: {D}",
                        body?.Accepted, body?.Rejected, body?.Duplicates);
                    return (OeeSyncResult.Success, body);
                case HttpStatusCode.BadRequest:
                    _logger.LogError("[OEE Sync] Event envelope rejected with 400: {Error}", await response.Content.ReadAsStringAsync());
                    return (OeeSyncResult.EnvelopeError, null);
                case HttpStatusCode.Unauthorized:
                    return (OeeSyncResult.Unauthorized, null);
                case HttpStatusCode.Conflict:
                    return (OeeSyncResult.NotPaired, null);
                default:
                    _logger.LogWarning("[OEE Sync] Event batch failed with status {Status}.", response.StatusCode);
                    return (OeeSyncResult.TransientError, null);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during OEE event transmission to {BaseUrl}", baseUrl);
            return (OeeSyncResult.TransientError, null);
        }
    }
```

- [ ] **Step 4: Run tests, build, commit**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~CloudClientOeeTests` → PASS (7 tests).

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Cloud/Services/CloudClient.cs src/Pulse.Edge.Tests/CloudClientOeeTests.cs
git commit -m "feat(oee): CloudClient declare/events methods for /edge/oee/* with testable handler"
```

---

### Task 5: OeeStateEngine — derivation, debounce, sync cadence

**Files:**
- Create: `src/Pulse.Edge.Agent/Services/OeeStateEngine.cs`
- Test: `src/Pulse.Edge.Tests/OeeStateEngineTests.cs`

**Interfaces:**
- Consumes: `OeeStorageService.GetChannelsAsync/EnqueueMessageAsync` (Task 2), `DataPoint` model.
- Produces: `OeeStateEngine` singleton with `Task EvaluateAsync(IReadOnlyList<DataPoint> polledDataPoints, DateTime nowUtc)` (called by Worker each loop tick, Task 6) and `internal static bool TryParseSignal(string? lastValue, out double value)`.

**Behavior contract (from spec §3):** run tag nonzero ⇒ `running` else `stopped`; bound fault tag nonzero ⇒ `fault` (wins); a tag with `LastError != null` or unparsable value makes the whole state signal invalid ⇒ hold last state, emit nothing new; debounce = candidate must persist `DebounceSeconds` before commit, transition `ts` = candidate-first-seen; counters from current scan, omitted when good tag invalid; first valid evaluation commits state WITHOUT a `state` event and emits the boot `sync`; thereafter `sync` every 60 s per channel.

- [ ] **Step 1: Write the failing tests**

```csharp
// src/Pulse.Edge.Tests/OeeStateEngineTests.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public class OeeStateEngineTests : IAsyncLifetime
{
    private readonly QueueStorageService _queueStorage = new();
    private readonly OeeStorageService _oee = new();
    private OeeStateEngine _engine = null!;
    private int _channelId;
    private readonly DateTime _t0 = new(2026, 7, 18, 6, 0, 0, DateTimeKind.Utc);

    public async Task InitializeAsync()
    {
        await _queueStorage.InitializeAsync();
        var channel = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "engine-test-" + Guid.NewGuid().ToString("N"),
            Name = "Engine Test",
            RunDataPointId = "dp-run",
            FaultDataPointId = "dp-fault",
            CodeDataPointId = "dp-code",
            GoodDataPointId = "dp-good",
            RejectDataPointId = "dp-reject",
            DebounceSeconds = 2,
        });
        _channelId = channel.Id;
        _engine = new OeeStateEngine(NullLogger<OeeStateEngine>.Instance, _oee);
    }

    public async Task DisposeAsync() => await _oee.DeleteChannelAsync(_channelId);

    private static List<DataPoint> Signals(double run, double fault, string code, double good, double reject) =>
    [
        new() { Id = "dp-run",    LastValue = run.ToString(),    LastUpdated = DateTime.UtcNow },
        new() { Id = "dp-fault",  LastValue = fault.ToString(),  LastUpdated = DateTime.UtcNow },
        new() { Id = "dp-code",   LastValue = code,              LastUpdated = DateTime.UtcNow },
        new() { Id = "dp-good",   LastValue = good.ToString(),   LastUpdated = DateTime.UtcNow },
        new() { Id = "dp-reject", LastValue = reject.ToString(), LastUpdated = DateTime.UtcNow },
    ];

    private async Task<List<OeeOutboxMessage>> Outbox()
    {
        using var db = new QueueDbContext();
        return await db.OeeOutboxMessages.AsNoTracking()
            .Where(m => m.ChannelId == _channelId).OrderBy(m => m.Seq).ToListAsync();
    }

    [Fact]
    public async Task FirstEvaluation_EmitsBootSyncOnly_NoStateEvent()
    {
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0);
        var outbox = await Outbox();
        var msg = Assert.Single(outbox);
        Assert.Equal("sync", msg.Type);
        Assert.Equal("running", msg.State);
        Assert.Equal(100, msg.GoodCount);
        Assert.Equal(5, msg.RejectCount);
    }

    [Fact]
    public async Task Transition_IsDebounced_TsIsFirstObserved()
    {
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0);              // boot: running
        await _engine.EvaluateAsync(Signals(0, 3, "3", 100, 5), _t0.AddSeconds(10)); // fault candidate first seen
        Assert.Single(await Outbox());                                             // not committed yet (debounce 2s)
        await _engine.EvaluateAsync(Signals(0, 3, "3", 100, 5), _t0.AddSeconds(11));
        Assert.Single(await Outbox());
        await _engine.EvaluateAsync(Signals(0, 3, "3", 100, 5), _t0.AddSeconds(12.5));

        var outbox = await Outbox();
        Assert.Equal(2, outbox.Count);
        var transition = outbox[1];
        Assert.Equal("state", transition.Type);
        Assert.Equal("fault", transition.State);
        Assert.Equal("3", transition.Code);
        Assert.Equal(_t0.AddSeconds(10), DateTime.SpecifyKind(transition.Ts, DateTimeKind.Utc)); // first-observed
    }

    [Fact]
    public async Task Chatter_ShorterThanDebounce_EmitsNothing()
    {
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0);
        await _engine.EvaluateAsync(Signals(0, 0, "0", 100, 5), _t0.AddSeconds(5));   // stop blip
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0.AddSeconds(6));   // back to running before 2s debounce
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0.AddSeconds(9));
        Assert.Single(await Outbox()); // still only the boot sync
    }

    [Fact]
    public async Task BadQuality_HoldsState_AndOmitsCounters()
    {
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0);

        // Run signal read failed → state signal invalid → hold running, no transition.
        var broken = Signals(0, 0, "0", 100, 5);
        broken[0].LastError = "read timeout";
        await _engine.EvaluateAsync(broken, _t0.AddSeconds(10));
        await _engine.EvaluateAsync(broken, _t0.AddSeconds(20));

        // 60 s sync still fires and asserts the HELD state, with counters omitted only if good is bad.
        var goodBroken = Signals(1, 0, "0", 100, 5);
        goodBroken[3].LastError = "read timeout"; // good counter failed
        await _engine.EvaluateAsync(goodBroken, _t0.AddSeconds(61));

        var outbox = await Outbox();
        Assert.Equal(2, outbox.Count);
        var sync = outbox[1];
        Assert.Equal("sync", sync.Type);
        Assert.Equal("running", sync.State); // held, never became stopped
        Assert.Null(sync.GoodCount);         // counters omitted, not zero/stale
    }

    [Fact]
    public async Task Sync_EmittedEvery60Seconds()
    {
        await _engine.EvaluateAsync(Signals(1, 0, "0", 100, 5), _t0);
        await _engine.EvaluateAsync(Signals(1, 0, "0", 110, 5), _t0.AddSeconds(30));
        Assert.Single(await Outbox());
        await _engine.EvaluateAsync(Signals(1, 0, "0", 120, 6), _t0.AddSeconds(61));
        var outbox = await Outbox();
        Assert.Equal(2, outbox.Count);
        Assert.Equal("sync", outbox[1].Type);
        Assert.Equal(120, outbox[1].GoodCount);
    }

    [Fact]
    public async Task ChannelWithoutFaultBinding_NeverEmitsFault()
    {
        var noFault = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "nofault-" + Guid.NewGuid().ToString("N"),
            Name = "No Fault", RunDataPointId = "dp-run", DebounceSeconds = 0,
        });
        try
        {
            var engine = new OeeStateEngine(NullLogger<OeeStateEngine>.Instance, _oee);
            await engine.EvaluateAsync(Signals(0, 3, "3", 0, 0), _t0); // fault signal present but unbound

            using var db = new QueueDbContext();
            var msg = await db.OeeOutboxMessages.AsNoTracking()
                .SingleAsync(m => m.ChannelId == noFault.Id);
            Assert.Equal("stopped", msg.State); // never inferred fault
        }
        finally
        {
            await _oee.DeleteChannelAsync(noFault.Id);
        }
    }

    [Theory]
    [InlineData("True", true, 1.0)]
    [InlineData("False", true, 0.0)]
    [InlineData("3", true, 3.0)]
    [InlineData("2.50", true, 2.5)]
    [InlineData("garbage", false, 0.0)]
    [InlineData(null, false, 0.0)]
    public void TryParseSignal_HandlesPollerValueFormats(string? input, bool ok, double expected)
    {
        Assert.Equal(ok, OeeStateEngine.TryParseSignal(input, out var value));
        if (ok) Assert.Equal(expected, value);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStateEngineTests`
Expected: FAIL to compile — `OeeStateEngine` not defined.

- [ ] **Step 3: Implement the engine**

```csharp
// src/Pulse.Edge.Agent/Services/OeeStateEngine.cs
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Services;

/// <summary>
/// The contract's "dumb, reliable observer" (know-how/cloud_oee_ingestion.md):
/// turns polled tag values into debounced state transitions and 60-second syncs,
/// appended to the durable outbox. No network access, no business logic.
/// Worker calls EvaluateAsync once per poll loop tick with the freshly polled DataPoints.
/// </summary>
public class OeeStateEngine
{
    private static readonly TimeSpan SyncInterval = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ChannelCacheTtl = TimeSpan.FromSeconds(5);
    private const int MaxCodeLength = 64;

    private readonly ILogger<OeeStateEngine> _logger;
    private readonly OeeStorageService _storage;

    private List<OeeChannel> _channels = new();
    private DateTime _channelsLoadedAt = DateTime.MinValue;
    private readonly Dictionary<int, ChannelRuntime> _runtime = new();

    private sealed class ChannelRuntime
    {
        public string? CommittedState;
        public string? CandidateState;
        public DateTime CandidateFirstSeen;
        public string? LastCode;
        public DateTime LastSyncUtc = DateTime.MinValue;
    }

    public OeeStateEngine(ILogger<OeeStateEngine> logger, OeeStorageService storage)
    {
        _logger = logger;
        _storage = storage;
    }

    public async Task EvaluateAsync(IReadOnlyList<DataPoint> polledDataPoints, DateTime nowUtc)
    {
        if (nowUtc - _channelsLoadedAt >= ChannelCacheTtl)
        {
            _channels = await _storage.GetChannelsAsync();
            _channelsLoadedAt = nowUtc;
            // Forget runtime state for channels that no longer exist (or were disabled),
            // so a re-enabled channel does a fresh boot sync.
            var liveIds = _channels.Where(c => c.Enabled).Select(c => c.Id).ToHashSet();
            foreach (var stale in _runtime.Keys.Where(id => !liveIds.Contains(id)).ToList())
            {
                _runtime.Remove(stale);
            }
        }

        var byId = polledDataPoints
            .GroupBy(dp => dp.Id)
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var channel in _channels.Where(c => c.Enabled))
        {
            try
            {
                await EvaluateChannelAsync(channel, byId, nowUtc);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OEE evaluation failed for channel {ExternalId}", channel.ExternalId);
            }
        }
    }

    private async Task EvaluateChannelAsync(
        OeeChannel channel, Dictionary<string, DataPoint> byId, DateTime nowUtc)
    {
        if (!_runtime.TryGetValue(channel.Id, out var rt))
        {
            rt = new ChannelRuntime();
            _runtime[channel.Id] = rt;
        }

        // ── Derive candidate state from the bound signals ─────────────────────
        string? candidate = null;
        string? code = null;

        bool runValid = TryReadSignal(byId, channel.RunDataPointId, out var runValue);
        bool faultBound = !string.IsNullOrEmpty(channel.FaultDataPointId);
        bool faultValid = !faultBound || TryReadSignal(byId, channel.FaultDataPointId!, out _);

        if (runValid && faultValid)
        {
            double faultValue = 0;
            if (faultBound)
            {
                TryReadSignal(byId, channel.FaultDataPointId!, out faultValue);
            }
            // fault only from a real bound fault signal; fault wins over running. Never inferred.
            candidate = faultValue != 0 ? "fault" : (runValue != 0 ? "running" : "stopped");
        }
        // else: signal invalid (comms lost / unparsable) → hold last committed state,
        // change nothing. A dead cable is not a machine stop.

        if (!string.IsNullOrEmpty(channel.CodeDataPointId)
            && byId.TryGetValue(channel.CodeDataPointId!, out var codeDp)
            && codeDp.LastError == null
            && !string.IsNullOrEmpty(codeDp.LastValue))
        {
            code = codeDp.LastValue!.Length > MaxCodeLength
                ? codeDp.LastValue.Substring(0, MaxCodeLength)
                : codeDp.LastValue;
        }

        // ── Counters (cumulative totalizers; omit when the read failed) ───────
        long? good = null, reject = null;
        if (!string.IsNullOrEmpty(channel.GoodDataPointId)
            && TryReadSignal(byId, channel.GoodDataPointId!, out var goodValue))
        {
            good = (long)Math.Round(goodValue);
            if (!string.IsNullOrEmpty(channel.RejectDataPointId)
                && TryReadSignal(byId, channel.RejectDataPointId!, out var rejectValue))
            {
                reject = (long)Math.Round(rejectValue);
            }
        }

        // ── Debounced commit (on-delay-timer semantics) ───────────────────────
        if (candidate != null)
        {
            if (candidate != rt.CandidateState)
            {
                rt.CandidateState = candidate;
                rt.CandidateFirstSeen = nowUtc;
            }

            if (rt.CommittedState == null)
            {
                // First valid observation: commit silently; the boot sync below asserts it.
                rt.CommittedState = candidate;
                rt.LastCode = code;
            }
            else if (candidate != rt.CommittedState
                     && (nowUtc - rt.CandidateFirstSeen).TotalSeconds >= channel.DebounceSeconds)
            {
                rt.CommittedState = candidate;
                rt.LastCode = code;
                // ts = when the candidate was FIRST observed — honest interval boundary.
                await _storage.EnqueueMessageAsync(
                    channel.Id, "state", rt.CandidateFirstSeen, candidate, code, good, reject);
                _logger.LogInformation("[OEE] {ExternalId} → {State}{Code}",
                    channel.ExternalId, candidate, code != null ? $" (code {code})" : "");
            }
            else if (candidate == rt.CommittedState)
            {
                rt.LastCode = code; // keep code fresh while the state holds
            }
        }

        // ── Sync: boot + every 60 s, asserting the committed state ────────────
        if (rt.CommittedState != null && nowUtc - rt.LastSyncUtc >= SyncInterval)
        {
            rt.LastSyncUtc = nowUtc;
            await _storage.EnqueueMessageAsync(
                channel.Id, "sync", nowUtc, rt.CommittedState, rt.LastCode, good, reject);
        }
    }

    private static bool TryReadSignal(Dictionary<string, DataPoint> byId, string dataPointId, out double value)
    {
        value = 0;
        if (!byId.TryGetValue(dataPointId, out var dp)) return false;
        if (dp.LastError != null) return false;
        return TryParseSignal(dp.LastValue, out value);
    }

    /// <summary>
    /// Pollers format LastValue as "True"/"False" for booleans, "123" for integers,
    /// "85.30" for floats (see SimulatorDriverPoller.cs:100-114 — all pollers share the pattern).
    /// </summary>
    internal static bool TryParseSignal(string? lastValue, out double value)
    {
        value = 0;
        if (string.IsNullOrEmpty(lastValue)) return false;
        if (lastValue.Equals("True", StringComparison.OrdinalIgnoreCase)) { value = 1; return true; }
        if (lastValue.Equals("False", StringComparison.OrdinalIgnoreCase)) { value = 0; return true; }
        return double.TryParse(lastValue, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}
```

Note for the implementer: Tasks 5, 6, and 10 all call `internal` members of the Agent assembly from the test assembly (`OeeStateEngine.TryParseSignal`, `OeeSyncService.ClassifyResponse`, `OeeSyncService.RunOnceAsync`). Check whether `Pulse.Edge.Agent` already exposes `InternalsVisibleTo("Pulse.Edge.Tests")` (grep `InternalsVisibleTo` in `src/Pulse.Edge.Agent/`). If not, add to `src/Pulse.Edge.Agent/Pulse.Edge.Agent.csproj`:

```xml
  <ItemGroup>
    <InternalsVisibleTo Include="Pulse.Edge.Tests" />
  </ItemGroup>
```

- [ ] **Step 4: Run tests, build, commit**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeStateEngineTests` → PASS (12 tests incl. theory cases).

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Agent/ src/Pulse.Edge.Tests/OeeStateEngineTests.cs
git commit -m "feat(oee): OeeStateEngine with debounced derivation and 60s sync cadence"
```

---

### Task 6: OeeSyncService + Worker tap + DI registrations

**Files:**
- Create: `src/Pulse.Edge.Agent/Services/OeeSyncService.cs`
- Modify: `src/Pulse.Edge.Agent/Worker.cs` (ctor + after poll fan-out ~line 284)
- Modify: `src/Pulse.Edge.Agent/Program.cs` (~line 88), `src/Pulse.Edge.Api/Program.cs` (~lines 219, 259)
- Test: `src/Pulse.Edge.Tests/OeeSyncServiceTests.cs`

**Interfaces:**
- Consumes: `OeeStorageService` (Tasks 2–3), `CloudClient.DeclareOeeChannelsAsync`/`SendOeeEventsBatchAsync` (Task 4), `QueueStorageService.GetDeviceConfigAsync`/`SaveDeviceConfigAsync`.
- Produces: `OeeSyncService : BackgroundService` with `internal static BatchOutcome ClassifyResponse(int batchCount, CloudClient.OeeEventsResponse? response)` and `internal async Task<bool> RunOnceAsync(CancellationToken ct)` (used by Task 10's E2E test); `internal record BatchOutcome(List<int> AcceptedIndexes, List<int> InvalidIndexes, List<int> UnknownChannelIndexes)`.

- [ ] **Step 1: Write the failing classification tests**

```csharp
// src/Pulse.Edge.Tests/OeeSyncServiceTests.cs
using System.Collections.Generic;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Cloud.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public class OeeSyncServiceTests
{
    [Fact]
    public void Classify_AllAccepted_IncludingDuplicates()
    {
        var outcome = OeeSyncService.ClassifyResponse(3, new CloudClient.OeeEventsResponse
        {
            Accepted = 3, Rejected = 0, Duplicates = 2,
        });
        Assert.Equal(new List<int> { 0, 1, 2 }, outcome.AcceptedIndexes);
        Assert.Empty(outcome.InvalidIndexes);
        Assert.Empty(outcome.UnknownChannelIndexes);
    }

    [Fact]
    public void Classify_SplitsInvalidAndUnknownChannel()
    {
        var outcome = OeeSyncService.ClassifyResponse(4, new CloudClient.OeeEventsResponse
        {
            Accepted = 2, Rejected = 2,
            Errors = new List<CloudClient.OeeEventsResponseError>
            {
                new() { Index = 1, Reason = "invalid message" },
                new() { Index = 3, Reason = "unknown channel 'ghost.channel'" },
            },
        });
        Assert.Equal(new List<int> { 0, 2 }, outcome.AcceptedIndexes);
        Assert.Equal(new List<int> { 1 }, outcome.InvalidIndexes);   // terminal: drop + diagnostic
        Assert.Equal(new List<int> { 3 }, outcome.UnknownChannelIndexes); // release + re-declare
    }

    [Fact]
    public void Classify_NullResponse_TreatsNothingAsAccepted()
    {
        var outcome = OeeSyncService.ClassifyResponse(2, null);
        Assert.Empty(outcome.AcceptedIndexes);
        Assert.Empty(outcome.InvalidIndexes);
        Assert.Empty(outcome.UnknownChannelIndexes);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeSyncServiceTests`
Expected: FAIL to compile.

- [ ] **Step 3: Implement `OeeSyncService`**

```csharp
// src/Pulse.Edge.Agent/Services/OeeSyncService.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Services;

/// <summary>
/// Dedicated delivery loop for the OEE data plane (know-how/cloud_oee_ingestion.md §4).
/// Independent of the telemetry SyncService so a telemetry backlog can never starve OEE
/// liveness (the cloud records no-data after ~180 s of silence). Declares channels before
/// events; drains the outbox with exponential backoff 5 s → 5 min; rows leave the outbox
/// only on 202 acknowledgment (or terminal "invalid message" rejection).
/// </summary>
public class OeeSyncService : BackgroundService
{
    private const int MaxBatchSize = 1000;   // contract recommends ≤ 1000 (≈1 MB body limit)
    private const int MinBackoffSeconds = 5;
    private const int MaxBackoffSeconds = 300;
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(2);

    private readonly ILogger<OeeSyncService> _logger;
    private readonly QueueStorageService _queueStorage;
    private readonly OeeStorageService _oeeStorage;
    private readonly CloudClient _cloudClient;

    private int _backoffSeconds = MinBackoffSeconds;
    private int _batchSize = MaxBatchSize;
    private bool _hasDeclared;
    private DateTime _declaredThroughUtc = DateTime.MinValue;

    public OeeSyncService(
        ILogger<OeeSyncService> logger,
        QueueStorageService queueStorage,
        OeeStorageService oeeStorage,
        CloudClient cloudClient)
    {
        _logger = logger;
        _queueStorage = queueStorage;
        _oeeStorage = oeeStorage;
        _cloudClient = cloudClient;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("OEE sync loop started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            bool ok;
            try
            {
                ok = await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error in OEE sync loop.");
                ok = false;
            }

            if (ok)
            {
                _backoffSeconds = MinBackoffSeconds;
                _batchSize = MaxBatchSize;
                try { await Task.Delay(IdleDelay, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
            else
            {
                var delay = TimeSpan.FromSeconds(_backoffSeconds);
                _backoffSeconds = Math.Min(_backoffSeconds * 2, MaxBackoffSeconds);
                _logger.LogWarning("[OEE Sync] Backing off {Delay}s before retry.", delay.TotalSeconds);
                try { await Task.Delay(delay, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    /// <summary>
    /// One iteration: declare if needed, then drain one batch.
    /// Returns false when a transient/auth failure occurred (caller backs off).
    /// </summary>
    internal async Task<bool> RunOnceAsync(CancellationToken ct)
    {
        var config = await _queueStorage.GetDeviceConfigAsync();
        if (config == null || !config.IsSyncEnabled || string.IsNullOrEmpty(config.ApiKey))
        {
            return true; // idle quietly; provisioning owns credential acquisition
        }

        var baseUrl = config.CloudEndpoint ?? "http://localhost:3000";
        var channels = await _oeeStorage.GetChannelsAsync();
        var enabled = channels.Where(c => c.Enabled).ToList();
        if (enabled.Count == 0) return true;

        // ── Declaration before events (contract §2.2) ─────────────────────────
        var latestUpdate = enabled.Max(c => c.UpdatedAt);
        if (!_hasDeclared || latestUpdate > _declaredThroughUtc)
        {
            var declarations = enabled.Select(c => new CloudClient.OeeChannelDeclarationDto(
                c.ExternalId,
                c.Name,
                string.IsNullOrEmpty(c.GoodDataPointId)
                    ? new[] { "state" }
                    : new[] { "state", "counters" })).ToList();

            var declareResult = await _cloudClient.DeclareOeeChannelsAsync(baseUrl, config.ApiKey, declarations);
            if (declareResult == OeeSyncResult.Unauthorized)
            {
                await HandleUnauthorizedAsync(config);
                return false;
            }
            if (declareResult != OeeSyncResult.Success)
            {
                return false; // includes NotPaired + EnvelopeError + Transient: no events until declared
            }
            _hasDeclared = true;
            _declaredThroughUtc = latestUpdate;
        }

        // ── Drain one batch ──────────────────────────────────────────────────
        var batch = await _oeeStorage.GetPendingBatchAsync(_batchSize);
        if (batch.Count == 0) return true;

        // Map rows to wire messages; rows whose channel disappeared are orphans → delete.
        var byId = channels.ToDictionary(c => c.Id);
        var orphanIds = batch.Where(m => !byId.ContainsKey(m.ChannelId)).Select(m => m.Id).ToList();
        if (orphanIds.Count > 0)
        {
            await _oeeStorage.CompleteBatchAsync(orphanIds);
            batch = batch.Where(m => byId.ContainsKey(m.ChannelId)).ToList();
            if (batch.Count == 0) return true;
        }

        var messages = batch.Select(m => new CloudClient.OeeEventMessageDto
        {
            Type = m.Type,
            Channel = byId[m.ChannelId].ExternalId,
            Seq = m.Seq,
            Ts = DateTime.SpecifyKind(m.Ts, DateTimeKind.Utc)
                .ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture),
            State = m.State,
            Code = m.Code,
            Counters = m.GoodCount.HasValue
                ? new CloudClient.OeeCountersDto { Good = m.GoodCount.Value, Reject = m.RejectCount }
                : null,
        }).ToList();

        var (result, response) = await _cloudClient.SendOeeEventsBatchAsync(baseUrl, config.ApiKey, messages);

        switch (result)
        {
            case OeeSyncResult.Success:
                var outcome = ClassifyResponse(batch.Count, response);

                var ackIds = outcome.AcceptedIndexes.Select(i => batch[i].Id).ToList();
                if (ackIds.Count > 0) await _oeeStorage.CompleteBatchAsync(ackIds);

                if (outcome.InvalidIndexes.Count > 0)
                {
                    // Terminal per the contract: fix the producer; retrying can never succeed.
                    await _oeeStorage.CompleteBatchAsync(outcome.InvalidIndexes.Select(i => batch[i].Id));
                    await RecordInvalidMessageDiagnosticAsync(outcome.InvalidIndexes.Count, response);
                }

                if (outcome.UnknownChannelIndexes.Count > 0)
                {
                    await _oeeStorage.ReleaseBatchAsync(outcome.UnknownChannelIndexes.Select(i => batch[i].Id));
                    _hasDeclared = false; // re-declare before the retry
                }
                _logger.LogInformation("[OEE Sync] Batch done: {Ack} acked, {Inv} invalid-dropped, {Unk} awaiting re-declaration.",
                    ackIds.Count, outcome.InvalidIndexes.Count, outcome.UnknownChannelIndexes.Count);
                return true;

            case OeeSyncResult.EnvelopeError:
                // Envelope 400 is an edge bug: never retry unchanged — halve the batch.
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                _batchSize = Math.Max(1, _batchSize / 2);
                _logger.LogError("[OEE Sync] Envelope rejected (400). Halving batch size to {Size}.", _batchSize);
                return false;

            case OeeSyncResult.Unauthorized:
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                await HandleUnauthorizedAsync(config);
                return false;

            case OeeSyncResult.NotPaired:
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                _logger.LogError("[OEE Sync] Device not paired to a site (409). Waiting for re-pairing.");
                _backoffSeconds = MaxBackoffSeconds;
                return false;

            default: // TransientError: keep the whole batch, re-send after backoff (dedup makes replay safe)
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                return false;
        }
    }

    internal record BatchOutcome(
        List<int> AcceptedIndexes,
        List<int> InvalidIndexes,
        List<int> UnknownChannelIndexes);

    internal static BatchOutcome ClassifyResponse(int batchCount, CloudClient.OeeEventsResponse? response)
    {
        if (response == null)
        {
            // A 202 with an unreadable body: acknowledge nothing; the full-batch
            // re-send reconciles (duplicates are no-ops server-side).
            return new BatchOutcome(new List<int>(), new List<int>(), new List<int>());
        }

        var invalid = new List<int>();
        var unknown = new List<int>();
        var errorIndexes = new HashSet<int>();
        foreach (var err in response.Errors ?? new List<CloudClient.OeeEventsResponseError>())
        {
            if (err.Index < 0 || err.Index >= batchCount) continue;
            errorIndexes.Add(err.Index);
            if (err.Reason.StartsWith("unknown channel", StringComparison.OrdinalIgnoreCase))
                unknown.Add(err.Index);
            else
                invalid.Add(err.Index);
        }

        var accepted = Enumerable.Range(0, batchCount).Where(i => !errorIndexes.Contains(i)).ToList();
        return new BatchOutcome(accepted, invalid, unknown);
    }

    private async Task HandleUnauthorizedAsync(DeviceConfig config)
    {
        _logger.LogError("[OEE Sync] Unauthorized (401). API key revoked — stopping OEE sync until re-claimed.");
        config.ApiKey = "";
        config.SiteId = "";
        config.SiteName = "";
        config.CloudStatus = "Revoked";
        await _queueStorage.SaveDeviceConfigAsync(config);
    }

    private static async Task RecordInvalidMessageDiagnosticAsync(int count, CloudClient.OeeEventsResponse? response)
    {
        using var db = new QueueDbContext();
        db.DiagnosticEvents.Add(new DiagnosticEvent
        {
            TimestampUtc = DateTime.UtcNow,
            Level = "Error",
            Category = typeof(OeeSyncService).FullName ?? nameof(OeeSyncService),
            EventCode = "OEE_INVALID_MESSAGE",
            Message = $"{count} OEE message(s) were rejected as invalid by the cloud and dropped.",
            Details = "Terminal rejection: the message failed cloud-side validation and can never succeed on retry. This indicates an edge producer bug.",
        });
        await db.SaveChangesAsync();
    }
}
```

- [ ] **Step 4: Wire the Worker tap**

In `src/Pulse.Edge.Agent/Worker.cs`:
- Add field + ctor parameter (after `_provisioningService`): `private readonly OeeStateEngine _oeeStateEngine;` / ctor param `OeeStateEngine oeeStateEngine` assigned `_oeeStateEngine = oeeStateEngine;`
- After `await Task.WhenAll(pollTasks);` (line 284), BEFORE the dirtyDps save block, add:

```csharp
            // OEE reading tap: pollers mutated dp.LastValue on these fetched instances,
            // so the engine sees scan-fresh values for every protocol from one call site.
            try
            {
                await _oeeStateEngine.EvaluateAsync(datapoints, now);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OEE state evaluation failed");
            }
```

- [ ] **Step 5: Register in both hosts**

`src/Pulse.Edge.Agent/Program.cs` — after line 87 (`CloudProvisioningService` hosted registration):

```csharp
// OEE data plane: storage + observer engine + dedicated delivery loop
builder.Services.AddSingleton<OeeStorageService>();
builder.Services.AddSingleton<OeeStateEngine>();
builder.Services.AddHostedService<OeeSyncService>();
```

`src/Pulse.Edge.Api/Program.cs` — `OeeStorageService` must be OUTSIDE the single-port branch (endpoints need it in both modes). After line 219 (`AddSingleton<QueueStorageService>()`):

```csharp
builder.Services.AddSingleton<OeeStorageService>();
```

Inside the `if (isSinglePort)` block, after the `Worker` registration (line 259):

```csharp
    builder.Services.AddSingleton<OeeStateEngine>();
    builder.Services.AddHostedService<OeeSyncService>();
```

Add `using Pulse.Edge.Agent.Services;` if not already imported (check the top of each Program.cs — the Api one already imports it for `EdgeConfigMonitor`; verify).

- [ ] **Step 6: Run tests, build, commit**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeSyncServiceTests` → PASS (3 tests).
Run: `dotnet build Pulse.Edge.slnx --warnaserror` → clean.

```bash
git add src/Pulse.Edge.Agent/ src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Tests/OeeSyncServiceTests.cs
git commit -m "feat(oee): OeeSyncService delivery loop with declare-first and exponential backoff"
```

---

### Task 7: Remove the legacy event subsystem

**Files:**
- Delete: `src/Pulse.Edge.Storage/Models/QueueEvent.cs`
- Modify: `src/Pulse.Edge.Storage/QueueDbContext.cs` (remove line 24 DbSet)
- Modify: `src/Pulse.Edge.Storage/Services/QueueStorageService.cs` (DDL block ~103-117 → DROP; remove methods 812-870; remove `stuckEvents` block in `ResetSendingStatusAsync`)
- Modify: `src/Pulse.Edge.Cloud/Services/SyncService.cs` (remove event branch, lines 112-132)
- Modify: `src/Pulse.Edge.Cloud/Services/CloudClient.cs` (remove `SendEventsBatchAsync`, lines 488-504)
- Modify: `src/Pulse.Edge.Api/Endpoints/BufferEndpoints.cs` (remove `/api/buffer/events` route, lines 26-35)
- Modify: `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs` (line 150: `DELETE FROM QueueEvents;` → `DELETE FROM OeeOutboxMessages;`)
- Modify: `src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs` (replace QueueEvent fixture)
- Modify: `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs` (remove `["GET /api/buffer/events"]` row)

**Interfaces:**
- Consumes: nothing new. The legacy subsystem is provably dead — `EnqueueEventAsync` has zero production callers.
- Produces: none (pure removal). Later tasks assume `QueueEvent` no longer exists.

- [ ] **Step 1: Remove backend pieces**

1. Delete `src/Pulse.Edge.Storage/Models/QueueEvent.cs`.
2. `QueueDbContext.cs`: delete line 24 (`public DbSet<QueueEvent> QueueEvents => Set<QueueEvent>();`).
3. `QueueStorageService.cs`:
   - Replace the whole "Create QueueEvents table if missing" try/catch block (lines 103-117) with:

```csharp
        // The legacy event queue was removed (replaced by the OEE outbox — see
        // docs/superpowers/specs/2026-07-18-edge-oee-ingestion-design.md §6). The table
        // was provably always empty (no producer ever existed), so dropping it is safe.
        try
        {
            await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS QueueEvents;");
        }
        catch {}
```

   - Delete the `STORE AND FORWARD EVENTS QUEUE` region: `EnqueueEventAsync`, `GetPendingEventsBatchAsync`, `CompleteEventsBatchAsync`, `FailEventsBatchAsync` (lines 807-870).
   - In `ResetSendingStatusAsync`, delete the `stuckEvents` block and drop it from the save condition (keep telemetry + OEE from Task 1).
4. `SyncService.cs`: delete the `// 2. Process Alert Events batch` block (lines 112-132).
5. `CloudClient.cs`: delete `SendEventsBatchAsync` and its doc comment (lines 488-504).
6. `BufferEndpoints.cs`: delete the `/api/buffer/events` route (lines 26-35).
7. `SettingsEndpoints.cs` line 150: change `DELETE FROM QueueEvents;` to `DELETE FROM OeeOutboxMessages;` (the buffer-clear admin action now clears the OEE outbox; `NextSeq` is deliberately untouched — the resulting seq gap is honest data loss the cloud flags as suspect).

- [ ] **Step 2: Fix the tests that referenced QueueEvent**

`ConfigurationBackupServiceTests.cs` used a `QueueEvent` row only to prove restore does not clobber non-config tables. Replace like-for-like:
- Line ~137: replace the `db.QueueEvents.Add(new QueueEvent {...})` block with:

```csharp
        db.OeeChannels.Add(new OeeChannel
        {
            ExternalId = "backup-nonconfig-probe",
            Name = "Probe",
            RunDataPointId = "dp-run",
            UpdatedAt = DateTime.UtcNow,
        });
```

- Line ~57: replace `Assert.Equal(1, await verified.QueueEvents.CountAsync());` with `Assert.Equal(1, await verified.OeeChannels.CountAsync());`
- Add `using Pulse.Edge.Storage.Models;` if not present.

(Note: OEE channels are intentionally NOT part of the configuration-backup payload in this slice — adding them requires a backup format-version bump. Recorded as a follow-up in Task 13.)

`AuthorizationMatrixTests.cs`: delete the row `["GET /api/buffer/events"] = Access.AuthenticatedRead,` (line 76). The completeness guard enforces that the matrix matches live routes exactly, so removal is mandatory.

- [ ] **Step 3: Verify nothing still references the removed pieces**

Run: `grep -rn "QueueEvent\|SendEventsBatchAsync\|EnqueueEventAsync\|GetPendingEventsBatchAsync" src/ --include="*.cs" | grep -v bin | grep -v obj`
Expected: no matches.

- [ ] **Step 4: Full backend test run, build, commit**

Run: `dotnet build Pulse.Edge.slnx --warnaserror` → clean.
Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj` → ALL PASS (integration suite included; the matrix completeness guard confirms the route removal).

```bash
git add -A src/
git commit -m "refactor(oee): remove dead legacy event subsystem (no producer ever existed)"
```

---

### Task 8: API — OeeEndpoints, dashboard count, authorization matrix

**Files:**
- Create: `src/Pulse.Edge.Api/Endpoints/OeeEndpoints.cs`
- Modify: `src/Pulse.Edge.Api/Program.cs` (map endpoints, after `app.MapBackupEndpoints();` line 318)
- Modify: `src/Pulse.Edge.Api/Endpoints/DashboardEndpoints.cs` (lines 29, 40, 62)
- Modify: `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs` (add 6 rows)
- Test: `src/Pulse.Edge.Tests/Integration/OeeEndpointsTests.cs`

**Interfaces:**
- Consumes: `OeeStorageService` (DI), `OeeChannel`.
- Produces REST surface:
  - `GET /api/oee/channels` → `OeeChannel[]`
  - `POST /api/oee/channels` body `{externalId, name, enabled, runDataPointId, faultDataPointId?, codeDataPointId?, goodDataPointId?, rejectDataPointId?, debounceSeconds}` → 201 + channel; 400 on validation failure; 409 on duplicate externalId
  - `PUT /api/oee/channels/{id}` same body → 200; **400 if externalId differs from the stored one** (immutability rule); 404 unknown id
  - `DELETE /api/oee/channels/{id}` → 200; 404
  - `GET /api/oee/status` → `{ channels: [{id, externalId, name, enabled, lastState, lastCode, lastStateChangedAt, pendingCount, nextSeq}], outboxDepth }`
  - `GET /api/oee/outbox` → recent 50 outbox rows (newest first)

- [ ] **Step 1: Write the failing integration tests**

```csharp
// src/Pulse.Edge.Tests/Integration/OeeEndpointsTests.cs
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class OeeEndpointsTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private record ChannelBody(
        string ExternalId, string Name, bool Enabled, string RunDataPointId,
        string? FaultDataPointId = null, string? CodeDataPointId = null,
        string? GoodDataPointId = null, string? RejectDataPointId = null,
        int DebounceSeconds = 2);

    private async Task<HttpClient> AdminAsync()
    {
        await factory.ResetDatabaseAsync();
        return await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
    }

    [Fact]
    public async Task CreateListDelete_Roundtrip()
    {
        var client = await AdminAsync();
        var externalId = "it-" + Guid.NewGuid().ToString("N");

        var create = await client.PostAsJsonAsync("/api/oee/channels",
            new ChannelBody(externalId, "IT Channel", true, "dp-run", GoodDataPointId: "dp-good"));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var id = created.RootElement.GetProperty("id").GetInt32();

        var list = await client.GetAsync("/api/oee/channels");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        Assert.Contains(externalId, await list.Content.ReadAsStringAsync());

        var delete = await client.DeleteAsync($"/api/oee/channels/{id}");
        Assert.Equal(HttpStatusCode.OK, delete.StatusCode);
    }

    [Fact]
    public async Task Create_RejectsMissingRunBinding_AndDuplicateExternalId()
    {
        var client = await AdminAsync();

        var missingRun = await client.PostAsJsonAsync("/api/oee/channels",
            new ChannelBody("x-" + Guid.NewGuid().ToString("N"), "X", true, ""));
        Assert.Equal(HttpStatusCode.BadRequest, missingRun.StatusCode);

        var externalId = "dup-" + Guid.NewGuid().ToString("N");
        var first = await client.PostAsJsonAsync("/api/oee/channels", new ChannelBody(externalId, "A", true, "dp-run"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var second = await client.PostAsJsonAsync("/api/oee/channels", new ChannelBody(externalId, "B", true, "dp-run"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Update_RejectsExternalIdChange()
    {
        var client = await AdminAsync();
        var externalId = "immutable-" + Guid.NewGuid().ToString("N");
        var create = await client.PostAsJsonAsync("/api/oee/channels", new ChannelBody(externalId, "A", true, "dp-run"));
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var id = created.RootElement.GetProperty("id").GetInt32();

        var renamedOk = await client.PutAsJsonAsync($"/api/oee/channels/{id}",
            new ChannelBody(externalId, "Renamed", true, "dp-run"));
        Assert.Equal(HttpStatusCode.OK, renamedOk.StatusCode);

        var mutated = await client.PutAsJsonAsync($"/api/oee/channels/{id}",
            new ChannelBody("different-identity", "Renamed", true, "dp-run"));
        Assert.Equal(HttpStatusCode.BadRequest, mutated.StatusCode);
    }

    [Fact]
    public async Task Create_RejectsRejectWithoutGood()
    {
        var client = await AdminAsync();
        var res = await client.PostAsJsonAsync("/api/oee/channels",
            new ChannelBody("r-" + Guid.NewGuid().ToString("N"), "R", true, "dp-run", RejectDataPointId: "dp-reject"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task StatusAndOutbox_AreReadable()
    {
        var client = await AdminAsync();
        var status = await client.GetAsync("/api/oee/status");
        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        Assert.Contains("outboxDepth", await status.Content.ReadAsStringAsync());

        var outbox = await client.GetAsync("/api/oee/outbox");
        Assert.Equal(HttpStatusCode.OK, outbox.StatusCode);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeEndpointsTests`
Expected: FAIL — 404s (endpoints not mapped).

- [ ] **Step 3: Implement `OeeEndpoints.cs`**

```csharp
// src/Pulse.Edge.Api/Endpoints/OeeEndpoints.cs
using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Api.Endpoints;

public static class OeeEndpoints
{
    public record OeeChannelRequest(
        string ExternalId,
        string Name,
        bool Enabled,
        string RunDataPointId,
        string? FaultDataPointId,
        string? CodeDataPointId,
        string? GoodDataPointId,
        string? RejectDataPointId,
        int DebounceSeconds);

    private static string? Validate(OeeChannelRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ExternalId)) return "externalId is required.";
        if (string.IsNullOrWhiteSpace(req.Name)) return "name is required.";
        if (string.IsNullOrWhiteSpace(req.RunDataPointId)) return "runDataPointId is required.";
        if (req.DebounceSeconds is < 0 or > 60) return "debounceSeconds must be between 0 and 60.";
        if (!string.IsNullOrEmpty(req.RejectDataPointId) && string.IsNullOrEmpty(req.GoodDataPointId))
            return "rejectDataPointId requires goodDataPointId (counters capability is derived from the good counter).";
        return null;
    }

    public static void MapOeeEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/oee/channels", async (OeeStorageService oee) =>
            Results.Ok(await oee.GetChannelsAsync()));

        routes.MapPost("/api/oee/channels", async (OeeChannelRequest req, OeeStorageService oee) =>
        {
            var error = Validate(req);
            if (error != null) return Results.BadRequest(new { error });

            var existing = await oee.GetChannelsAsync();
            if (existing.Any(c => c.ExternalId == req.ExternalId))
                return Results.Conflict(new { error = $"A channel with externalId '{req.ExternalId}' already exists." });

            var channel = await oee.CreateChannelAsync(new OeeChannel
            {
                ExternalId = req.ExternalId.Trim(),
                Name = req.Name.Trim(),
                Enabled = req.Enabled,
                RunDataPointId = req.RunDataPointId,
                FaultDataPointId = NullIfEmpty(req.FaultDataPointId),
                CodeDataPointId = NullIfEmpty(req.CodeDataPointId),
                GoodDataPointId = NullIfEmpty(req.GoodDataPointId),
                RejectDataPointId = NullIfEmpty(req.RejectDataPointId),
                DebounceSeconds = req.DebounceSeconds,
            });
            return Results.Created($"/api/oee/channels/{channel.Id}", channel);
        });

        routes.MapPut("/api/oee/channels/{id}", async (int id, OeeChannelRequest req, OeeStorageService oee) =>
        {
            var error = Validate(req);
            if (error != null) return Results.BadRequest(new { error });

            var existing = await oee.GetChannelAsync(id);
            if (existing == null) return Results.NotFound();

            // Contract §2.1: externalId is the channel's identity, stable forever.
            // Changing it would orphan cloud-side history — enforce immutability here,
            // the only place it could be broken.
            if (!string.Equals(existing.ExternalId, req.ExternalId, StringComparison.Ordinal))
                return Results.BadRequest(new { error = "externalId is immutable. Delete the channel and create a new one for a different machine identity." });

            existing.Name = req.Name.Trim();
            existing.Enabled = req.Enabled;
            existing.RunDataPointId = req.RunDataPointId;
            existing.FaultDataPointId = NullIfEmpty(req.FaultDataPointId);
            existing.CodeDataPointId = NullIfEmpty(req.CodeDataPointId);
            existing.GoodDataPointId = NullIfEmpty(req.GoodDataPointId);
            existing.RejectDataPointId = NullIfEmpty(req.RejectDataPointId);
            existing.DebounceSeconds = req.DebounceSeconds;

            return await oee.UpdateChannelAsync(existing) ? Results.Ok(existing) : Results.NotFound();
        });

        routes.MapDelete("/api/oee/channels/{id}", async (int id, OeeStorageService oee) =>
            await oee.DeleteChannelAsync(id) ? Results.Ok() : Results.NotFound());

        routes.MapGet("/api/oee/status", async (OeeStorageService oee) =>
        {
            var channels = await oee.GetChannelsAsync();
            using var db = new QueueDbContext();
            var pendingByChannel = await db.OeeOutboxMessages
                .GroupBy(m => m.ChannelId)
                .Select(g => new { ChannelId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ChannelId, x => x.Count);

            return Results.Ok(new
            {
                Channels = channels.Select(c => new
                {
                    c.Id,
                    c.ExternalId,
                    c.Name,
                    c.Enabled,
                    c.LastState,
                    c.LastCode,
                    c.LastStateChangedAt,
                    c.NextSeq,
                    PendingCount = pendingByChannel.GetValueOrDefault(c.Id),
                }),
                OutboxDepth = pendingByChannel.Values.Sum(),
            });
        });

        routes.MapGet("/api/oee/outbox", async (OeeStorageService oee) =>
            Results.Ok(await oee.GetRecentOutboxAsync(50)));
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;
}
```

In `src/Pulse.Edge.Api/Program.cs`, after `app.MapBackupEndpoints();` (line 318), add:

```csharp
app.MapOeeEndpoints();
```

- [ ] **Step 4: Dashboard count**

`DashboardEndpoints.cs`:
- Line 29: `int pendingEventsCount = await db.QueueEvents.CountAsync();` → `int pendingOeeCount = await db.OeeOutboxMessages.CountAsync();`
- Line 40: `pendingTelemetryCount + pendingEventsCount` → `pendingTelemetryCount + pendingOeeCount`
- Line 62: `PendingEvents = pendingEventsCount` → `PendingOee = pendingOeeCount`

- [ ] **Step 5: Authorization matrix rows**

In `AuthorizationMatrixTests.cs`, add to the Admin-only mutations section:

```csharp
        ["POST /api/oee/channels"] = Access.AdminMutation,
        ["PUT /api/oee/channels/{id}"] = Access.AdminMutation,
        ["DELETE /api/oee/channels/{id}"] = Access.AdminMutation,
```

and to the Authenticated reads section:

```csharp
        ["GET /api/oee/channels"] = Access.AuthenticatedRead,
        ["GET /api/oee/status"] = Access.AuthenticatedRead,
        ["GET /api/oee/outbox"] = Access.AuthenticatedRead,
```

- [ ] **Step 6: Run tests, build, commit**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeEndpointsTests` → PASS (5 tests).
Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~AuthorizationMatrixTests` → PASS (matrix guard validates the new routes).

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/ src/Pulse.Edge.Tests/
git commit -m "feat(oee): /api/oee endpoints (channel CRUD + status + outbox) with authz coverage"
```

---

### Task 9: Simulator reject counter

**Files:**
- Modify: `src/Pulse.Edge.Agent/SimulatorDriver.cs`
- Test: `src/Pulse.Edge.Tests/SimulatorDriverOeeTests.cs`

The simulator's production template already provides everything an OEE channel needs — `running` (run signal), `fault_code` (fault signal AND code), `total_count` (good counter) — except a reject counter. Add one so a full counters-capable channel can be commissioned with zero hardware.

- [ ] **Step 1: Write the failing test**

```csharp
// src/Pulse.Edge.Tests/SimulatorDriverOeeTests.cs
using System;
using Pulse.Edge.Agent;
using Pulse.Edge.Storage;
using Xunit;

namespace Pulse.Edge.Tests;

public class SimulatorDriverOeeTests
{
    [Fact]
    public void RejectCount_IsCumulative_AndAddressResolves()
    {
        var driver = new SimulatorDriver();
        var adapterId = "sim-oee-test";
        using var db = new QueueDbContext();

        // Two updates 100 simulated seconds apart. UpdateState derives running/idle/fault
        // from (t % 300): <240 running. Shift t1 until the whole 100 s window is inside
        // the running phase so production (and rejects) must accumulate — deterministic.
        var t1 = new DateTime(2026, 7, 18, 0, 0, 0, DateTimeKind.Utc);
        while (((t1.Ticks / 10000000.0) % 300.0) >= 140.0) { t1 = t1.AddSeconds(10); }
        var t2 = t1.AddSeconds(100);
        driver.UpdateState(adapterId, "production", t1, db);
        driver.UpdateState(adapterId, "production", t2, db);

        var reject = driver.ReadValue(adapterId, "reject_count");
        var total = driver.ReadValue(adapterId, "total_count");
        Assert.True(total > 10000.0, $"total_count should have accumulated, got {total}");
        Assert.True(reject > 0.0, $"reject_count should have accumulated, got {reject}");
        Assert.True(reject < total);

        // Cumulative totalizer: a later read never decreases.
        driver.UpdateState(adapterId, "production", t2.AddSeconds(50), db);
        Assert.True(driver.ReadValue(adapterId, "reject_count") >= reject);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~SimulatorDriverOeeTests`
Expected: FAIL on `reject > 0.0` — the `reject_count` address falls through to the `0.0` fallback because it does not exist yet.

- [ ] **Step 3: Implement**

In `SimulatorState` (after `AccumulatedCount`, line 22): `public double AccumulatedReject { get; set; } = 200.0;`

In `UpdateState`, inside `if (state.Running)` (after the `AccumulatedCount` accumulation, line 99): reject ≈ 2 % of production:

```csharp
                    state.AccumulatedReject += (state.Speed / 60.0) * seconds * 0.02;
```

In `ReadValue`, after the `total_count` line (129):

```csharp
        if (addr == "reject_count" || addr == "rejects" || addr == "rejectcount") return Math.Floor(state.AccumulatedReject);
```

- [ ] **Step 4: Run test, build, commit**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~SimulatorDriverOeeTests` → PASS.

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Agent/SimulatorDriver.cs src/Pulse.Edge.Tests/SimulatorDriverOeeTests.cs
git commit -m "feat(oee): simulator reject counter for hardware-free OEE commissioning"
```

---

### Task 10: End-to-end outage-and-replay integration test

**Files:**
- Test: `src/Pulse.Edge.Tests/OeeEndToEndTests.cs`

**Interfaces:**
- Consumes: everything from Tasks 1–6 (`OeeStorageService`, `OeeStateEngine`, `OeeSyncService.RunOnceAsync`, `CloudClient` with scripted handler). This test mirrors the contract's §8 worked scenario.

- [ ] **Step 1: Write the test (it should pass immediately if Tasks 1–6 are correct — it is a verification gate, not TDD; any failure is a real integration bug)**

```csharp
// src/Pulse.Edge.Tests/OeeEndToEndTests.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

/// <summary>
/// Scripted fake cloud: returns queued responses in order; records every request.
/// </summary>
internal sealed class FakeCloudHandler : HttpMessageHandler
{
    public readonly Queue<Func<HttpRequestMessage, HttpResponseMessage>> Script = new();
    public readonly List<(string Path, string Body)> Requests = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(ct);
        Requests.Add((request.RequestUri!.AbsolutePath, body));
        if (Script.Count == 0)
            return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("{}") };
        return Script.Dequeue()(request);
    }

    public static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json") };
}

public class OeeEndToEndTests : IAsyncLifetime
{
    private readonly QueueStorageService _queueStorage = new();
    private readonly OeeStorageService _oee = new();
    private int _channelId;
    private string _externalId = null!;
    private string _deviceConfigId = null!;

    public async Task InitializeAsync()
    {
        await _queueStorage.InitializeAsync();
        _externalId = "e2e-" + Guid.NewGuid().ToString("N");
        var channel = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = _externalId,
            Name = "E2E Filler",
            RunDataPointId = "dp-run",
            FaultDataPointId = "dp-fault",
            GoodDataPointId = "dp-good",
            DebounceSeconds = 0,
        });
        _channelId = channel.Id;

        // Seed a device config with an API key so RunOnceAsync proceeds.
        using var db = new QueueDbContext();
        var existing = await db.DeviceConfigs.FirstOrDefaultAsync();
        if (existing == null)
        {
            _deviceConfigId = Guid.NewGuid().ToString();
            db.DeviceConfigs.Add(new DeviceConfig
            {
                Id = _deviceConfigId,
                ApiKey = "e2e-test-key",
                CloudEndpoint = "http://localhost:3000",
                IsSyncEnabled = true,
            });
            await db.SaveChangesAsync();
        }
        else
        {
            _deviceConfigId = ""; // pre-existing config — leave it alone, just ensure usable
            existing.ApiKey = string.IsNullOrEmpty(existing.ApiKey) ? "e2e-test-key" : existing.ApiKey;
            existing.IsSyncEnabled = true;
            await db.SaveChangesAsync();
        }
    }

    public async Task DisposeAsync()
    {
        await _oee.DeleteChannelAsync(_channelId);
        if (!string.IsNullOrEmpty(_deviceConfigId))
        {
            using var db = new QueueDbContext();
            await db.DeviceConfigs.Where(c => c.Id == _deviceConfigId).ExecuteDeleteAsync();
        }
    }

    private OeeSyncService MakeService(FakeCloudHandler handler) => new(
        NullLogger<OeeSyncService>.Instance,
        _queueStorage,
        _oee,
        new CloudClient(NullLogger<CloudClient>.Instance, handler));

    private async Task ProduceMessagesAsync()
    {
        var engine = new OeeStateEngine(NullLogger<OeeStateEngine>.Instance, _oee);
        var t0 = new DateTime(2026, 7, 18, 10, 0, 0, DateTimeKind.Utc);
        List<DataPoint> Sig(double run, double fault, double good) =>
        [
            new() { Id = "dp-run",   LastValue = run.ToString(),   LastUpdated = DateTime.UtcNow },
            new() { Id = "dp-fault", LastValue = fault.ToString(), LastUpdated = DateTime.UtcNow },
            new() { Id = "dp-good",  LastValue = good.ToString(),  LastUpdated = DateTime.UtcNow },
        ];
        await engine.EvaluateAsync(Sig(1, 0, 100), t0);                 // boot sync (seq 0)
        await engine.EvaluateAsync(Sig(0, 1, 182440), t0.AddSeconds(5)); // fault transition (seq 1, debounce 0)
        await engine.EvaluateAsync(Sig(0, 1, 182440), t0.AddSeconds(65)); // 60s sync (seq 2)
    }

    private async Task<int> PendingCountAsync()
    {
        using var db = new QueueDbContext();
        return await db.OeeOutboxMessages.CountAsync(m => m.ChannelId == _channelId);
    }

    [Fact]
    public async Task OutageThenReplay_DrainsOutbox_AndDuplicateReplayIsSafe()
    {
        await ProduceMessagesAsync();
        Assert.Equal(3, await PendingCountAsync());

        // ── Outage: declaration succeeds, events get 503 → nothing acknowledged ──
        var down = new FakeCloudHandler();
        down.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Created, "[]"));               // declare
        down.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.ServiceUnavailable, "{}"));    // events
        var service = MakeService(down);
        Assert.False(await service.RunOnceAsync(CancellationToken.None));
        Assert.Equal(3, await PendingCountAsync()); // outbox intact

        // ── Recovery: a fresh service instance declares first, then re-sends the batch ──
        var up = new FakeCloudHandler();
        up.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Created, "[]"));                 // declare (new instance)
        up.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Accepted,
            "{\"accepted\":3,\"rejected\":0,\"duplicates\":0}"));
        var service2 = MakeService(up);
        Assert.True(await service2.RunOnceAsync(CancellationToken.None));
        Assert.Equal(0, await PendingCountAsync());

        // The batch was oldest-first with contiguous seqs.
        var eventsBody = up.Requests.Single(r => r.Path == "/edge/oee/events").Body;
        using var doc = JsonDocument.Parse(eventsBody);
        var seqs = doc.RootElement.EnumerateArray().Select(m => m.GetProperty("seq").GetInt64()).ToList();
        Assert.Equal(new List<long> { 0, 1, 2 }, seqs);
        Assert.All(doc.RootElement.EnumerateArray(),
            m => Assert.Equal(_externalId, m.GetProperty("channel").GetString()));
    }

    [Fact]
    public async Task LostAck_Replay_AllDuplicates_StillClearsOutbox()
    {
        await ProduceMessagesAsync();

        // First send: cloud stored everything but the 202 was "lost" (transient on our side).
        var flaky = new FakeCloudHandler();
        flaky.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Created, "[]"));
        flaky.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.RequestTimeout, "{}")); // non-2xx → transient
        var s1 = MakeService(flaky);
        Assert.False(await s1.RunOnceAsync(CancellationToken.None));
        Assert.Equal(3, await PendingCountAsync());

        // Replay: everything is a duplicate — acknowledged all the same (contract §8 step 4).
        var replay = new FakeCloudHandler();
        replay.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Created, "[]"));             // declare (new instance)
        replay.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Accepted,
            "{\"accepted\":3,\"rejected\":0,\"duplicates\":3}"));
        var s2 = MakeService(replay);
        Assert.True(await s2.RunOnceAsync(CancellationToken.None));
        Assert.Equal(0, await PendingCountAsync());
    }

    [Fact]
    public async Task UnknownChannel_Releases_AndForcesRedeclaration()
    {
        await ProduceMessagesAsync();

        var handler = new FakeCloudHandler();
        handler.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Created, "[]"));            // declare #1
        handler.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Accepted,
            "{\"accepted\":0,\"rejected\":3,\"duplicates\":0,\"errors\":[" +
            $"{{\"index\":0,\"reason\":\"unknown channel '{_externalId}'\"}}," +
            $"{{\"index\":1,\"reason\":\"unknown channel '{_externalId}'\"}}," +
            $"{{\"index\":2,\"reason\":\"unknown channel '{_externalId}'\"}}]}}"));
        handler.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Created, "[]"));            // re-declare
        handler.Script.Enqueue(_ => FakeCloudHandler.Json(HttpStatusCode.Accepted,
            "{\"accepted\":3,\"rejected\":0,\"duplicates\":0}"));

        var service = MakeService(handler);
        Assert.True(await service.RunOnceAsync(CancellationToken.None)); // released, flagged for re-declare
        Assert.Equal(3, await PendingCountAsync());
        Assert.True(await service.RunOnceAsync(CancellationToken.None)); // re-declared + delivered
        Assert.Equal(0, await PendingCountAsync());

        Assert.Equal(2, handler.Requests.Count(r => r.Path == "/edge/oee/channels"));
    }
}
```

Note: these tests share the real `edge.db` with other suites (same convention as `QueueStorageServiceTests`); pre-existing outbox rows from other channels are excluded because every assertion filters on `_channelId` — EXCEPT `RunOnceAsync`, which drains globally. If cross-test interference appears, run this class serially (it already is within xunit's per-class serialization) and ensure other OEE tests clean up their channels (they do, via `DisposeAsync`).

- [ ] **Step 2: Run the tests**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~OeeEndToEndTests`
Expected: PASS (3 tests). Any failure is a real integration bug — debug with superpowers:systematic-debugging, do not weaken assertions.

- [ ] **Step 3: Commit**

```bash
git add src/Pulse.Edge.Tests/OeeEndToEndTests.cs
git commit -m "test(oee): end-to-end outage/replay/dedup and unknown-channel re-declaration"
```

---

### Task 11: UI — replace events with OEE outbox (types, hook, Buffer tab, dashboard)

**Files:**
- Modify: `src/Pulse.Edge.UI/src/types.ts` (~line 104: `BufferEventItem`; ~line 22: `queue`)
- Modify: `src/Pulse.Edge.UI/src/context/edge.ts` (~lines 35-36), `src/Pulse.Edge.UI/src/context/EdgeContext.tsx` (~lines 9, 26, 120)
- Modify: `src/Pulse.Edge.UI/src/hooks/useBufferStatus.ts`
- Modify: `src/Pulse.Edge.UI/src/components/BufferTab.tsx` (events panel → OEE outbox panel)
- Modify: `src/Pulse.Edge.UI/src/App.tsx` (~line 541: BufferTab props)
- Modify: any component reading `queue.pendingEvents` (find with the grep in Step 1)

Before writing UI code, invoke the `pulse` skill (PULSE design system) — the panel/table markup must reuse the existing `.panel` / `.data-table` / badge classes exactly as `BufferTab.tsx` already does.

- [ ] **Step 1: Find every touchpoint**

Run: `grep -rn "pendingEvents\|bufferEvents\|BufferEventItem\|buffer/events" src/Pulse.Edge.UI/src --include="*.ts" --include="*.tsx"`
Expected hits: `types.ts`, `context/edge.ts`, `context/EdgeContext.tsx`, `hooks/useBufferStatus.ts`, `components/BufferTab.tsx`, `App.tsx`, plus possibly `components/DashboardTab.tsx` / `components/Dashboard/*` (queue counts). Every hit gets updated in this task; list them in the commit message.

- [ ] **Step 2: Update types**

In `types.ts`, replace the `BufferEventItem` interface (~line 104) with:

```typescript
export interface OeeOutboxItem {
  id: number;
  channelId: number;
  seq: number;
  type: string;      // "state" | "sync"
  ts: string;
  state: string;     // "running" | "stopped" | "fault"
  code: string | null;
  goodCount: number | null;
  rejectCount: number | null;
  isSending: boolean;
  retryCount: number;
  createdAt: string;
}
```

and in `DashboardData.queue` (~line 22) rename `pendingEvents: number;` → `pendingOee: number;`.

- [ ] **Step 3: Update context**

`context/edge.ts`: rename `bufferEvents: BufferEventItem[]` → `oeeOutbox: OeeOutboxItem[]` and `setBufferEvents` → `setOeeOutbox` (fix the import).
`context/EdgeContext.tsx`: same rename in the import (~line 9), state (~line 26: `const [oeeOutbox, setOeeOutbox] = useState<OeeOutboxItem[]>([]);`), and provider value (~line 120).

- [ ] **Step 4: Update the hook**

In `useBufferStatus.ts`: change the destructure to `setOeeOutbox`, the fetch to `fetch('/api/oee/outbox')`, and the setter call to `setOeeOutbox(eventData)` (rename the local `eventRes`/`eventData` to `oeeRes`/`oeeData`). Update the effect dependency array accordingly.

- [ ] **Step 5: Replace the BufferTab events panel**

In `BufferTab.tsx`: change the import to `import type { BufferTelemetryItem, OeeOutboxItem } from '../types';`, the props to `{ bufferTelemetry, oeeOutbox }: { bufferTelemetry: BufferTelemetryItem[]; oeeOutbox: OeeOutboxItem[] }`, and replace the entire second `<div className="panel">` (lines 141-192) with:

```tsx
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-col">
            <h2 className="panel-title">OEE Outbox — <code>OeeOutboxMessages</code></h2>
            <span className="panel-subtitle">
              Machine state transitions and syncs awaiting cloud acknowledgment (dedup key: channel + seq)
            </span>
          </div>
          <span className="badge info">{oeeOutbox.length} message{oeeOutbox.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="table-scroll-sm">
          {oeeOutbox.length === 0 ? (
            <div className="table-empty">Outbox is empty — all OEE events acknowledged by the cloud.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-id">Seq</th>
                  <th>Type</th>
                  <th>State</th>
                  <th>Counters</th>
                  <th className="col-time">Observed At</th>
                  <th className="col-retries">Retries</th>
                  <th className="col-status">Status</th>
                </tr>
              </thead>
              <tbody>
                {oeeOutbox.map((item) => (
                  <tr key={item.id}>
                    <td className="cell-mono-secondary">#{item.seq}</td>
                    <td><span className="event-badge">{item.type}</span></td>
                    <td>
                      <span className={`badge ${item.state === 'running' ? 'info' : 'warning'}`}>
                        {item.state}{item.code ? ` (${item.code})` : ''}
                      </span>
                    </td>
                    <td className="cell-mono-code">
                      {item.goodCount !== null
                        ? `good ${item.goodCount}${item.rejectCount !== null ? ` / reject ${item.rejectCount}` : ''}`
                        : '—'}
                    </td>
                    <td className="cell-mono-nowrap">{formatToLocalTime(item.ts)}</td>
                    <td className="cell-center">
                      {item.retryCount > 0 ? (
                        <span className="badge warning">{item.retryCount}</span>
                      ) : (
                        <span className="text-secondary">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${item.isSending ? 'warning' : 'info'}`}>
                        {item.isSending ? '⬆ Syncing' : '⏸ Buffered'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
```

Also update the page-header description (line 56-58) to: `Inspect the store-and-forward SQLite queues for pending telemetry frames and OEE machine-state messages.`

- [ ] **Step 6: Update App.tsx and any dashboard usages**

`App.tsx` line ~541: pass `oeeOutbox={oeeOutbox}` (from `useEdge()`) instead of `bufferEvents`. Update every remaining grep hit from Step 1 (e.g. dashboard queue cards → `queue.pendingOee` labelled "Pending OEE"). No hit may remain.

- [ ] **Step 7: Lint, test, build, commit**

```bash
pnpm lint:ui   # zero errors
pnpm test:ui   # green
pnpm build:ui  # tsc catches any missed rename
git add src/Pulse.Edge.UI/
git commit -m "feat(oee): UI buffer tab shows OEE outbox; drop legacy events panel"
```

---

### Task 12: UI — OEE commissioning tab

**Files:**
- Create: `src/Pulse.Edge.UI/src/components/OeeTab.tsx`
- Create: `src/Pulse.Edge.UI/src/components/OeeTab.test.tsx`
- Modify: `src/Pulse.Edge.UI/src/App.tsx` (route `'oee'`, sidebar item, tab render)
- Modify: `src/Pulse.Edge.UI/src/types.ts` (channel/status types)

**MANDATORY:** invoke the `pulse` skill before writing this component and mirror the structure of an existing CRUD tab (`DataSourcesTab.tsx`) for form field markup, modal usage (`ModalShell`), and select controls (`CustomSelect` if that is what sibling tabs use). The code below is the functional contract — align its class names with what the pulse skill and sibling tabs prescribe.

- [ ] **Step 1: Add types to `types.ts`**

```typescript
export interface OeeChannel {
  id: number;
  externalId: string;
  name: string;
  enabled: boolean;
  runDataPointId: string;
  faultDataPointId: string | null;
  codeDataPointId: string | null;
  goodDataPointId: string | null;
  rejectDataPointId: string | null;
  debounceSeconds: number;
  nextSeq: number;
  lastState: string | null;
  lastStateChangedAt: string | null;
  lastCode: string | null;
  updatedAt: string;
}

export interface OeeChannelStatus {
  id: number;
  externalId: string;
  name: string;
  enabled: boolean;
  lastState: string | null;
  lastCode: string | null;
  lastStateChangedAt: string | null;
  nextSeq: number;
  pendingCount: number;
}

export interface OeeStatusResponse {
  channels: OeeChannelStatus[];
  outboxDepth: number;
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// src/Pulse.Edge.UI/src/components/OeeTab.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import OeeTab from './OeeTab';

describe('OeeTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/oee/status')) {
        return Promise.resolve(new Response(JSON.stringify({
          channels: [{
            id: 1, externalId: 'line1.filler', name: 'Line 1 — Filler', enabled: true,
            lastState: 'fault', lastCode: 'E17', lastStateChangedAt: '2026-07-18T06:14:03.250Z',
            nextSeq: 4103, pendingCount: 2,
          }],
          outboxDepth: 2,
        })));
      }
      if (url.startsWith('/api/datapoints')) {
        return Promise.resolve(new Response(JSON.stringify([])));
      }
      return Promise.resolve(new Response('[]'));
    }));
  });

  it('renders channel list with live state badge', async () => {
    render(<OeeTab datapoints={[]} />);
    await waitFor(() => {
      expect(screen.getByText('Line 1 — Filler')).toBeInTheDocument();
      expect(screen.getByText(/fault/i)).toBeInTheDocument();
      expect(screen.getByText('line1.filler')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no channels exist', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ channels: [], outboxDepth: 0 })))));
    render(<OeeTab datapoints={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/no oee channels/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter pulse-edge-ui test -- OeeTab`
Expected: FAIL — `OeeTab` module not found.

- [ ] **Step 4: Implement `OeeTab.tsx`**

Functional requirements (markup per pulse skill / sibling tabs):

```tsx
// src/Pulse.Edge.UI/src/components/OeeTab.tsx
import { useCallback, useEffect, useState } from 'react';
import { Activity, Plus, Pencil, Trash2 } from 'lucide-react';
import ModalShell from './ModalShell';
import type { DataPoint, OeeChannel, OeeStatusResponse } from '../types';

const STATE_BADGE: Record<string, string> = {
  running: 'success',
  stopped: 'warning',
  fault: 'danger',
};

interface OeeTabProps {
  datapoints: DataPoint[];
}

interface ChannelForm {
  externalId: string;
  name: string;
  enabled: boolean;
  runDataPointId: string;
  faultDataPointId: string;
  codeDataPointId: string;
  goodDataPointId: string;
  rejectDataPointId: string;
  debounceSeconds: number;
}

const emptyForm: ChannelForm = {
  externalId: '', name: '', enabled: true, runDataPointId: '',
  faultDataPointId: '', codeDataPointId: '', goodDataPointId: '',
  rejectDataPointId: '', debounceSeconds: 2,
};

export default function OeeTab({ datapoints }: OeeTabProps) {
  const [status, setStatus] = useState<OeeStatusResponse>({ channels: [], outboxDepth: 0 });
  const [channels, setChannels] = useState<OeeChannel[]>([]);
  const [editing, setEditing] = useState<OeeChannel | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<ChannelForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [statusRes, channelsRes] = await Promise.all([
        fetch('/api/oee/status'),
        fetch('/api/oee/channels'),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (channelsRes.ok) setChannels(await channelsRes.json());
    } catch {
      // polling; next tick recovers
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
    setShowModal(true);
  };

  const openEdit = (channel: OeeChannel) => {
    setEditing(channel);
    setForm({
      externalId: channel.externalId,
      name: channel.name,
      enabled: channel.enabled,
      runDataPointId: channel.runDataPointId,
      faultDataPointId: channel.faultDataPointId ?? '',
      codeDataPointId: channel.codeDataPointId ?? '',
      goodDataPointId: channel.goodDataPointId ?? '',
      rejectDataPointId: channel.rejectDataPointId ?? '',
      debounceSeconds: channel.debounceSeconds,
    });
    setError(null);
    setShowModal(true);
  };

  const save = async () => {
    setError(null);
    const body = {
      ...form,
      faultDataPointId: form.faultDataPointId || null,
      codeDataPointId: form.codeDataPointId || null,
      goodDataPointId: form.goodDataPointId || null,
      rejectDataPointId: form.rejectDataPointId || null,
    };
    const res = editing
      ? await fetch(`/api/oee/channels/${editing.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
      : await fetch('/api/oee/channels', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
      setError(data.error ?? `Request failed (${res.status})`);
      return;
    }
    setShowModal(false);
    void refresh();
  };

  const remove = async (channel: OeeChannel) => {
    if (!window.confirm(`Delete OEE channel "${channel.name}"? Its queued messages are discarded and cloud history for "${channel.externalId}" is orphaned.`)) return;
    await fetch(`/api/oee/channels/${channel.id}`, { method: 'DELETE' });
    void refresh();
  };

  const tagSelect = (label: string, value: string, onChange: (v: string) => void, required = false) => (
    <label className="ui-field-label">
      {label}{required ? ' *' : ''}
      <select className="ui-input" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{required ? 'Select a tag…' : '— not wired —'}</option>
        {datapoints.map(dp => (
          <option key={dp.id} value={dp.id}>
            {dp.address}{dp.description ? ` — ${dp.description}` : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Activity size={24} className="page-header-icon" />
            OEE Channels
          </h2>
          <p className="page-header-desc">
            Monitored machines reporting state transitions and production counters to PULSE Cloud.
            Outbox depth: {status.outboxDepth}
          </p>
        </div>
        <button type="button" className="btn primary" onClick={openCreate}>
          <Plus size={16} /> Add Channel
        </button>
      </div>

      <div className="panel">
        <div className="table-scroll-md">
          {status.channels.length === 0 ? (
            <div className="table-empty">No OEE channels configured — add one to start reporting machine state.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>External ID</th>
                  <th>Live State</th>
                  <th className="col-time">Since</th>
                  <th>Pending</th>
                  <th>Next Seq</th>
                  <th className="col-status">Actions</th>
                </tr>
              </thead>
              <tbody>
                {status.channels.map(c => {
                  const channel = channels.find(x => x.id === c.id);
                  return (
                    <tr key={c.id}>
                      <td>{c.name}{!c.enabled && <span className="badge warning">disabled</span>}</td>
                      <td><span className="stream-badge">{c.externalId}</span></td>
                      <td>
                        {c.lastState ? (
                          <span className={`badge ${STATE_BADGE[c.lastState] ?? 'info'}`}>
                            {c.lastState}{c.lastCode ? ` (${c.lastCode})` : ''}
                          </span>
                        ) : (
                          <span className="text-secondary">no data</span>
                        )}
                      </td>
                      <td className="cell-mono-nowrap">
                        {c.lastStateChangedAt ? new Date(c.lastStateChangedAt.endsWith('Z') ? c.lastStateChangedAt : c.lastStateChangedAt + 'Z').toLocaleString() : '—'}
                      </td>
                      <td className="cell-center">{c.pendingCount > 0 ? <span className="badge warning">{c.pendingCount}</span> : '—'}</td>
                      <td className="cell-mono-secondary">#{c.nextSeq}</td>
                      <td>
                        {channel && (
                          <>
                            <button type="button" className="btn ghost" onClick={() => openEdit(channel)} aria-label={`Edit ${c.name}`}>
                              <Pencil size={14} />
                            </button>
                            <button type="button" className="btn ghost danger" onClick={() => remove(channel)} aria-label={`Delete ${c.name}`}>
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <ModalShell
          title={editing ? `Edit Channel — ${editing.name}` : 'Add OEE Channel'}
          subtitle="Bind PLC tags to machine-state roles. The edge reports what these signals say — classification happens in the cloud."
          onClose={() => setShowModal(false)}
          size="md"
        >
          <div className="modal-body">
            {error && <div className="alert danger">{error}</div>}
            <label className="ui-field-label">
              External ID *
              <input
                className="ui-input"
                value={form.externalId}
                disabled={!!editing}
                placeholder="line1.filler"
                onChange={e => setForm({ ...form, externalId: e.target.value })}
              />
              {editing && <span className="field-hint">The external ID is the channel's permanent cloud identity and cannot be changed.</span>}
            </label>
            <label className="ui-field-label">
              Name *
              <input className="ui-input" value={form.name} placeholder="Line 1 — Filler"
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            {tagSelect('Run signal (nonzero = running)', form.runDataPointId, v => setForm({ ...form, runDataPointId: v }), true)}
            {tagSelect('Fault signal (nonzero = fault; leave unwired if the PLC has none)', form.faultDataPointId, v => setForm({ ...form, faultDataPointId: v }))}
            {tagSelect('Fault/reason code tag (passed through verbatim)', form.codeDataPointId, v => setForm({ ...form, codeDataPointId: v }))}
            {tagSelect('Good counter (cumulative totalizer)', form.goodDataPointId, v => setForm({ ...form, goodDataPointId: v }))}
            {tagSelect('Reject counter (cumulative totalizer)', form.rejectDataPointId, v => setForm({ ...form, rejectDataPointId: v }))}
            <label className="ui-field-label">
              Debounce (seconds)
              <input className="ui-input" type="number" min={0} max={60} value={form.debounceSeconds}
                onChange={e => setForm({ ...form, debounceSeconds: Number(e.target.value) })} />
            </label>
            <label className="ui-field-label">
              <input type="checkbox" checked={form.enabled}
                onChange={e => setForm({ ...form, enabled: e.target.checked })} /> Enabled
            </label>
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="button" className="btn primary" onClick={save}>{editing ? 'Save Changes' : 'Create Channel'}</button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the route in `App.tsx`**

- Line 59-60: add `'oee'` to the `Route` union and `validRoutes` array.
- Sidebar (after the buffer menu item, ~line 421-428): add a menu item with icon `Activity` (import from `lucide-react`), label "OEE", `onClick={() => setActiveTab('oee')}`, `className={`menu-item ${activeTab === 'oee' ? 'active' : ''}`}` — copy the exact markup shape of the buffer item.
- Content area (~line 541): add `{activeTab === 'oee' && <OeeTab datapoints={datapoints} />}` (source `datapoints` the same way TagsTab does — check its props at line ~520 and reuse; enable datapoint polling for the tab by extending line 128's condition to `activeTab === 'tags' || activeTab === 'datasources' || activeTab === 'oee'`).
- Import: `import OeeTab from './components/OeeTab';`

- [ ] **Step 6: Run UI tests, lint, build, commit**

```bash
pnpm --filter pulse-edge-ui test -- OeeTab   # PASS
pnpm test:ui                                  # all green
pnpm lint:ui                                  # zero errors
pnpm build:ui                                 # clean tsc + vite build
git add src/Pulse.Edge.UI/
git commit -m "feat(oee): OEE commissioning tab (channel CRUD, live state, outbox status)"
```

---

### Task 13: Docs, roadmap, final verification

**Files:**
- Modify: `CLAUDE.md` (repo root — architecture section)
- Modify: `docs/PULSE_Edge_Production_Readiness_Roadmap.md` (Decision and risk log)

- [ ] **Step 1: Update CLAUDE.md**

In the "Acquisition pipeline" / API-surface sections:
- In the `QueueStorageService` bullet, change "Holds queued telemetry/events, adapters, …" to "Holds queued telemetry, OEE channels + outbox, adapters, …".
- In the endpoints list, add `Oee` to the endpoint groups: `Adapter, Auth, Backup, Buffer, Dashboard, DataPoint, DataSource, DiagnosticLog, Oee, Settings`.
- Add one sentence after the acquisition-pipeline diagram: `A parallel OEE data plane (OeeStateEngine → OeeOutboxMessages → OeeSyncService → POST /edge/oee/*) reports per-machine state transitions and counters with per-channel sequence numbers — contract: know-how/cloud_oee_ingestion.md; it deliberately bypasses /edge/telemetry.`

- [ ] **Step 2: Roadmap decision-log entry**

Append to the Decision and risk log table in `docs/PULSE_Edge_Production_Readiness_Roadmap.md` (follow the existing row format, using today's date):

```
| D-<next> | 2026-07-18 | OEE ingestion implemented per know-how/cloud_oee_ingestion.md: dedicated OeeSyncService (independent of telemetry SyncService), durable OeeOutboxMessages with per-channel seq, dead legacy QueueEvents subsystem removed. OEE channels are NOT yet included in the configuration backup payload (requires a backup format-version bump) — follow-up item. | <PR link> |
```

- [ ] **Step 3: Full verification (superpowers:verification-before-completion)**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj
pnpm lint:ui && pnpm test:ui && pnpm build:ui
dotnet list Pulse.Edge.slnx package --vulnerable --include-transitive
```

Expected: all clean. Additionally, do a live smoke: `./start-edge.sh`, create a Simulator adapter (production template), add DataPoints for `running`/`fault_code`/`total_count`/`reject_count`, create an OEE channel binding them in the new OEE tab, and confirm (a) the live state badge cycles running → stopped → fault over ~5 minutes (the simulator's 300 s cycle), (b) `/api/oee/outbox` accumulates messages (no cloud connected → they buffer), (c) the Buffer tab shows them.

- [ ] **Step 4: Commit and open the PR**

```bash
git add CLAUDE.md docs/
git commit -m "docs(oee): architecture notes + roadmap decision log for OEE ingestion"
```

Then use the commit-push-pr skill / superpowers:finishing-a-development-branch to push `feature/edge-oee-ingestion` and open the PR (CI `quality.yml` must pass; `main` is protected).
