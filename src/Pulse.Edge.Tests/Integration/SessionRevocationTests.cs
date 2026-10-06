using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class SessionRevocationTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private static async Task<string> IdOfAsync(string username)
    {
        await using var db = new QueueDbContext();
        return (await db.LocalUsers.AsNoTracking().SingleAsync(x => x.Username == username)).Id;
    }

    [Fact]
    public async Task Admin_password_reset_signs_out_the_targets_existing_sessions()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var target = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);
        Assert.Equal(HttpStatusCode.OK, (await target.GetAsync("/api/auth/me")).StatusCode);

        var reset = await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.ReadOnlyUsername)}",
            new { Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await target.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Disabling_a_user_signs_out_their_sessions()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var target = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);

        await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.ReadOnlyUsername)}", new { IsEnabled = false });

        Assert.Equal(HttpStatusCode.Unauthorized, (await target.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Admin_changing_their_own_password_stays_signed_in()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var change = await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.AdminUsername)}",
            new { Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Demoting_an_admin_clears_their_recovery_code()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.SecondAdminUsername, TestCredentials.Password);
        var codes = new RecoveryCodeService(new PasswordService());
        await using (var db = new QueueDbContext())
        {
            var second = await db.LocalUsers.SingleAsync(x => x.Username == TestCredentials.SecondAdminUsername);
            second.RecoveryCodeHash = codes.Hash(codes.Generate());
            second.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.SecondAdminUsername)}", new { Role = "ReadOnly" });

        await using var check = new QueueDbContext();
        var demoted = await check.LocalUsers.AsNoTracking().SingleAsync(x => x.Username == TestCredentials.SecondAdminUsername);
        Assert.Equal("", demoted.RecoveryCodeHash);
        Assert.Null(demoted.RecoveryCodeCreatedAtUtc);
    }
}
