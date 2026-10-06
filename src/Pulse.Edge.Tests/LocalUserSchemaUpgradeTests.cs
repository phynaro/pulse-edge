using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public sealed class LocalUserSchemaUpgradeTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"pulse-users-upgrade-{Guid.NewGuid():N}.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_dbPath);
    }

    [Fact]
    public async Task Legacy_users_table_gains_columns_and_every_user_gets_a_stamp()
    {
        await using (var db = new QueueDbContext(_dbPath))
        {
            // The pre-recovery LocalUsers shape, exactly as older devices have it.
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE LocalUsers (
                    Id TEXT PRIMARY KEY, Username TEXT NOT NULL, NormalizedUsername TEXT NOT NULL UNIQUE,
                    PasswordHash TEXT NOT NULL, Role TEXT NOT NULL, IsEnabled INTEGER NOT NULL DEFAULT 1,
                    FailedLoginCount INTEGER NOT NULL DEFAULT 0, LockoutEndUtc TEXT,
                    CreatedAtUtc TEXT NOT NULL, UpdatedAtUtc TEXT NOT NULL, LastLoginAtUtc TEXT);
                INSERT INTO LocalUsers (Id, Username, NormalizedUsername, PasswordHash, Role, CreatedAtUtc, UpdatedAtUtc)
                VALUES ('u1', 'alice', 'ALICE', 'x', 'Admin', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
                INSERT INTO LocalUsers (Id, Username, NormalizedUsername, PasswordHash, Role, CreatedAtUtc, UpdatedAtUtc)
                VALUES ('u2', 'bob', 'BOB', 'x', 'ReadOnly', '2026-01-01 00:00:00', '2026-01-01 00:00:00');");

            await QueueStorageService.UpgradeLocalUsersSchemaAsync(db);
            await QueueStorageService.UpgradeLocalUsersSchemaAsync(db); // idempotent
        }

        await using var check = new QueueDbContext(_dbPath);
        var users = await check.LocalUsers.AsNoTracking().OrderBy(x => x.Id).ToListAsync();
        Assert.Equal(2, users.Count);
        Assert.All(users, u =>
        {
            Assert.Equal(32, u.SecurityStamp.Length);
            Assert.Equal("", u.RecoveryCodeHash);
            Assert.Null(u.RecoveryCodeCreatedAtUtc);
        });
        Assert.NotEqual(users[0].SecurityStamp, users[1].SecurityStamp);
    }
}
