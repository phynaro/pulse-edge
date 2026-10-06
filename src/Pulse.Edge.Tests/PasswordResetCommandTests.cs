using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Tests.Integration;
using Xunit;

namespace Pulse.Edge.Tests;

public sealed class PasswordResetCommandTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"pulse-reset-cmd-{Guid.NewGuid():N}.db");
    private readonly StringWriter _out = new();
    private const string OldStamp = "old-stamp";

    public PasswordResetCommandTests()
    {
        using var db = OpenDb();
        db.Database.EnsureCreated();
        db.LocalUsers.Add(new LocalUser
        {
            Username = TestCredentials.AdminUsername, NormalizedUsername = TestCredentials.AdminUsername.ToUpperInvariant(),
            PasswordHash = new PasswordService().Hash(TestCredentials.Password), Role = "Admin",
            IsEnabled = false, FailedLoginCount = 5, LockoutEndUtc = DateTime.UtcNow.AddMinutes(15), SecurityStamp = OldStamp,
        });
        db.SaveChanges();
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_dbPath);
    }

    private QueueDbContext OpenDb() => new(_dbPath);

    // args = the CLI arguments; secrets = the answers fed, in order, to each password prompt.
    private Task<int> RunAsync(bool interactive, string[] args, params string[] secrets)
    {
        var answers = new Queue<string>(secrets);
        var io = new CommandIo(_out, _ => answers.Count > 0 ? answers.Dequeue() : null, interactive, "tester");
        return PasswordResetCommand.RunAsync(args, io, OpenDb, () => Task.CompletedTask);
    }

    private async Task<LocalUser> LoadAdminAsync()
    {
        await using var db = OpenDb();
        return await db.LocalUsers.AsNoTracking().SingleAsync();
    }

    [Fact]
    public async Task List_prints_users_without_secrets()
    {
        var exit = await RunAsync(false, ["--list"]);

        Assert.Equal(0, exit);
        Assert.Contains(TestCredentials.AdminUsername, _out.ToString());
        Assert.Contains("Admin", _out.ToString());
        Assert.DoesNotContain("pbkdf2", _out.ToString());
    }

    [Fact]
    public async Task Piped_reset_sets_password_unlocks_enables_rotates_stamp_and_audits()
    {
        var exit = await RunAsync(false, ["--user", TestCredentials.AdminUsername], TestCredentials.StrongPassword, TestCredentials.StrongPassword);

        Assert.Equal(0, exit);
        var user = await LoadAdminAsync();
        Assert.True(new PasswordService().Verify(TestCredentials.StrongPassword, user.PasswordHash));
        Assert.True(user.IsEnabled);
        Assert.Equal(0, user.FailedLoginCount);
        Assert.Null(user.LockoutEndUtc);
        Assert.NotEqual(OldStamp, user.SecurityStamp);
        await using var db = OpenDb();
        var audit = await db.AuditEvents.AsNoTracking().SingleAsync();
        Assert.Equal("PasswordResetConsole", audit.EventType);
        Assert.Equal("console:tester", audit.ActorUsername);
        Assert.Equal("local-console", audit.RemoteIp);
    }

    [Fact]
    public async Task Username_lookup_is_case_insensitive()
    {
        var exit = await RunAsync(false, ["--user", TestCredentials.AdminUsername.ToUpperInvariant()], TestCredentials.StrongPassword, TestCredentials.StrongPassword);
        Assert.Equal(0, exit);
    }

    [Fact]
    public async Task Unknown_user_exits_2()
    {
        Assert.Equal(2, await RunAsync(false, ["--user", TestCredentials.NonexistentUsername]));
    }

    [Fact]
    public async Task Piped_mismatch_exits_3_without_reprompting_and_changes_nothing()
    {
        var exit = await RunAsync(false, ["--user", TestCredentials.AdminUsername], TestCredentials.StrongPassword, TestCredentials.StrongPassword + "x", TestCredentials.StrongPassword, TestCredentials.StrongPassword);

        Assert.Equal(3, exit);
        Assert.Equal(OldStamp, (await LoadAdminAsync()).SecurityStamp);
    }

    [Fact]
    public async Task Interactive_reprompts_after_a_weak_password()
    {
        var exit = await RunAsync(true, ["--user", TestCredentials.AdminUsername], "short", "short", TestCredentials.StrongPassword, TestCredentials.StrongPassword);

        Assert.Equal(0, exit);
        Assert.Contains("at least 10 characters", _out.ToString());
    }

    [Fact]
    public async Task Interactive_gives_up_after_three_failed_attempts()
    {
        var exit = await RunAsync(true, ["--user", TestCredentials.AdminUsername], "short", "short", "short", "short", "short", "short");
        Assert.Equal(3, exit);
    }

    [Fact]
    public async Task Bad_arguments_print_usage_and_exit_1()
    {
        Assert.Equal(1, await RunAsync(false, ["--bogus"]));
        Assert.Contains("reset-password --user <username>", _out.ToString());
    }
}
