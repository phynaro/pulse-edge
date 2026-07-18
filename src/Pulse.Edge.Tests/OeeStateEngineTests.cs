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

// Joins every other OEE-table-touching test class in the "EdgeApi" collection
// (DisableParallelization=true) — see the comment on OeeStorageServiceTests for why. This
// class's per-instance-unique DataPointIds already rule out OeeStateEngine cross-channel
// LastState corruption, but serializing it here closes off any other GLOBAL-scan race between
// it and OeeStorageServiceTests/OeeStorageSchemaTests/OeeEndToEndTests as well.
[Collection("EdgeApi")]
public class OeeStateEngineTests : IAsyncLifetime
{
    private readonly QueueStorageService _queueStorage = new();
    private readonly OeeStorageService _oee = new();
    private OeeStateEngine _engine = null!;
    private int _channelId;
    private readonly DateTime _t0 = new(2026, 7, 18, 6, 0, 0, DateTimeKind.Utc);

    // OeeStateEngine.EvaluateAsync loads and evaluates ALL enabled channels in the
    // shared DB (GetChannelsAsync is unscoped) — that's correct production behavior
    // (one poll tick, many channels), but it means any two test instances that bind
    // their channel's RunDataPointId/etc to the SAME literal string (e.g. the old
    // hardcoded "dp-run") can silently evaluate and overwrite EACH OTHER's channel's
    // LastState/LastCode whenever they run concurrently (different test classes get
    // no serialization by default). A per-instance GUID suffix makes every test's
    // DataPointIds globally unique, so no other concurrently-running engine (in this
    // class or in OeeEndToEndTests, the only other class that drives OeeStateEngine)
    // can ever match and touch this instance's channel, and vice versa.
    private readonly string _dpRun = "dp-run-" + Guid.NewGuid().ToString("N");
    private readonly string _dpFault = "dp-fault-" + Guid.NewGuid().ToString("N");
    private readonly string _dpCode = "dp-code-" + Guid.NewGuid().ToString("N");
    private readonly string _dpGood = "dp-good-" + Guid.NewGuid().ToString("N");
    private readonly string _dpReject = "dp-reject-" + Guid.NewGuid().ToString("N");

    public async Task InitializeAsync()
    {
        await _queueStorage.InitializeAsync();
        var channel = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "engine-test-" + Guid.NewGuid().ToString("N"),
            Name = "Engine Test",
            RunDataPointId = _dpRun,
            FaultDataPointId = _dpFault,
            CodeDataPointId = _dpCode,
            GoodDataPointId = _dpGood,
            RejectDataPointId = _dpReject,
            DebounceSeconds = 2,
        });
        _channelId = channel.Id;
        _engine = new OeeStateEngine(NullLogger<OeeStateEngine>.Instance, _oee);
    }

    public async Task DisposeAsync() => await _oee.DeleteChannelAsync(_channelId);

    private List<DataPoint> Signals(double run, double fault, string code, double good, double reject) =>
    [
        new() { Id = _dpRun,    LastValue = run.ToString(),    LastUpdated = DateTime.UtcNow },
        new() { Id = _dpFault,  LastValue = fault.ToString(),  LastUpdated = DateTime.UtcNow },
        new() { Id = _dpCode,   LastValue = code,              LastUpdated = DateTime.UtcNow },
        new() { Id = _dpGood,   LastValue = good.ToString(),   LastUpdated = DateTime.UtcNow },
        new() { Id = _dpReject, LastValue = reject.ToString(), LastUpdated = DateTime.UtcNow },
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
        // Deliberately its OWN unique run id (not _dpRun/_dpFault) — this channel has
        // no FaultDataPointId, but if it shared _dpRun with the class's main channel,
        // evaluating it would ALSO match and evaluate that main channel (same
        // GetChannelsAsync scan), corrupting a test that isn't even running yet.
        var noFaultRunId = "dp-run-" + Guid.NewGuid().ToString("N");
        var noFault = await _oee.CreateChannelAsync(new OeeChannel
        {
            ExternalId = "nofault-" + Guid.NewGuid().ToString("N"),
            Name = "No Fault", RunDataPointId = noFaultRunId, DebounceSeconds = 0,
        });
        try
        {
            var engine = new OeeStateEngine(NullLogger<OeeStateEngine>.Instance, _oee);
            var probe = new List<DataPoint>
            {
                new() { Id = noFaultRunId, LastValue = "0", LastUpdated = DateTime.UtcNow },
                // Fault signal present in the polled set but not bound to this channel's
                // FaultDataPointId (it has none) — must be ignored.
                new() { Id = "dp-fault-unbound-probe-" + Guid.NewGuid().ToString("N"), LastValue = "3", LastUpdated = DateTime.UtcNow },
            };
            await engine.EvaluateAsync(probe, _t0);

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
