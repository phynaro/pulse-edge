using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Security;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class CloudCredentialMigrationTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Startup_migration_encrypts_legacy_plaintext_cloud_creds()
    {
        await factory.ResetDatabaseAsync();
        _ = factory.CreateClient(); // ensure the protector is configured

        var dbPath = Path.Combine(PulseEdgeAppFactory.DataDir, "edge.db");

        // Simulate a pre-2C row: write plaintext DIRECTLY into the column, bypassing the converter.
        await using (var db = new QueueDbContext(dbPath))
        {
            await db.Database.EnsureCreatedAsync();
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO DeviceConfigs (Id, ClaimSecret, PairingToken, ApiKey, CloudEndpoint, Version, IsSyncEnabled, CloudStatus, PairingShortCode, PairingBaseUrl, SerialNumber, OrganizationId, OrganizationName, SiteId, SiteName, CloudEdgeId) " +
                "VALUES ('dev-1', 'legacy-secret', 'legacy-token', 'legacy-key', 'https://cloud', '1.0.0', 1, 'Connected', '', '', 'SN', '', '', '', '', '')");
        }

        // The migration helper (created in Step 3) — same code the app runs at startup.
        await CloudCredentialMigration.MigrateAsync(dbPath);

        await using (var raw = new QueueDbContext(dbPath))
        {
            var storedKey = (await raw.Database.SqlQueryRaw<string>("SELECT ApiKey AS Value FROM DeviceConfigs LIMIT 1").ToListAsync()).Single();
            Assert.NotEqual("legacy-key", storedKey);
            Assert.True(SecretProtection.Protector.IsProtected(storedKey));
        }
        await using (var ef = new QueueDbContext(dbPath))
        {
            var config = await ef.DeviceConfigs.AsNoTracking().FirstAsync();
            Assert.Equal("legacy-key", config.ApiKey);
            Assert.Equal("legacy-secret", config.ClaimSecret);
            Assert.Equal("legacy-token", config.PairingToken);
        }
    }
}
