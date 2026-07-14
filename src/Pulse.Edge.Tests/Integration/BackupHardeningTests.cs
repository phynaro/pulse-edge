using System.Net;
using System.Net.Http.Json;
using System.Text;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class BackupHardeningTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Backup_export_contains_no_cloud_credentials()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => { c.ApiKey = "cloud-key-xyz"; c.ClaimSecret = "claim-xyz"; c.PairingToken = "pair-xyz"; });
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.GetAsync("/api/backups/configuration");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain("cloud-key-xyz", body);
        Assert.DoesNotContain("claim-xyz", body);
        Assert.DoesNotContain("pair-xyz", body);
    }

    [Fact]
    public async Task Oversized_restore_body_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        // 6 MB of JSON, over the 5 MB cap.
        var huge = "{\"junk\":\"" + new string('a', 6 * 1024 * 1024) + "\"}";
        var content = new StringContent(huge, Encoding.UTF8, "application/json");
        var response = await admin.PostAsync("/api/restores/configuration/apply", content);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode); // 413
    }
}
