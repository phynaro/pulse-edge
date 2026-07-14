using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Security;

namespace Pulse.Edge.Api.Security;

public static class CloudCredentialMigration
{
    // Re-writes legacy plaintext cloud creds as ciphertext. Idempotent: does nothing once the
    // stored ApiKey is already protected. `dbPath` null => the default path.
    public static async Task MigrateAsync(string? dbPath = null)
    {
        await using var db = dbPath is null ? new QueueDbContext() : new QueueDbContext(dbPath);
        await db.Database.EnsureCreatedAsync();

        var rawApiKey = (await db.Database
            .SqlQueryRaw<string>("SELECT ApiKey AS Value FROM DeviceConfigs LIMIT 1")
            .ToListAsync()).FirstOrDefault();

        // No row, empty, or already protected → nothing to do.
        if (string.IsNullOrEmpty(rawApiKey) || SecretProtection.Protector.IsProtected(rawApiKey))
            return;

        var config = await db.DeviceConfigs.FirstOrDefaultAsync();
        if (config is null) return;

        // Reading applied the converter (legacy passthrough → plaintext in memory). Force the
        // three fields to be written so the converter re-writes them encrypted.
        db.Entry(config).Property(x => x.ApiKey).IsModified = true;
        db.Entry(config).Property(x => x.ClaimSecret).IsModified = true;
        db.Entry(config).Property(x => x.PairingToken).IsModified = true;
        await db.SaveChangesAsync();
    }
}
