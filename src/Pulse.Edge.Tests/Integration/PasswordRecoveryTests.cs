using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class PasswordRecoveryTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private static readonly RecoveryCodeService Codes = new(new PasswordService());
    private const string GenericError = "Invalid username or recovery code.";

    private static async Task<string> GiveRecoveryCodeAsync(string username)
    {
        var code = Codes.Generate();
        await using var db = new QueueDbContext();
        var user = await db.LocalUsers.SingleAsync(x => x.Username == username);
        user.RecoveryCodeHash = Codes.Hash(code);
        user.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return code;
    }

    private static object Recover(string username, string code, string newPassword) =>
        new { Username = username, RecoveryCode = code, NewPassword = newPassword };

    private static async Task<string> ReadStringAsync(HttpResponseMessage response, string property) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty(property).GetString()!;

    [Fact]
    public async Task Valid_code_resets_password_issues_a_new_code_and_ends_old_sessions()
    {
        await factory.ResetDatabaseAsync();
        var oldSession = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var code = await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);
        var anonymous = factory.CreateClient();

        var response = await anonymous.PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code.Replace("-", "").ToLowerInvariant(), TestCredentials.StrongPassword));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var newCode = await ReadStringAsync(response, "recoveryCode");
        Assert.NotEqual(code, newCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await oldSession.GetAsync("/api/auth/me")).StatusCode);
        var login = await factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        // Single use: the consumed code no longer works, the new one does.
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, newCode, TestCredentials.StrongPassword))).StatusCode);
    }

    [Fact]
    public async Task Wrong_code_unknown_user_readonly_and_disabled_all_get_the_same_401()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.SecondAdminUsername, TestCredentials.Password);
        _ = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);
        await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);
        var readOnlyCode = await GiveRecoveryCodeAsync(TestCredentials.ReadOnlyUsername);
        var disabledCode = await GiveRecoveryCodeAsync(TestCredentials.SecondAdminUsername);
        await using (var db = new QueueDbContext())
        {
            (await db.LocalUsers.SingleAsync(x => x.Username == TestCredentials.SecondAdminUsername)).IsEnabled = false;
            await db.SaveChangesAsync();
        }
        var anonymous = factory.CreateClient();

        var attempts = new[]
        {
            Recover(TestCredentials.AdminUsername, Codes.Generate(), TestCredentials.StrongPassword),
            Recover(TestCredentials.NonexistentUsername, Codes.Generate(), TestCredentials.StrongPassword),
            Recover(TestCredentials.ReadOnlyUsername, readOnlyCode, TestCredentials.StrongPassword),
            Recover(TestCredentials.SecondAdminUsername, disabledCode, TestCredentials.StrongPassword),
        };
        foreach (var body in attempts)
        {
            var response = await anonymous.PostAsJsonAsync("/api/auth/recover", body);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal(GenericError, await ReadStringAsync(response, "error"));
        }
    }

    [Fact]
    public async Task Recovery_works_while_locked_out_and_clears_the_lockout()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var code = await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);
        await using (var db = new QueueDbContext())
        {
            var user = await db.LocalUsers.SingleAsync(x => x.Username == TestCredentials.AdminUsername);
            user.FailedLoginCount = 5;
            user.LockoutEndUtc = DateTime.UtcNow.AddMinutes(15);
            await db.SaveChangesAsync();
        }

        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var login = await factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Weak_new_password_is_rejected_with_400()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var code = await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);

        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, "short"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Recover_is_reachable_after_device_is_paired()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => c.ApiKey = TestCredentials.SamplePairingToken);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, Codes.Generate(), TestCredentials.StrongPassword));

        // A middleware rejection is a bare 401; reaching the handler yields the generic error body.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(GenericError, await ReadStringAsync(response, "error"));
    }

    [Fact]
    public async Task Regenerate_requires_current_password_and_the_new_code_works()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var wrong = await admin.PostAsJsonAsync("/api/auth/recovery-code", new { CurrentPassword = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Equal("Current password is incorrect.", await ReadStringAsync(wrong, "error"));

        var ok = await admin.PostAsJsonAsync("/api/auth/recovery-code", new { CurrentPassword = TestCredentials.Password });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var code = await ReadStringAsync(ok, "recoveryCode");

        var me = JsonDocument.Parse(await (await admin.GetAsync("/api/auth/me")).Content.ReadAsStringAsync()).RootElement;
        Assert.True(me.GetProperty("hasRecoveryCode").GetBoolean());

        var recover = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword));
        Assert.Equal(HttpStatusCode.OK, recover.StatusCode);
    }

    [Fact]
    public async Task First_admin_response_includes_a_working_recovery_code()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        var created = await client.PostAsJsonAsync("/api/auth/first-admin",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var code = await ReadStringAsync(created, "recoveryCode");

        var recover = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword));
        Assert.Equal(HttpStatusCode.OK, recover.StatusCode);
    }

    [Fact]
    public async Task Me_reports_no_recovery_code_for_an_admin_without_one()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var me = JsonDocument.Parse(await (await admin.GetAsync("/api/auth/me")).Content.ReadAsStringAsync()).RootElement;

        Assert.False(me.GetProperty("hasRecoveryCode").GetBoolean());
        Assert.Equal("Admin", me.GetProperty("role").GetString());
    }
}

// Own factory instance so the low limit never throttles the functional tests above.
public sealed class ThrottledRecoverAppFactory : PulseEdgeAppFactory
{
    protected override int LoginPermitLimit => 5;
}

[Collection("EdgeApi")]
public sealed class RecoverThrottleTests(ThrottledRecoverAppFactory factory) : IClassFixture<ThrottledRecoverAppFactory>
{
    [Fact]
    public async Task Repeated_recover_attempts_are_throttled_with_429()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();
        var codes = new RecoveryCodeService(new PasswordService());

        HttpStatusCode last = HttpStatusCode.OK;
        for (var i = 0; i < 6; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/recover", new
            {
                Username = TestCredentials.NonexistentUsername,
                RecoveryCode = codes.Generate(),
                NewPassword = TestCredentials.StrongPassword,
            });
            last = response.StatusCode;
        }

        Assert.Equal((HttpStatusCode)429, last);
    }
}
