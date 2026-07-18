using System;
using System.Collections.Generic;
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
    public async Task Enqueue_ConcurrentCalls_AssignUniqueGaplessSeqs()
    {
        var concurrent = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "concurrent-" + Guid.NewGuid().ToString("N"),
            Name = "Concurrent", RunDataPointId = "dp-run",
        });
        try
        {
            const int callCount = 10;
            var tasks = new List<Task<long?>>();
            for (int i = 0; i < callCount; i++)
            {
                tasks.Add(_oee.EnqueueMessageAsync(
                    concurrent.Id, "sync", DateTime.UtcNow, "running", null, i, 0));
            }
            var results = await Task.WhenAll(tasks);

            Assert.All(results, r => Assert.NotNull(r));
            var seqs = results.Select(r => r!.Value).OrderBy(s => s).ToList();
            Assert.Equal(Enumerable.Range(0, callCount).Select(i => (long)i).ToList(), seqs);

            using var db = new QueueDbContext();
            Assert.Equal(callCount, await db.OeeOutboxMessages.CountAsync(m => m.ChannelId == concurrent.Id));
        }
        finally
        {
            await _oee.DeleteChannelAsync(concurrent.Id);
        }
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
