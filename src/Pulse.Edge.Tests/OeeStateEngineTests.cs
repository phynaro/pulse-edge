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
