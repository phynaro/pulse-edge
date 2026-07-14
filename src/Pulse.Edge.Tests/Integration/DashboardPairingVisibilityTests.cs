using System.Net.Http.Json;
using System.Text.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class DashboardPairingVisibilityTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private static async Task<string> PairingTokenAsync(HttpClient client)
    {
        // The API serializes with the default ASP.NET Core Minimal API web JSON options,
        // which camelCase property names (confirmed against the actual wire response;
        // the UI also reads `device.pairingToken` — see OnboardingWizard.tsx).
        var json = await client.GetFromJsonAsync<JsonElement>("/api/dashboard");
        return json.GetProperty("device").GetProperty("pairingToken").GetString() ?? "";
    }

    [Fact]
    public async Task Admin_sees_the_pairing_token()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => c.PairingToken = TestCredentials.SamplePairingToken);
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        Assert.Equal(TestCredentials.SamplePairingToken, await PairingTokenAsync(admin));
    }

    [Fact]
    public async Task ReadOnly_does_not_see_the_pairing_token()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => c.PairingToken = TestCredentials.SamplePairingToken);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var readOnly = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);

        Assert.Equal("", await PairingTokenAsync(readOnly));
    }
}
