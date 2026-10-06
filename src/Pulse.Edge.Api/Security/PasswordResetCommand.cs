using System.Text;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Api.Security;

// Console I/O seam so the command is testable without a real terminal.
public sealed record CommandIo(TextWriter Out, Func<string, string?> ReadSecret, bool Interactive, string OsUser)
{
    public static CommandIo FromSystemConsole() => new(
        Console.Out,
        prompt =>
        {
            Console.Write(prompt);
            return Console.IsInputRedirected ? Console.ReadLine() : ReadMasked();
        },
        !Console.IsInputRedirected,
        Environment.UserName);

    // Reads a line without echoing it, printing '*' per character (Backspace supported).
    private static string ReadMasked()
    {
        var input = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return input.ToString(); }
            if (key.Key == ConsoleKey.Backspace)
            {
                if (input.Length > 0) { input.Length--; Console.Write("\b \b"); }
                continue;
            }
            if (!char.IsControl(key.KeyChar)) { input.Append(key.KeyChar); Console.Write('*'); }
        }
    }
}

// Local console password reset — spec 2026-10-06-edge-password-recovery-design §6. Anyone who can run
// the executable against the data directory may reset any user (accepted risk, Security Exception
// Register R-012). Deliberately not advertised in the UI.
public static class PasswordResetCommand
{
    private const string Usage = "Usage:\n  reset-password --list\n  reset-password --user <username>";

    public static async Task<int> RunAsync(string[] args, CommandIo io, Func<QueueDbContext> openDb, Func<Task> initialize)
    {
        try
        {
            await initialize();
            return args switch
            {
                ["--list"] => await ListAsync(io, openDb),
                ["--user", var username] => await ResetAsync(username, io, openDb),
                _ => PrintUsage(io),
            };
        }
        catch (Exception ex)
        {
            io.Out.WriteLine($"Cannot access the PULSE Edge database: {ex.Message}");
            return 1;
        }
    }

    private static int PrintUsage(CommandIo io)
    {
        io.Out.WriteLine(Usage);
        return 1;
    }

    private static async Task<int> ListAsync(CommandIo io, Func<QueueDbContext> openDb)
    {
        await using var db = openDb();
        var users = await db.LocalUsers.AsNoTracking().OrderBy(x => x.Username).ToListAsync();
        if (users.Count == 0)
        {
            io.Out.WriteLine("No users exist yet. Complete setup in the web UI.");
            return 0;
        }
        foreach (var u in users)
        {
            var locked = u.LockoutEndUtc > DateTime.UtcNow ? "locked" : "";
            io.Out.WriteLine($"{u.Username,-24} {u.Role,-9} {(u.IsEnabled ? "enabled" : "disabled"),-9} {locked}");
        }
        return 0;
    }

    private static async Task<int> ResetAsync(string username, CommandIo io, Func<QueueDbContext> openDb)
    {
        await using var db = openDb();
        var normalized = username.Trim().ToUpperInvariant();
        var user = await db.LocalUsers.FirstOrDefaultAsync(x => x.NormalizedUsername == normalized);
        if (user == null)
        {
            io.Out.WriteLine($"No user named '{username}'. Run 'reset-password --list' to see users.");
            return 2;
        }

        // Piped input gets exactly one try: re-prompting would consume lines meant for nothing.
        var attempts = io.Interactive ? 3 : 1;
        string? password = null;
        for (var i = 0; i < attempts && password == null; i++)
        {
            var first = io.ReadSecret("New password: ") ?? "";
            var confirm = io.ReadSecret("Confirm:      ") ?? "";
            if (first != confirm) { io.Out.WriteLine("Passwords do not match."); continue; }
            if (PasswordService.Validate(first) is { } error) { io.Out.WriteLine(error); continue; }
            password = first;
        }
        if (password == null) return 3;

        user.PasswordHash = new PasswordService().Hash(password);
        user.SecurityStamp = LocalUser.NewSecurityStamp();
        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        user.IsEnabled = true;
        user.UpdatedAtUtc = DateTime.UtcNow;
        db.AuditEvents.Add(new AuditEvent
        {
            EventType = "PasswordResetConsole", ActorUsername = $"console:{io.OsUser}", Target = user.Username,
            RemoteIp = "local-console", Succeeded = true,
        });
        await db.SaveChangesAsync();
        io.Out.WriteLine($"Password for '{user.Username}' updated. Account unlocked. Existing sessions signed out.");
        return 0;
    }
}
