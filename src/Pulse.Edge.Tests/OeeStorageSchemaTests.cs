using System;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

// This class asserts on the IsSending flag of specific outbox rows after a reset sweep —
// exactly the kind of assertion that OeeStorageServiceTests.GetPendingBatchAsync's GLOBAL
// (unscoped-by-channel) scan can silently invalidate if both run concurrently. See the
// [Collection("EdgeApi")] comment on OeeStorageServiceTests for the full explanation; sharing
// that collection here serializes this class against every other OEE-table-touching test class.
[Collection("EdgeApi")]
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
            // Calling InitializeAsync() again would no longer re-trigger this sweep — it's
            // guarded to run at most once per process now, so the ~150 other test classes that
            // each call InitializeAsync() from their own setup don't repeatedly clobber sibling
            // tests' legitimately-in-flight rows (see QueueStorageService.InitializeCoreAsync).
            // Call the sweep directly to simulate "the device restarted."
            await service.ResetSendingStatusAsync(); // simulated restart's crash-recovery sweep

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
