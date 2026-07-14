using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Security;

namespace Pulse.Edge.Api.Security;

public static class CloudCredentialMigration
{
    // Re-writes legacy plaintext cloud creds as ciphertext. Idempotent: does nothing once all
    // three raw fields are already empty-or-protected. `dbPath` null => the default path.
    //
    // ApiKey alone isn't a reliable gate: a pre-upgrade device mid-pairing
    // (CloudStatus == "PendingApproval") has an empty ApiKey but real plaintext
    // ClaimSecret/PairingToken — CloudProvisioningService generates those two before the
    // cloud ever issues an ApiKey. So migrate whenever ANY of the three raw stored fields
    // is non-empty and not yet protected.
    public static async Task MigrateAsync(string? dbPath = null)
    {
        await using var db = dbPath is null ? new QueueDbContext() : new QueueDbContext(dbPath);
        await db.Database.EnsureCreatedAsync();

        var raw = (await db.Database
            .SqlQueryRaw<RawCloudCreds>(
                "SELECT ApiKey, ClaimSecret, PairingToken FROM DeviceConfigs LIMIT 1")
            .ToListAsync()).FirstOrDefault();

        // No row, or all three fields are empty-or-already-protected → nothing to do.
        if (raw is null || (IsEmptyOrProtected(raw.ApiKey)
            && IsEmptyOrProtected(raw.ClaimSecret)
            && IsEmptyOrProtected(raw.PairingToken)))
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

    private static bool IsEmptyOrProtected(string value) =>
        string.IsNullOrEmpty(value) || SecretProtection.Protector.IsProtected(value);

    private sealed class RawCloudCreds
    {
        public string ApiKey { get; set; } = string.Empty;
        public string ClaimSecret { get; set; } = string.Empty;
        public string PairingToken { get; set; } = string.Empty;
    }
}
