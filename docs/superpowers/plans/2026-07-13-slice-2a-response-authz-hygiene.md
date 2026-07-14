# Slice 2A — Response & Authorization Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four in-process security-hardening items of Phase 2 Slice 2A — explicit authorization guards (B-02), least-privilege dashboard responses (B-01), security headers + configurable CORS (B-04), and IP-based login throttling (B-05) — each covered by an automated test.

**Architecture:** All four items are changes to the ASP.NET Core request pipeline and Minimal-API endpoints in `Pulse.Edge.Api`. Because the security properties (who gets 401/403, which headers appear, when a 429 fires) live in the *wired pipeline*, Task 1 first stands up a `WebApplicationFactory<Program>` integration-test harness (the repo has none today). The harness runs the API in `MultiPort` mode, which registers the endpoints but **no** background services (Worker, provisioning, config monitor), against an isolated temp-file SQLite database selected by a new `PULSE_EDGE_DATA_DIR` environment override. Slice 2D's gate-required brute-force and authz-matrix tests reuse this harness.

**Tech Stack:** .NET 10 (`net10.0`), ASP.NET Core Minimal APIs, EF Core + SQLite, xUnit 2.9.3, `Microsoft.AspNetCore.Mvc.Testing`, the built-in `Microsoft.AspNetCore.RateLimiting` middleware.

## Global Constraints

- **Target framework:** `net10.0`; SDK pinned in `global.json` (10.0.300). Copy verbatim.
- **Warnings are errors:** the build runs `dotnet build Pulse.Edge.slnx --warnaserror`. Introduce zero new warnings.
- **Committed lockfiles:** after adding any NuGet package you MUST run `dotnet restore Pulse.Edge.slnx` to regenerate `packages.lock.json`; never hand-edit it. CI restores with `--locked-mode`.
- **Test framework:** xUnit. `using Xunit;` is a global using in the test project — `[Fact]`, `[Theory]`, `[InlineData]`, `Assert.*` need no import.
- **Test DB isolation:** never touch the production DB path in tests. Use the `PULSE_EDGE_DATA_DIR` override (Task 1) or the `new QueueDbContext(path)` constructor with a per-run temp directory, mirroring `ConfigurationBackupServiceTests`.
- **Single test class run:** `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~<ClassName>`.
- **Accepted-risk boundaries (do NOT re-open):** protocol/device credentials stay plaintext + backup-recoverable (R-008); the setup-window trust-on-first-use is accepted, no B-06 mechanism (R-009). Nothing in this slice may implement a setup token, loopback-only setup, or device-credential encryption.
- **Setup flow must keep working:** `POST /api/settings` and `POST /api/auth/first-admin` are reachable **anonymously during initial setup** (`hasUsers == false`). Do NOT add an `Admin` guard to those two — it would break commissioning.

---

### Task 1: Integration-test harness (`WebApplicationFactory<Program>`) + data-dir override

**Files:**
- Modify: `src/Pulse.Edge.Storage/QueueDbContext.cs` (default-path branch of `OnConfiguring`)
- Modify: `src/Pulse.Edge.Api/Program.cs` (append `public partial class Program { }`)
- Modify: `src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj` (add test package)
- Create: `src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs`
- Create: `src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs`

**Interfaces:**
- Produces: `PulseEdgeAppFactory : WebApplicationFactory<Program>` with:
  - `string DataDir { get; }` — the temp directory holding this factory's `edge.db`.
  - `Task ResetDatabaseAsync()` — clears all rows from the tables tests use.
  - `Task<HttpClient> CreateClientLoggedInAsync(string role, string username, string password)` — seeds an enabled `LocalUser` of `role` directly in the DB, then logs in via `POST /api/auth/login`, returning a cookie-bearing client.
  - `Task SeedDeviceConfigAsync(Action<DeviceConfig> configure)` — inserts one `DeviceConfig` row.
- Produces: xUnit collection `"EdgeApi"` (parallelization disabled) so the process-global `PULSE_EDGE_DATA_DIR` is not clobbered by concurrent factories. All integration test classes in later tasks use `[Collection("EdgeApi")]`.

- [ ] **Step 1: Add the data-dir override to `QueueDbContext`**

In `src/Pulse.Edge.Storage/QueueDbContext.cs`, the default-path branch of `OnConfiguring` currently reads (the branch that runs when no explicit `_databasePath` was passed):

```csharp
// Default path resolution
string pulseFolder;
if (OperatingSystem.IsWindows())
{
    var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    pulseFolder = Path.Combine(appDataFolder, "PULSE Edge");
}
else
{
    var userFolder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    pulseFolder = Path.Combine(userFolder, ".pulse");
}

Directory.CreateDirectory(pulseFolder);
var dbPath = Path.Combine(pulseFolder, "edge.db");
optionsBuilder.UseSqlite($"Data Source={dbPath}");
```

Replace it with a version that honors an environment override first (useful for tests and for relocating the data directory in production):

```csharp
// Default path resolution. An explicit PULSE_EDGE_DATA_DIR override wins (used by
// integration tests and by operators who relocate the data directory).
var overrideDir = Environment.GetEnvironmentVariable("PULSE_EDGE_DATA_DIR");
string pulseFolder;
if (!string.IsNullOrWhiteSpace(overrideDir))
{
    pulseFolder = overrideDir;
}
else if (OperatingSystem.IsWindows())
{
    var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    pulseFolder = Path.Combine(appDataFolder, "PULSE Edge");
}
else
{
    var userFolder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    pulseFolder = Path.Combine(userFolder, ".pulse");
}

Directory.CreateDirectory(pulseFolder);
var dbPath = Path.Combine(pulseFolder, "edge.db");
optionsBuilder.UseSqlite($"Data Source={dbPath}");
```

- [ ] **Step 2: Make `Program` reachable for the test factory**

Append to the very end of `src/Pulse.Edge.Api/Program.cs` (after the `finally { Log.CloseAndFlush(); }` block):

```csharp

// Exposes the implicit top-level Program type to the test project for WebApplicationFactory<Program>.
public partial class Program { }
```

- [ ] **Step 3: Add the test package and restore**

Run:

```bash
dotnet add src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj package Microsoft.AspNetCore.Mvc.Testing
dotnet restore Pulse.Edge.slnx
```

Expected: the package is added, `packages.lock.json` for the test project is regenerated. Do not pin a version manually — let restore resolve the `net10.0`-compatible version.

- [ ] **Step 4: Write the factory**

Create `src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs`:

```csharp
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

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // MultiPort registers the endpoints but NOT the background services
        // (Worker, provisioning, config monitor), so tests don't spin up acquisition.
        builder.UseSetting("hostingMode", "MultiPort");
        builder.UseSetting("RateLimiting:Login:PermitLimit", LoginPermitLimit.ToString());
    }

    public async Task ResetDatabaseAsync()
    {
        await using var db = new QueueDbContext(DbPath);
        await db.Database.EnsureCreatedAsync();
        // Clear only the tables the Slice 2A tests touch.
        foreach (var table in new[] { "LocalUsers", "DeviceConfigs", "AuditEvents" })
        {
            await db.Database.ExecuteSqlRawAsync($"DELETE FROM {table};");
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
```

> Notes:
> - The factory is **not sealed** and `LoginPermitLimit` is `virtual` so Task 5 can subclass it.
> - Isolation model: each integration test class carries `[Collection("EdgeApi")]` (which serializes all integration classes — no two hosts serve at once) **and** `IClassFixture<PulseEdgeAppFactory>` (its own host instance). All instances share the one fixed `DataDir`; `ResetDatabaseAsync()` at the start of each test gives clean state. The env var is set once in the static constructor and never nulled, so no factory's disposal can strand another.
> - If the `LocalUser` model does not expose exactly these properties (`Id`, `Username`, `NormalizedUsername`, `PasswordHash`, `Role`, `IsEnabled`), open `src/Pulse.Edge.Storage/Models/LocalUser.cs` and match its actual property names — the seeding mirrors `AuthEndpoints.NewUser`.

- [ ] **Step 5: Write the failing smoke test**

Create `src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs`:

```csharp
using System.Net;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class HarnessSmokeTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Health_endpoint_responds_over_the_test_host()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Protected_endpoint_rejects_anonymous_after_a_user_exists()
    {
        await factory.ResetDatabaseAsync();
        // Seed one user so the app is "operational" (hasUsers == true).
        _ = await factory.CreateClientLoggedInAsync("Admin", "harness-admin", TestCredentials.Password);

        var anonymous = factory.CreateClient();
        var response = await anonymous.GetAsync("/api/adapters");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
```

- [ ] **Step 6: Run the smoke test to verify it fails, then passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~HarnessSmokeTests`

Expected before Steps 1–4 are complete: FAIL/compile error. After: PASS (2 tests). If `Protected_endpoint_rejects_anonymous...` returns 200 instead of 401, the middleware or `hasUsers` gating differs from expectation — stop and inspect `CurrentUserValidationMiddleware`.

- [ ] **Step 7: Full build (warnings-as-errors) and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Storage/QueueDbContext.cs src/Pulse.Edge.Api/Program.cs \
        src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj src/Pulse.Edge.Tests/packages.lock.json \
        src/Pulse.Edge.Tests/Integration/
git commit -m "test: add WebApplicationFactory harness + PULSE_EDGE_DATA_DIR override"
```

---

### Task 2: B-02 — explicit Admin guards + authorization-matrix test

**Files:**
- Modify: `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs` (factory-reset, soft-reset, toggle-sync)
- Modify: `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs` (restore inspect, restore apply)
- Create: `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs`

**Interfaces:**
- Consumes: `PulseEdgeAppFactory` (Task 1).
- Produces: no new public API; the endpoints listed gain an explicit `if (!context.User.IsInRole("Admin")) return Results.Forbid();` first line.

- [ ] **Step 1: Write the failing authorization-matrix test**

Create `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class AuthorizationMatrixTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    // Admin-only mutating endpoints that must reject anonymous (401) and ReadOnly (403).
    public static IEnumerable<object[]> AdminOnlyMutations() =>
    [
        ["/api/settings/factory-reset"],
        ["/api/settings/soft-reset"],
        ["/api/settings/toggle-sync"],
        ["/api/restores/configuration/inspect"],
        ["/api/restores/configuration/apply"],
    ];

    [Theory]
    [MemberData(nameof(AdminOnlyMutations))]
    public async Task Anonymous_cannot_call_admin_mutation(string path)
    {
        await factory.ResetDatabaseAsync();
        // Make the app operational so anonymous mutations are not treated as initial setup.
        _ = await factory.CreateClientLoggedInAsync("Admin", "matrix-admin", TestCredentials.Password);

        var anonymous = factory.CreateClient();
        var response = await anonymous.PostAsJsonAsync(path, new { });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AdminOnlyMutations))]
    public async Task ReadOnly_cannot_call_admin_mutation(string path)
    {
        await factory.ResetDatabaseAsync();
        // An Admin must exist first (the ReadOnly seed only adds a ReadOnly user).
        _ = await factory.CreateClientLoggedInAsync("Admin", "matrix-admin2", TestCredentials.Password);
        var readOnly = await factory.CreateClientLoggedInAsync("ReadOnly", "matrix-ro", TestCredentials.Password);

        var response = await readOnly.PostAsJsonAsync(path, new { });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
```

- [ ] **Step 2: Run to verify current behavior**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~AuthorizationMatrixTests`

Expected: these likely **PASS already** for the reset/toggle endpoints (the middleware mutation rule enforces Admin) but may behave differently for the restore endpoints depending on request-body parsing. The test's job is to *lock in* the security property; the explicit guards in Step 3 are defense-in-depth so a future middleware change cannot silently regress these. If any case returns 200/400 instead of 401/403, note which — that endpoint is the one relying entirely on middleware.

- [ ] **Step 3: Add explicit Admin guards**

In `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs`, add as the **first line** inside each of these three handler lambdas:

`factory-reset` (`MapPost("/api/settings/factory-reset", async (IEnumerable<IHostedService> hostedServices, HttpContext context) => {`) — `context` is already a parameter:
```csharp
if (!context.User.IsInRole("Admin")) return Results.Forbid();
```

`soft-reset` (`MapPost("/api/settings/soft-reset", async (IEnumerable<IHostedService> hostedServices) => {`) — add `HttpContext context` to the lambda parameters, then first line:
```csharp
if (!context.User.IsInRole("Admin")) return Results.Forbid();
```

`toggle-sync` (`MapPost("/api/settings/toggle-sync", async () => {`) — add `HttpContext context` to the lambda parameters, then first line:
```csharp
if (!context.User.IsInRole("Admin")) return Results.Forbid();
```

Do **NOT** add a guard to `POST /api/settings` — it must stay anonymous during initial setup.

In `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs`, add `HttpContext context` to the `inspect` lambda (it currently has none) and add the guard as the first line of both restore handlers:

`inspect` (`MapPost("/api/restores/configuration/inspect", (ConfigurationBackupDocument document, ConfigurationBackupService backups) =>`) → add `HttpContext context` parameter and:
```csharp
if (!context.User.IsInRole("Admin")) return Results.Forbid();
```

`apply` (`MapPost("/api/restores/configuration/apply", async (ConfigurationBackupDocument document, ConfigurationBackupService backups, HttpContext context, CancellationToken cancellationToken) =>`) — `context` already present; first line:
```csharp
if (!context.User.IsInRole("Admin")) return Results.Forbid();
```

- [ ] **Step 4: Run the matrix test — all cases pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~AuthorizationMatrixTests`
Expected: PASS (10 cases: 5 paths × 2 roles).

- [ ] **Step 5: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs \
        src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs
git commit -m "feat(security): explicit Admin guards on reset/restore endpoints (B-02)"
```

---

### Task 3: B-01 — restrict dashboard pairing fields to Admin

**Files:**
- Modify: `src/Pulse.Edge.Api/Endpoints/DashboardEndpoints.cs` (the `/api/dashboard` handler)
- Create: `src/Pulse.Edge.Tests/Integration/DashboardPairingVisibilityTests.cs`

**Interfaces:**
- Consumes: `PulseEdgeAppFactory` (Task 1).
- Produces: `/api/dashboard` returns the pairing fields (`PairingToken`, `PairingShortCode`, `PairingBaseUrl`, `PairingExpiresAt`) with their real values only when the caller is an Admin **or** the app is still in setup (`hasUsers == false`); otherwise those fields are blank/null. `ApiKey` stays masked as today. `ClaimSecret` is still never returned.

- [ ] **Step 1: Write the failing test**

Create `src/Pulse.Edge.Tests/Integration/DashboardPairingVisibilityTests.cs`:

```csharp
using System.Net.Http.Json;
using System.Text.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class DashboardPairingVisibilityTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private static async Task<string> PairingTokenAsync(HttpClient client)
    {
        var json = await client.GetFromJsonAsync<JsonElement>("/api/dashboard");
        return json.GetProperty("Device").GetProperty("PairingToken").GetString() ?? "";
    }

    [Fact]
    public async Task Admin_sees_the_pairing_token()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => c.PairingToken = TestCredentials.SamplePairingToken);
        var admin = await factory.CreateClientLoggedInAsync("Admin", "dash-admin", TestCredentials.Password);

        Assert.Equal(TestCredentials.SamplePairingToken, await PairingTokenAsync(admin));
    }

    [Fact]
    public async Task ReadOnly_does_not_see_the_pairing_token()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => c.PairingToken = TestCredentials.SamplePairingToken);
        _ = await factory.CreateClientLoggedInAsync("Admin", "dash-admin2", TestCredentials.Password);
        var readOnly = await factory.CreateClientLoggedInAsync("ReadOnly", "dash-ro", TestCredentials.Password);

        Assert.Equal("", await PairingTokenAsync(readOnly));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~DashboardPairingVisibilityTests`
Expected: `ReadOnly_does_not_see_the_pairing_token` FAILS (ReadOnly currently receives the real token).

- [ ] **Step 3: Gate the pairing fields on role/setup**

In `src/Pulse.Edge.Api/Endpoints/DashboardEndpoints.cs`, change the `/api/dashboard` handler signature to take `HttpContext` and compute a visibility flag. Replace the handler opening:

```csharp
routes.MapGet("/api/dashboard", async (QueueStorageService storageService) =>
{
    using var db = new QueueDbContext();

    // Ensure database is created (just in case API is run before Agent)
    await db.Database.EnsureCreatedAsync();

    var config = await db.DeviceConfigs.FirstOrDefaultAsync();

    int pendingTelemetryCount = await db.QueueTelemetry.CountAsync();
    int pendingEventsCount = await db.QueueEvents.CountAsync();
```

with:

```csharp
routes.MapGet("/api/dashboard", async (QueueStorageService storageService, HttpContext context) =>
{
    using var db = new QueueDbContext();

    // Ensure database is created (just in case API is run before Agent)
    await db.Database.EnsureCreatedAsync();

    var config = await db.DeviceConfigs.FirstOrDefaultAsync();

    int pendingTelemetryCount = await db.QueueTelemetry.CountAsync();
    int pendingEventsCount = await db.QueueEvents.CountAsync();

    // Pairing credentials are Admin-only once the device is commissioned. During initial
    // setup (no users yet) they must be visible so the operator can pair the device.
    bool hasUsers = await db.LocalUsers.AnyAsync();
    bool showPairing = !hasUsers || context.User.IsInRole("Admin");
```

Then in the `Device = new { ... }` initializer, gate the four pairing fields on `showPairing`:

```csharp
    PairingToken = showPairing ? (config?.PairingToken ?? "") : "",
    PairingShortCode = showPairing ? (config?.PairingShortCode ?? "") : "",
    PairingExpiresAt = showPairing && config != null && config.PairingExpiresAt.HasValue ? DateTime.SpecifyKind(config.PairingExpiresAt.Value, DateTimeKind.Utc) : (DateTime?)null,
    PairingBaseUrl = showPairing ? (config?.PairingBaseUrl ?? "") : "",
```

Leave `ApiKey` (already masked), `SerialNumber`, `CloudEdgeId`, org/site fields, and `CloudEndpoint` unchanged.

- [ ] **Step 4: Run the test — passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~DashboardPairingVisibilityTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/Endpoints/DashboardEndpoints.cs \
        src/Pulse.Edge.Tests/Integration/DashboardPairingVisibilityTests.cs
git commit -m "feat(security): restrict dashboard pairing fields to Admin (B-01)"
```

---

### Task 4: B-04 — security headers + configurable CORS

**Files:**
- Create: `src/Pulse.Edge.Api/Security/SecurityHeadersMiddleware.cs`
- Modify: `src/Pulse.Edge.Api/Program.cs` (register the middleware; read CORS origins from config)
- Create: `src/Pulse.Edge.Tests/SecurityHeadersMiddlewareTests.cs`

**Interfaces:**
- Produces: `SecurityHeadersMiddleware` (constructed with `RequestDelegate next`, has `Task InvokeAsync(HttpContext)`) that sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Content-Security-Policy` on every response.
- Produces: CORS allowed origins read from configuration key `Cors:AllowedOrigins` (string array), defaulting to `http://localhost:8080` and `http://127.0.0.1:8080`.

- [ ] **Step 1: Write the failing unit test**

Create `src/Pulse.Edge.Tests/SecurityHeadersMiddlewareTests.cs`:

```csharp
using Microsoft.AspNetCore.Http;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class SecurityHeadersMiddlewareTests
{
    [Fact]
    public async Task Sets_the_expected_security_headers()
    {
        var context = new DefaultHttpContext();
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(context);

        Assert.Equal("nosniff", context.Response.Headers["X-Content-Type-Options"]);
        Assert.Equal("DENY", context.Response.Headers["X-Frame-Options"]);
        Assert.Equal("no-referrer", context.Response.Headers["Referrer-Policy"]);
        Assert.Contains("default-src 'self'", context.Response.Headers["Content-Security-Policy"].ToString());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~SecurityHeadersMiddlewareTests`
Expected: FAIL (compile error — `SecurityHeadersMiddleware` does not exist yet).

- [ ] **Step 3: Implement the middleware**

Create `src/Pulse.Edge.Api/Security/SecurityHeadersMiddleware.cs`:

```csharp
using Microsoft.AspNetCore.Http;

namespace Pulse.Edge.Api.Security;

public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var headers = context.Response.Headers;
        headers["X-Content-Type-Options"] = "nosniff";
        headers["X-Frame-Options"] = "DENY";
        headers["Referrer-Policy"] = "no-referrer";
        // The embedded SPA loads its own JS/CSS from the same origin. 'unsafe-inline' is
        // permitted for styles only (runtime style injection by UI libraries); scripts are 'self'.
        headers["Content-Security-Policy"] =
            "default-src 'self'; " +
            "img-src 'self' data:; " +
            "style-src 'self' 'unsafe-inline'; " +
            "script-src 'self'; " +
            "connect-src 'self'; " +
            "object-src 'none'; " +
            "base-uri 'self'; " +
            "frame-ancestors 'none'";
        await next(context);
    }
}
```

- [ ] **Step 4: Run the unit test — passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~SecurityHeadersMiddlewareTests`
Expected: PASS.

- [ ] **Step 5: Register the middleware and make CORS configurable**

In `src/Pulse.Edge.Api/Program.cs`, replace the hardcoded CORS block (currently):

```csharp
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:8080", "http://127.0.0.1:8080")
              .AllowCredentials()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});
```

with:

```csharp
var corsOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:8080", "http://127.0.0.1:8080" };
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins(corsOrigins)
              .AllowCredentials()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});
```

Then register the headers middleware as the **first** pipeline step, immediately after `var app = builder.Build();` and before `app.UseCors();`:

```csharp
app.UseMiddleware<SecurityHeadersMiddleware>();
```

- [ ] **Step 6: Add an integration assertion that headers reach real responses**

Append to `src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs` a new fact:

```csharp
    [Fact]
    public async Task Security_headers_are_present_on_responses()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
    }
```

- [ ] **Step 7: Run tests, build, and commit**

```bash
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~SecurityHeaders
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~HarnessSmokeTests
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/Security/SecurityHeadersMiddleware.cs src/Pulse.Edge.Api/Program.cs \
        src/Pulse.Edge.Tests/SecurityHeadersMiddlewareTests.cs src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs
git commit -m "feat(security): security headers + configurable CORS (B-04)"
```

- [ ] **Step 8: Manual CSP smoke against a real UI build**

The CSP could break the embedded SPA if the Vite build emits inline scripts. Verify once:

```bash
./build.sh    # builds UI, embeds it, publishes
```

Then run a published SinglePort binary from `dist/` (or `./start-edge.sh` and load `http://localhost:5288`), open the browser dev console, and confirm the app renders with **no CSP violation errors**. If a violation appears for a legitimate app asset, widen only the offending directive (e.g. add a specific source) — never fall back to `default-src *`. Record the result in the Slice 2A PR description.

---

### Task 5: B-05 — IP-based login throttling

**Files:**
- Modify: `src/Pulse.Edge.Api/Program.cs` (register the rate limiter, add `app.UseRateLimiter()`)
- Modify: `src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs` (apply the policy to the login route)
- Create: `src/Pulse.Edge.Tests/Integration/LoginThrottleTests.cs` (includes `ThrottledAppFactory`)

**Interfaces:**
- Consumes: `PulseEdgeAppFactory` (Task 1); subclassed as `ThrottledAppFactory` (overrides `LoginPermitLimit => 5`).
- Produces: a named rate-limiting policy `"login"` partitioned by client IP (fixed window; permits from config key `RateLimiting:Login:PermitLimit`, default **10**; window from `RateLimiting:Login:WindowSeconds`, default **300**; no queue). `POST /api/auth/login` returns HTTP 429 once the window limit is exceeded. This is **in addition to** the existing per-account 5-attempt / 15-minute lockout, which is unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/Pulse.Edge.Tests/Integration/LoginThrottleTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

// A dedicated factory with a LOW login limit so the throttle can be exercised in a few
// requests. It is its own host instance, so its rate-limiter state never leaks into the
// functional test classes (which use the base factory's high limit).
public sealed class ThrottledAppFactory : PulseEdgeAppFactory
{
    protected override int LoginPermitLimit => 5;
}

[Collection("EdgeApi")]
public sealed class LoginThrottleTests(ThrottledAppFactory factory) : IClassFixture<ThrottledAppFactory>
{
    [Fact]
    public async Task Repeated_login_attempts_from_one_ip_are_throttled_with_429()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        // Unknown username so per-account lockout never applies; only the IP throttle
        // (PermitLimit = 5) can trip. Requests 1–5 return 401; the 6th must be 429.
        HttpStatusCode last = HttpStatusCode.OK;
        for (int i = 0; i < 6; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/login",
                new { Username = TestCredentials.NonexistentUsername, Password = TestCredentials.Password });
            last = response.StatusCode;
        }

        Assert.Equal((HttpStatusCode)429, last);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LoginThrottleTests`
Expected: FAIL — currently every attempt returns 401, never 429 (no rate limiter wired yet).

- [ ] **Step 3: Register the rate limiter**

In `src/Pulse.Edge.Api/Program.cs`, add these usings near the top with the other `using` statements:

```csharp
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
```

Register the policy alongside the other `builder.Services.Add...` calls (e.g. just after `builder.Services.AddAuthorization();`). The limits are config-driven so tests (and operators) can tune them; defaults are 10 permits / 300 s:

```csharp
var loginPermitLimit = builder.Configuration.GetValue("RateLimiting:Login:PermitLimit", 10);
var loginWindowSeconds = builder.Configuration.GetValue("RateLimiting:Login:WindowSeconds", 300);
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login", httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            factory: _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = loginPermitLimit,
                Window = TimeSpan.FromSeconds(loginWindowSeconds),
                QueueLimit = 0,
            }));
});
```

> `GetValue<T>` needs `using Microsoft.Extensions.Configuration;` and `StatusCodes` needs `using Microsoft.AspNetCore.Http;` — add whichever the compiler flags (warnings-as-errors will fail the build on an unused or missing using).

Add the middleware to the pipeline immediately after `app.UseAuthorization();`:

```csharp
app.UseRateLimiter();
```

- [ ] **Step 4: Apply the policy to the login route**

In `src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs`, the login registration currently ends the `MapPost(...)` call at the closing `});`. Chain the policy onto it:

```csharp
        routes.MapPost("/api/auth/login", async (LoginRequest request, HttpContext context, PasswordService passwords) =>
        {
            // ... unchanged body ...
        }).RequireRateLimiting("login");
```

(Only add the `.RequireRateLimiting("login")` suffix to the existing `MapPost("/api/auth/login", ...)`; do not change the handler body.)

- [ ] **Step 5: Run the test — passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LoginThrottleTests`
Expected: PASS (11th attempt is 429).

> If it still fails with all 401s, confirm `app.UseRateLimiter()` is present and that `.RequireRateLimiting("login")` is attached to the login endpoint. If the *first* request is already 429, the `PermitLimit` was misread — it must be 10.

- [ ] **Step 6: Full suite, build, and commit**

```bash
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs \
        src/Pulse.Edge.Tests/Integration/LoginThrottleTests.cs
git commit -m "feat(security): IP-based login throttling (B-05)"
```

---

## Slice completion

After all five tasks:

- [ ] Run the entire backend suite: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj` — all green.
- [ ] Run the frontend suite (unchanged, but confirm no regression from the dashboard shape): `pnpm test:ui`.
- [ ] `dotnet build Pulse.Edge.slnx --warnaserror` — zero warnings.
- [ ] Open the Slice 2A PR. In its description: link the four backlog items (B-02, B-01, B-04, B-05), note the CSP smoke result from Task 4 Step 8, and update the roadmap's Phase 2 evidence + gate-coverage rows (authorization-matrix test, brute-force test, security-headers) to point at the new tests.
- [ ] Leave the G2 gate open — Slices 2B/2C/2D remain before the gate review.

## Self-review notes (for the implementer)

- The authz-matrix test (Task 2) may pass before the explicit guards exist because the middleware already blocks ReadOnly mutations. That is expected: the test locks the *security property*, the guards are defense-in-depth. Do not skip the guards because the test is already green.
- `PULSE_EDGE_DATA_DIR` is process-global and points at ONE fixed dir set in the factory's static constructor and never nulled — so multiple factory instances (base + `ThrottledAppFactory`) can't strand each other. `[Collection("EdgeApi")]` + `DisableParallelization` serializes all integration classes so no two hosts serve at once. Every integration test class MUST carry `[Collection("EdgeApi")]` and its own `IClassFixture<...>`.
- Rate-limiter state is per-host-instance. Functional classes use the base factory (`LoginPermitLimit = 1000`, effectively off); only `LoginThrottleTests` uses `ThrottledAppFactory` (limit 5). This is why the throttle test cannot cause spurious 429s elsewhere.
- Do not encrypt device credentials or add a setup-window mechanism — those are accepted risks R-008 / R-009 and out of scope for this slice.
