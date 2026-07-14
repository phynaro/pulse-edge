using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Security;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class CloudCredentialEncryptionTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task ApiKey_is_ciphertext_in_the_db_but_plaintext_via_ef()
    {
        await factory.ResetDatabaseAsync();
        // Build the host so Program.cs sets SecretProtection.Protector (DataProtection) before we write.
        _ = factory.CreateClient();
        await factory.SeedDeviceConfigAsync(c => c.ApiKey = "plaintext-cloud-key-123");

        var dbPath = Path.Combine(PulseEdgeAppFactory.DataDir, "edge.db");

        // Raw column value bypasses the EF converter — must NOT be the plaintext, and must be
        // recognizable ciphertext to the configured protector.
        await using (var raw = new QueueDbContext(dbPath))
        {
            var storedApiKey = (await raw.Database
                .SqlQueryRaw<string>("SELECT ApiKey AS Value FROM DeviceConfigs LIMIT 1")
                .ToListAsync()).Single();
            Assert.NotEqual("plaintext-cloud-key-123", storedApiKey);
            Assert.True(SecretProtection.Protector.IsProtected(storedApiKey));
        }

        // EF read applies the converter — caller sees plaintext.
        await using (var ef = new QueueDbContext(dbPath))
        {
            var config = await ef.DeviceConfigs.AsNoTracking().FirstAsync();
            Assert.Equal("plaintext-cloud-key-123", config.ApiKey);
        }
    }
}
