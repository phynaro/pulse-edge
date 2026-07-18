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
