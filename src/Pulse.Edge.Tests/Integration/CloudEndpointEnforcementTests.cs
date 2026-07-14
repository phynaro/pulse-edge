using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class CloudEndpointEnforcementTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Saving_an_http_cloud_endpoint_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.PostAsJsonAsync("/api/settings",
            new { SerialNumber = "SN-1", CloudEndpoint = "http://cloud.example.com" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Saving_an_https_cloud_endpoint_is_accepted()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.PostAsJsonAsync("/api/settings",
            new { SerialNumber = "SN-1", CloudEndpoint = "https://cloud.example.com" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
