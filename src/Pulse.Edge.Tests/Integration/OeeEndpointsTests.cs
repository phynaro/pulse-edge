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
