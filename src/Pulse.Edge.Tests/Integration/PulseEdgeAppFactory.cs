using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Tests.Integration;

public class PulseEdgeAppFactory : WebApplicationFactory<Program>
{
    // ONE fixed data directory for the whole integration run. The endpoints use
    // `new QueueDbContext()` (not DI), so DB isolation rides the process-global
    // PULSE_EDGE_DATA_DIR. A single fixed value (set once, never cleared) avoids
    // cross-factory contamination even when several factory instances exist. Integration
    // tests are serialized (EdgeApiCollection) and reset the DB per test.
    public static readonly string DataDir =
        Path.Combine(Path.GetTempPath(), "pulse-edge-itests");

    private static string DbPath => Path.Combine(DataDir, "edge.db");

    static PulseEdgeAppFactory()
    {
        Directory.CreateDirectory(DataDir);
        Environment.SetEnvironmentVariable("PULSE_EDGE_DATA_DIR", DataDir);
    }

    // Effectively disables login throttling for functional tests. ThrottledAppFactory
    // (Task 5) lowers this to exercise B-05. Each factory instance has its own in-memory
    // rate-limiter state, so a throttled instance never affects the functional ones.
    protected virtual int LoginPermitLimit => 1000;

    public PulseEdgeAppFactory()
    {
        // Forced-Secure cookies require the request to look like HTTPS. TestServer marks the
        // request scheme from the client's base address URI — no real TLS is involved. Setting
        // ClientOptions.BaseAddress here (rather than hiding CreateClient with `new`) is the
        // idiomatic WebApplicationFactory approach: CreateClient() and CreateDefaultClient()
        // both read from ClientOptions, so every call site gets the https:// base automatically
        // without needing a base-typed reference to accidentally bypass an override.
        ClientOptions.BaseAddress = new Uri("https://localhost");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Run as Production so the integration tests simulate a real HTTPS deployment: the
        // session cookie is forced Secure (matching the https:// client base address), which is
        // what the Secure-cookie test asserts. In Development the app intentionally does not mark
        // the cookie Secure (dev browser is on plaintext http://localhost:8080).
        builder.UseEnvironment("Production");
        // MultiPort registers the endpoints but NOT the background services
        // (Worker, provisioning, config monitor), so tests don't spin up acquisition.
        builder.UseSetting("hostingMode", "MultiPort");
        builder.UseSetting("RateLimiting:Login:PermitLimit", LoginPermitLimit.ToString());
    }

    public async Task ResetDatabaseAsync()
    {
        await using var db = new QueueDbContext(DbPath);
        await db.Database.EnsureCreatedAsync();
        // Clear only the tables the Slice 2A tests touch. Table names are fixed
        // internal constants (not user input), so building the statement with
        // string.Concat rather than an interpolated string sidesteps EF1002's
        // (correct, in general) interpolated-SQL warning without needing a
        // suppression — SQL parameters can't stand in for identifiers like table
        // names anyway.
        foreach (var table in new[] { "LocalUsers", "DeviceConfigs", "AuditEvents" })
        {
            await db.Database.ExecuteSqlRawAsync(string.Concat("DELETE FROM ", table, ";"));
        }
    }

    public async Task SeedDeviceConfigAsync(Action<DeviceConfig> configure)
    {
        await using var db = new QueueDbContext(DbPath);
        await db.Database.EnsureCreatedAsync();
        var config = new DeviceConfig { Id = Guid.NewGuid().ToString(), CloudStatus = "Connected" };
        configure(config);
        db.DeviceConfigs.Add(config);
        await db.SaveChangesAsync();
    }

    public async Task<HttpClient> CreateClientLoggedInAsync(string role, string username, string password)
    {
        await using (var db = new QueueDbContext(DbPath))
        {
            await db.Database.EnsureCreatedAsync();
            var passwords = new PasswordService();
            db.LocalUsers.Add(new LocalUser
            {
                Id = Guid.NewGuid().ToString(),
                Username = username,
                NormalizedUsername = username.ToUpperInvariant(),
                PasswordHash = passwords.Hash(password),
                Role = role,
                IsEnabled = true,
            });
            await db.SaveChangesAsync();
        }

        var client = CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login",
            new { Username = username, Password = password });
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Login failed for seeded {role} user: {(int)response.StatusCode}");
        }
        return client;
    }
}

[CollectionDefinition("EdgeApi", DisableParallelization = true)]
public sealed class EdgeApiCollection { }
