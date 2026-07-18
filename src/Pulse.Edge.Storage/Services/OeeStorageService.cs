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
