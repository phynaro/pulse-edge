using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

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
