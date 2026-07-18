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

    // When reusing a pre-existing DeviceConfig row (e.g. one left behind by real,
    // manual pairing against the actual PULSE Cloud during local dev), remember its
    // original CloudEndpoint/ApiKey/IsSyncEnabled so DisposeAsync can restore them.
    // Without this, RunOnceAsync would target that real endpoint (e.g.
    // "https://pulse.trazor.cloud/api") instead of our FakeCloudHandler's assumed
    // bare paths ("/edge/oee/..."), and would permanently flip a real device's
    // IsSyncEnabled — neither of which this test should do.
    private bool _restoreExistingConfig;
    private string? _originalCloudEndpoint;
    private string? _originalApiKey;
    private bool _originalIsSyncEnabled;

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
            _deviceConfigId = ""; // pre-existing config — leave its identity alone, just ensure usable
            _restoreExistingConfig = true;
            _originalCloudEndpoint = existing.CloudEndpoint;
            _originalApiKey = existing.ApiKey;
            _originalIsSyncEnabled = existing.IsSyncEnabled;

            existing.ApiKey = string.IsNullOrEmpty(existing.ApiKey) ? "e2e-test-key" : existing.ApiKey;
            existing.IsSyncEnabled = true;
            // Force the loopback endpoint our FakeCloudHandler assumes bare "/edge/oee/..."
            // paths for — a real leftover CloudEndpoint (e.g. with a path prefix like
            // "https://pulse.trazor.cloud/api") would otherwise silently redirect every
            // request to a different AbsolutePath than what the tests assert on.
            existing.CloudEndpoint = "http://localhost:3000";
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
        else if (_restoreExistingConfig)
        {
            using var db = new QueueDbContext();
            var existing = await db.DeviceConfigs.FirstOrDefaultAsync();
            if (existing != null)
            {
                existing.CloudEndpoint = _originalCloudEndpoint ?? existing.CloudEndpoint;
                existing.ApiKey = _originalApiKey ?? existing.ApiKey;
                existing.IsSyncEnabled = _originalIsSyncEnabled;
                await db.SaveChangesAsync();
            }
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
