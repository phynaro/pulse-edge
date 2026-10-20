using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class SimulatorEndpointsTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private async Task<HttpClient> AdminAsync()
    {
        await factory.ResetDatabaseAsync();
        return await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
    }

    private static string EventsFile =>
        Path.Combine(PulseEdgeAppFactory.DataDir, "simulator", "integra-dairy.events.json");

    [Fact]
    public async Task List_ContainsIntegraDairyWithIws1Signals()
    {
        var client = await AdminAsync();
        var res = await client.GetAsync("/api/simulator/scenarios");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var dairy = doc.RootElement.EnumerateArray().Single(s => s.GetProperty("id").GetString() == "integra-dairy");
        var iws1 = dairy.GetProperty("units").EnumerateArray().Single(u => u.GetProperty("id").GetString() == "iws1");
        Assert.True(iws1.GetProperty("signals").GetArrayLength() > 0);
        Assert.True(dairy.GetProperty("events").GetArrayLength() > 0);
    }

    [Fact]
    public async Task Status_Is503InSplitMode_And404ForUnknown()
    {
        // The harness runs MultiPort (no engine registered), so status is unavailable by design (ruling R8).
        var client = await AdminAsync();
        var split = await client.GetAsync("/api/simulator/scenarios/integra-dairy/status");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, split.StatusCode);
        Assert.Contains("single-port mode only", await split.Content.ReadAsStringAsync());

        var missing = await client.GetAsync("/api/simulator/scenarios/nope/status");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task PostUnknownEvent_Returns404()
    {
        var client = await AdminAsync();
        var res = await client.PostAsJsonAsync("/api/simulator/scenarios/integra-dairy/events", new { eventId = "no_such_event" });
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        var res2 = await client.PostAsJsonAsync("/api/simulator/scenarios/nope/events", new { eventId = "htst_temp_drop" });
        Assert.Equal(HttpStatusCode.NotFound, res2.StatusCode);
    }

    [Fact]
    public async Task PostAsReadOnly_Returns403()
    {
        await factory.ResetDatabaseAsync();
        var client = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);
        var res = await client.PostAsJsonAsync("/api/simulator/scenarios/integra-dairy/events", new { eventId = "htst_temp_drop" });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task PostKnownEventAsAdmin_Returns202_AndWritesEventsFile()
    {
        var client = await AdminAsync();
        var res = await client.PostAsJsonAsync("/api/simulator/scenarios/integra-dairy/events", new { eventId = "htst_temp_drop" });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        Assert.Contains("htst_temp_drop", File.ReadAllText(EventsFile));
    }
}

/// <summary>
/// The 200 status path, single-port style: a minimal app that maps the simulator endpoints with a real
/// engine registered (the EdgeApi harness runs MultiPort, where status is 503 by design).
/// </summary>
public sealed class SimulatorStatusSinglePortTests : IAsyncLifetime
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pulse-scenario-tests", Guid.NewGuid().ToString("N"));
    private Microsoft.AspNetCore.Builder.WebApplication? _app;
    private Pulse.Edge.Agent.Simulation.ScenarioEngine? _engine;

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(_dir);
        var store = new Pulse.Edge.Agent.Simulation.ScenarioStateStore(_dir);
        _engine = new Pulse.Edge.Agent.Simulation.ScenarioEngine(store);
        var builder = Microsoft.AspNetCore.Builder.WebApplication.CreateSlimBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton(store);
        builder.Services.AddSingleton(_engine);
        _app = builder.Build();
        Pulse.Edge.Api.Endpoints.SimulatorEndpoints.MapSimulatorEndpoints(_app);
        await _app.StartAsync();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null) await _app.DisposeAsync();
        _engine?.Dispose();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    [Fact]
    public async Task Status_Returns200_WithCamelCaseShape()
    {
        var now = DateTime.UtcNow;
        _engine!.Update("integra-dairy", now);
        var store = _app!.Services.GetRequiredService<Pulse.Edge.Agent.Simulation.ScenarioStateStore>();
        store.RequestEvent("integra-dairy", "htst_temp_drop", now);
        _engine.Update("integra-dairy", now.AddSeconds(2)); // drains the request: one active event

        var client = _app.GetTestClient();
        var res = await client.GetAsync("/api/simulator/scenarios/integra-dairy/status");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var units = doc.RootElement.GetProperty("units");
        Assert.True(units.GetArrayLength() > 100);
        foreach (var u in units.EnumerateArray())
        {
            Assert.Equal(JsonValueKind.String, u.GetProperty("id").ValueKind);
            Assert.Equal(JsonValueKind.String, u.GetProperty("kind").ValueKind);
            Assert.Equal(JsonValueKind.String, u.GetProperty("mode").ValueKind);
            Assert.True(u.TryGetProperty("value", out _));
        }
        var meter = units.EnumerateArray().Single(u => u.GetProperty("id").GetString() == "m_main");
        Assert.Equal("meter", meter.GetProperty("kind").GetString());
        Assert.Equal(JsonValueKind.Number, meter.GetProperty("value").ValueKind);
        var machine = units.EnumerateArray().Single(u => u.GetProperty("id").GetString() == "iws1");
        Assert.Equal(JsonValueKind.Null, machine.GetProperty("value").ValueKind);

        var active = doc.RootElement.GetProperty("activeEvents").EnumerateArray()
            .Single(e => e.GetProperty("id").GetString() == "htst_temp_drop");
        Assert.True(active.GetProperty("untilUtc").TryGetDateTime(out var until));
        Assert.True(until > now, $"until={until:O}");
    }
}
