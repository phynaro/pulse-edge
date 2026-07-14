# Slice 2C — Secrets at Rest, Redaction & Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the three cloud-credential fields in the local database at rest (transparently), migrate existing plaintext, harden the backup import, prove secrets don't leak into logs, and document rotation — closing the DB-copy exfiltration vector for cloud creds.

**Architecture:** A tiny `ISecretProtector` (in Storage) is applied to `DeviceConfig.ApiKey`/`ClaimSecret`/`PairingToken` via an **EF Core value converter**, so the DB stores ciphertext while every existing reader sees plaintext — no call-site changes. The concrete implementation wraps ASP.NET Core **DataProtection** (in Api) and is published to a process-static holder at startup. A one-time startup migration re-encrypts legacy plaintext.

**Tech Stack:** .NET 10, EF Core value converters, `Microsoft.AspNetCore.DataProtection` (in the shared framework), xUnit + the 2A `WebApplicationFactory` harness.

Design spec: `docs/superpowers/specs/2026-07-14-slice-2c-secrets-at-rest-design.md`.

## Global Constraints

- **Depends on `main`** (2A + 2B merged). Reuses `PULSE_EDGE_DATA_DIR` (2A) and the `PulseEdgeAppFactory` harness (2A). If those are absent, stop and report BLOCKED.
- **Target framework:** `net10.0`; SDK pinned in `global.json` (10.0.300).
- **Warnings are errors:** `dotnet build Pulse.Edge.slnx --warnaserror --no-incremental` must be clean.
- **No new NuGet packages expected** — `Microsoft.AspNetCore.DataProtection` is in the `Microsoft.NET.Sdk.Web` shared framework (the Api project). The Storage project gets only a plain interface (no ASP.NET dependency). If a package is genuinely needed, run `dotnet restore Pulse.Edge.slnx` and commit the regenerated lockfile.
- **Test credentials:** reuse `TestCredentials` (2A) — never hardcode passwords (GitGuardian scans history).
- **Scope (from spec):** encrypt ONLY the 3 cloud-cred fields. Device/protocol creds stay plaintext (**R-008**). "Basic" key management — a `0600` on-disk DataProtection key ring, NO TPM/`systemd-creds`. Full-disk-theft protection is documented as a LUKS/TPM deployment control, not shipped. B-11 is **accepted as R-010**, not implemented.
- **Transparency requirement:** existing readers of `config.ApiKey` etc. must not change. The converter must return the input unchanged when it is not valid ciphertext (legacy plaintext passthrough) so upgrades never strand a paired device.

## File structure

- **Create:** `src/Pulse.Edge.Storage/Security/ISecretProtector.cs` — interface + `SecretProtection` static holder + `PassthroughSecretProtector` default.
- **Create:** `src/Pulse.Edge.Api/Security/DataProtectionSecretProtector.cs` — DataProtection-backed impl.
- **Modify:** `src/Pulse.Edge.Storage/QueueDbContext.cs` — `OnModelCreating` value converters.
- **Modify:** `src/Pulse.Edge.Api/Program.cs` — configure DataProtection, publish the protector, run the migration.
- **Modify:** `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs` — request size limit.
- **Modify:** `src/Pulse.Edge.Api/Diagnostics/DiagnosticLogService.cs` — only if a redaction gap is found.
- **Create:** `docs/PULSE_Edge_Credential_Rotation.md`. **Modify:** `docs/PULSE_Edge_Network_Hardening.md`, `docs/PULSE_Edge_Pilot_Known_Limitations.md`.
- **Create** test files under `src/Pulse.Edge.Tests/`.

---

### Task 1: Secret protector + transparent field encryption (B-07 core)

**Files:**
- Create: `src/Pulse.Edge.Storage/Security/ISecretProtector.cs`
- Create: `src/Pulse.Edge.Api/Security/DataProtectionSecretProtector.cs`
- Modify: `src/Pulse.Edge.Storage/QueueDbContext.cs`
- Modify: `src/Pulse.Edge.Api/Program.cs`
- Create: `src/Pulse.Edge.Tests/DataProtectionSecretProtectorTests.cs`
- Create: `src/Pulse.Edge.Tests/Integration/CloudCredentialEncryptionTests.cs`

**Interfaces:**
- Produces: `ISecretProtector { string Protect(string); string Unprotect(string); bool IsProtected(string); }`; `static class SecretProtection { static ISecretProtector Protector { get; set; } }` (default `PassthroughSecretProtector.Instance`); `DataProtectionSecretProtector(IDataProtectionProvider)`.

- [ ] **Step 1: Write the failing protector unit test**

Create `src/Pulse.Edge.Tests/DataProtectionSecretProtectorTests.cs`:

```csharp
using Microsoft.AspNetCore.DataProtection;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class DataProtectionSecretProtectorTests
{
    private static DataProtectionSecretProtector NewProtector()
        => new(DataProtectionProvider.Create("pulse-edge-tests"));

    [Fact]
    public void Protect_then_Unprotect_round_trips()
    {
        var p = NewProtector();
        var cipher = p.Protect("super-secret-api-key");

        Assert.NotEqual("super-secret-api-key", cipher);
        Assert.True(p.IsProtected(cipher));
        Assert.Equal("super-secret-api-key", p.Unprotect(cipher));
    }

    [Fact]
    public void Unprotect_passes_through_legacy_plaintext()
    {
        var p = NewProtector();
        // A value that was never protected (legacy row) must come back unchanged.
        Assert.Equal("legacy-plaintext", p.Unprotect("legacy-plaintext"));
        Assert.False(p.IsProtected("legacy-plaintext"));
    }

    [Fact]
    public void Empty_stays_empty()
    {
        var p = NewProtector();
        Assert.Equal("", p.Protect(""));
        Assert.Equal("", p.Unprotect(""));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~DataProtectionSecretProtectorTests`
Expected: FAIL (compile error — types don't exist).

- [ ] **Step 3: Create the interface + holder (Storage)**

Create `src/Pulse.Edge.Storage/Security/ISecretProtector.cs`:

```csharp
namespace Pulse.Edge.Storage.Security;

public interface ISecretProtector
{
    string Protect(string plaintext);
    // Returns the input unchanged if it is not valid ciphertext (legacy plaintext).
    string Unprotect(string stored);
    // True only if `stored` is ciphertext this protector produced.
    bool IsProtected(string stored);
}

/// <summary>
/// Process-wide holder so the non-DI <c>QueueDbContext</c> value converter can reach the
/// protector. <c>Program.cs</c> sets <see cref="Protector"/> at startup. The default is a
/// passthrough (no encryption) so EF tooling and unconfigured contexts do not crash; the
/// encryption integration test fails if the app leaves it unconfigured.
/// </summary>
public static class SecretProtection
{
    public static ISecretProtector Protector { get; set; } = PassthroughSecretProtector.Instance;
}

public sealed class PassthroughSecretProtector : ISecretProtector
{
    public static readonly PassthroughSecretProtector Instance = new();
    public string Protect(string plaintext) => plaintext;
    public string Unprotect(string stored) => stored;
    public bool IsProtected(string stored) => false;
}
```

- [ ] **Step 4: Create the DataProtection implementation (Api)**

Create `src/Pulse.Edge.Api/Security/DataProtectionSecretProtector.cs`:

```csharp
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Pulse.Edge.Storage.Security;

namespace Pulse.Edge.Api.Security;

public sealed class DataProtectionSecretProtector : ISecretProtector
{
    private readonly IDataProtector _protector;

    public DataProtectionSecretProtector(IDataProtectionProvider provider)
        => _protector = provider.CreateProtector("Pulse.Edge.DeviceConfig.CloudCredentials.v1");

    public string Protect(string plaintext)
        => string.IsNullOrEmpty(plaintext) ? plaintext : _protector.Protect(plaintext);

    public string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return stored;
        try { return _protector.Unprotect(stored); }
        catch (CryptographicException) { return stored; } // legacy plaintext
    }

    public bool IsProtected(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return false;
        try { _protector.Unprotect(stored); return true; }
        catch (CryptographicException) { return false; }
    }
}
```

- [ ] **Step 5: Run the protector unit test — passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~DataProtectionSecretProtectorTests`
Expected: PASS (3 tests).

- [ ] **Step 6: Add the EF value converter**

In `src/Pulse.Edge.Storage/QueueDbContext.cs`, add `using Pulse.Edge.Storage.Security;` and this override (the context currently has none):

```csharp
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Encrypt the cloud credentials at rest (Slice 2C / B-07). The DB stores ciphertext;
        // every reader sees plaintext. The converter reads SecretProtection.Protector at call
        // time, so it works regardless of when the protector is configured. Device/protocol
        // credentials (DriverAdapter.ConfigJson) are intentionally NOT encrypted (R-008).
        var secretConverter = new Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<string, string>(
            plaintext => SecretProtection.Protector.Protect(plaintext),
            stored => SecretProtection.Protector.Unprotect(stored));

        modelBuilder.Entity<DeviceConfig>().Property(x => x.ApiKey).HasConversion(secretConverter);
        modelBuilder.Entity<DeviceConfig>().Property(x => x.ClaimSecret).HasConversion(secretConverter);
        modelBuilder.Entity<DeviceConfig>().Property(x => x.PairingToken).HasConversion(secretConverter);
    }
```

- [ ] **Step 7: Configure DataProtection + publish the protector in `Program.cs`**

In `src/Pulse.Edge.Api/Program.cs`:

(a) In the service-registration section (near the other `builder.Services.Add...`), register DataProtection persisting its key ring under the data dir. Compute the data dir the same way `QueueDbContext` does:

```csharp
var edgeDataDir = Environment.GetEnvironmentVariable("PULSE_EDGE_DATA_DIR");
if (string.IsNullOrWhiteSpace(edgeDataDir))
{
    edgeDataDir = OperatingSystem.IsWindows()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PULSE Edge")
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pulse");
}
var dpKeysDir = Path.Combine(edgeDataDir, "dp-keys");
Directory.CreateDirectory(dpKeysDir);
if (!OperatingSystem.IsWindows())
{
    File.SetUnixFileMode(dpKeysDir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
}
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dpKeysDir))
    .SetApplicationName("pulse-edge");
```

(b) Immediately after `var app = builder.Build();` (before the request pipeline and before storage init), publish the protector so every `QueueDbContext` conversion uses it:

```csharp
Pulse.Edge.Storage.Security.SecretProtection.Protector =
    new Pulse.Edge.Api.Security.DataProtectionSecretProtector(
        app.Services.GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>());
```

Add `using Microsoft.Extensions.DependencyInjection;` if the compiler needs it for `GetRequiredService`.

- [ ] **Step 8: Write the transparent-encryption integration test**

Create `src/Pulse.Edge.Tests/Integration/CloudCredentialEncryptionTests.cs`:

```csharp
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
```

> Note on `SqlQueryRaw<string>`: it maps a scalar column named `Value` (hence the `AS Value` alias) to a `string` — it does NOT apply the entity's value converter, which is exactly why it exposes the raw ciphertext.

- [ ] **Step 9: Run the encryption test + full suite**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~CloudCredentialEncryptionTests`
Expected: PASS. Then run the whole suite `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj` — all existing tests still pass (the converter is transparent; harness `SeedDeviceConfigAsync` and dashboard/settings reads all still see plaintext).

> If an existing integration test that reads `PairingToken`/`ApiKey` fails, the cause is almost certainly the protector not being configured before a write — confirm Step 7(b) runs before storage init and that the failing test builds the host (calls `CreateClient()`) before seeding.

- [ ] **Step 10: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Storage/Security/ISecretProtector.cs src/Pulse.Edge.Api/Security/DataProtectionSecretProtector.cs \
        src/Pulse.Edge.Storage/QueueDbContext.cs src/Pulse.Edge.Api/Program.cs \
        src/Pulse.Edge.Tests/DataProtectionSecretProtectorTests.cs src/Pulse.Edge.Tests/Integration/CloudCredentialEncryptionTests.cs
git commit -m "feat(security): encrypt cloud credentials at rest via DataProtection (B-07)"
```

---

### Task 2: Legacy-plaintext migration (B-07)

**Files:**
- Modify: `src/Pulse.Edge.Api/Program.cs`
- Create: `src/Pulse.Edge.Tests/Integration/CloudCredentialMigrationTests.cs`

**Interfaces:**
- Consumes: `SecretProtection.Protector` (Task 1); `QueueDbContext`.

- [ ] **Step 1: Write the failing migration test**

Create `src/Pulse.Edge.Tests/Integration/CloudCredentialMigrationTests.cs`:

```csharp
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Security;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class CloudCredentialMigrationTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Startup_migration_encrypts_legacy_plaintext_cloud_creds()
    {
        await factory.ResetDatabaseAsync();
        _ = factory.CreateClient(); // ensure the protector is configured

        var dbPath = Path.Combine(PulseEdgeAppFactory.DataDir, "edge.db");

        // Simulate a pre-2C row: write plaintext DIRECTLY into the column, bypassing the converter.
        await using (var db = new QueueDbContext(dbPath))
        {
            await db.Database.EnsureCreatedAsync();
            await db.Database.ExecuteSqlRawAsync(
                "INSERT INTO DeviceConfigs (Id, ClaimSecret, PairingToken, ApiKey, CloudEndpoint, Version, IsSyncEnabled, CloudStatus, PairingShortCode, PairingBaseUrl, SerialNumber, OrganizationId, OrganizationName, SiteId, SiteName, CloudEdgeId) " +
                "VALUES ('dev-1', 'legacy-secret', 'legacy-token', 'legacy-key', 'https://cloud', '1.0.0', 1, 'Connected', '', '', 'SN', '', '', '', '', '')");
        }

        // The migration helper (created in Step 3) — same code the app runs at startup.
        await CloudCredentialMigration.MigrateAsync(dbPath);

        await using (var raw = new QueueDbContext(dbPath))
        {
            var storedKey = (await raw.Database.SqlQueryRaw<string>("SELECT ApiKey AS Value FROM DeviceConfigs LIMIT 1").ToListAsync()).Single();
            Assert.NotEqual("legacy-key", storedKey);
            Assert.True(SecretProtection.Protector.IsProtected(storedKey));
        }
        await using (var ef = new QueueDbContext(dbPath))
        {
            var config = await ef.DeviceConfigs.AsNoTracking().FirstAsync();
            Assert.Equal("legacy-key", config.ApiKey);
            Assert.Equal("legacy-secret", config.ClaimSecret);
            Assert.Equal("legacy-token", config.PairingToken);
        }
    }
}
```

> The test and the app run the **same** migration code via `CloudCredentialMigration.MigrateAsync` (created in Step 3), so the test won't compile until Step 3 — expected for the "write the failing test" step.

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~CloudCredentialMigrationTests`
Expected: FAIL (the migration method does not exist).

- [ ] **Step 3: Implement the migration**

Create `src/Pulse.Edge.Api/Security/CloudCredentialMigration.cs`:

```csharp
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
```

- [ ] **Step 4: Call the migration at startup**

In `src/Pulse.Edge.Api/Program.cs`, in the startup block that runs after storage `InitializeAsync()` (the `using (var scope = app.Services.CreateScope()) { ... await storage.InitializeAsync(); ... }` region), add after storage init succeeds:

```csharp
await Pulse.Edge.Api.Security.CloudCredentialMigration.MigrateAsync();
```

This runs once per boot; it's a no-op after the first successful encryption.

- [ ] **Step 5: Run the migration test + full suite, build, commit**

```bash
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~CloudCredentialMigrationTests
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Api/Security/CloudCredentialMigration.cs src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Tests/Integration/CloudCredentialMigrationTests.cs
git commit -m "feat(security): migrate legacy plaintext cloud creds to encrypted (B-07)"
```

---

### Task 3: Backup hardening (B-09)

**Files:**
- Modify: `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs` (request size limit)
- Create: `src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs`

**Interfaces:**
- Consumes: `PulseEdgeAppFactory`, `TestCredentials`, `ConfigurationBackupService` (already exists).

- [ ] **Step 1: Write the failing tests**

Create `src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class BackupHardeningTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Backup_export_contains_no_cloud_credentials()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => { c.ApiKey = "cloud-key-xyz"; c.ClaimSecret = "claim-xyz"; c.PairingToken = "pair-xyz"; });
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.GetAsync("/api/backups/configuration");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain("cloud-key-xyz", body);
        Assert.DoesNotContain("claim-xyz", body);
        Assert.DoesNotContain("pair-xyz", body);
    }

    [Fact]
    public async Task Oversized_restore_body_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        // 6 MB of JSON, over the 5 MB cap.
        var huge = "{\"junk\":\"" + new string('a', 6 * 1024 * 1024) + "\"}";
        var content = new StringContent(huge, Encoding.UTF8, "application/json");
        var response = await admin.PostAsync("/api/restores/configuration/apply", content);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode); // 413
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~BackupHardeningTests`
Expected: the export test PASSES already (cloud creds are not exported today — this is a regression guard); the oversized test FAILS (no size limit yet). If the export test unexpectedly fails, a cloud cred is leaking into the backup — stop and report.

- [ ] **Step 3: Add the request size limit**

In `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs`, add a 5 MB limit to the two restore routes. After each `.Require... ` chain (or directly on the `MapPost`), attach the metadata. Add at the top of the file `using Microsoft.AspNetCore.Http.Metadata;` only if needed; the simplest is the built-in extension:

```csharp
        routes.MapPost("/api/restores/configuration/inspect", (/* unchanged params */) =>
        {
            // ... unchanged body ...
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(5 * 1024 * 1024));

        routes.MapPost("/api/restores/configuration/apply", async (/* unchanged params */) =>
        {
            // ... unchanged body ...
        }).WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(5 * 1024 * 1024));
```

If `RequestSizeLimitAttribute` is not honored for Minimal APIs in this setup, use Kestrel's per-endpoint limit instead: chain `.WithMetadata(new Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature ...)` is not viable; the robust approach is a tiny inline check at the top of each handler:

```csharp
            if (context.Request.ContentLength is > 5 * 1024 * 1024)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
```

Use the inline `ContentLength` check (it needs `HttpContext context` — `apply` already has it; add `HttpContext context` to `inspect`'s parameter list). This is deterministic and doesn't depend on MVC filter wiring. Prefer this form.

- [ ] **Step 4: Run the tests — pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~BackupHardeningTests`
Expected: PASS (both). (The oversized body has a `Content-Length`, so the check trips before parsing.)

- [ ] **Step 5: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs
git commit -m "feat(security): reject oversized restore + lock in cloud-cred backup exclusion (B-09)"
```

---

### Task 4: Redaction assurance (B-10)

**Files:**
- Modify: `src/Pulse.Edge.Api/Diagnostics/DiagnosticLogService.cs` (make `Sanitize` testable; extend the regex only if a gap is found)
- Modify: `src/Pulse.Edge.Api/Pulse.Edge.Api.csproj` (expose internals to the test project)
- Create: `src/Pulse.Edge.Tests/DiagnosticRedactionTests.cs`

**Interfaces:**
- Consumes: `DiagnosticLogService.Sanitize(string value, int maxLength)` — the redaction routine (its regex covers `password|authorization|token|secret|api[_-]?key|cookie|credential`).

- [ ] **Step 1: Make `Sanitize` testable**

In `src/Pulse.Edge.Api/Diagnostics/DiagnosticLogService.cs`, change the `Sanitize` method's accessibility from `private` to `internal static` (it is stateless — it uses the file-static `SensitiveValue` regex — so `static` is safe; keep its `(string value, int maxLength)` signature and body unchanged).

In `src/Pulse.Edge.Api/Pulse.Edge.Api.csproj`, inside a `<ItemGroup>`, expose internals to the test project:

```xml
    <InternalsVisibleTo Include="Pulse.Edge.Tests" />
```

- [ ] **Step 2: Write the redaction test**

Create `src/Pulse.Edge.Tests/DiagnosticRedactionTests.cs`:

```csharp
using Pulse.Edge.Api.Diagnostics;

namespace Pulse.Edge.Tests;

public sealed class DiagnosticRedactionTests
{
    [Theory]
    [InlineData("Using ApiKey=abc123secretvalue to connect", "abc123secretvalue")]
    [InlineData("token: pair-tok-9999", "pair-tok-9999")]
    [InlineData("claim secret=claim-zzz stored", "claim-zzz")]
    [InlineData("credential=cloud-cred-4242", "cloud-cred-4242")]
    public void Sanitize_redacts_labelled_cloud_credentials(string message, string secret)
    {
        var result = DiagnosticLogService.Sanitize(message, 2_000);
        Assert.DoesNotContain(secret, result);
    }
}
```

- [ ] **Step 3: Run — should pass (assurance)**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~DiagnosticRedactionTests`
Expected: PASS — the labels `apikey`/`token`/`secret`/`credential` are all in the existing regex. If any case FAILS, the regex has a gap for that shape: extend the alternation or the value pattern (`[^\s,;]+`) in `DiagnosticLogService.cs` minimally so all four pass, and **do not weaken** any existing redaction. If no change was needed, that's the expected assurance outcome.

- [ ] **Step 4: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Api/Diagnostics/DiagnosticLogService.cs src/Pulse.Edge.Api/Pulse.Edge.Api.csproj src/Pulse.Edge.Tests/DiagnosticRedactionTests.cs
git commit -m "test(security): assert cloud-cred redaction in the diagnostic sink (B-10)"
```

---

### Task 5: Rotation runbook + accepted-risk records (B-12, B-11)

**Files:**
- Create: `docs/PULSE_Edge_Credential_Rotation.md`
- Modify: `docs/PULSE_Edge_Network_Hardening.md`, `docs/PULSE_Edge_Pilot_Known_Limitations.md`

No automated test (docs); verify by review + `git diff`.

- [ ] **Step 1: Write the rotation runbook**

Create `docs/PULSE_Edge_Credential_Rotation.md`:

```markdown
# PULSE Edge — Credential & Certificate Rotation

How to rotate each secret the edge holds.

## Cloud credentials (ApiKey / ClaimSecret / PairingToken)

These are the device's identity to PULSE Cloud. They are stored **encrypted at rest** (Slice 2C)
and are re-issuable from the cloud, so rotation is a **re-pair**:

1. In the local UI, run **Soft Reset** (Settings). This regenerates `ClaimSecret` and
   `PairingToken`, clears `ApiKey`, and sets `CloudStatus = PendingApproval` — local adapter/tag
   configuration is preserved.
2. Re-approve the device in PULSE Cloud (the normal pairing flow) to issue a fresh `ApiKey`.

Use this if a cloud credential is suspected leaked, or when moving the device between
organizations.

## At-rest encryption key (DataProtection key ring)

The key ring under `<data dir>/dp-keys` protects the cloud credentials at rest. DataProtection
rotates its active key automatically on its default schedule; old keys are retained so existing
ciphertext still decrypts. To force a new key, delete the key ring and re-pair (the cloud creds
are re-issued, so no data is lost). **Do not** delete the key ring without re-pairing, or the
stored cloud creds become undecryptable (recover by re-pairing).

## Local TLS certificate

The self-signed UI certificate (`<data dir>/pulse-edge.pfx`, Slice 2B) rotates by deleting the
file — a fresh 5-year certificate is generated on the next start. If you supplied your own
certificate via `Tls:CertPath`, rotate it at your PKI and update the file/config.

## Local user passwords

Rotate via the local UI user management (admin resets a user's password).
```

- [ ] **Step 2: Add the LUKS/TPM at-rest note to the network-hardening doc**

In `docs/PULSE_Edge_Network_Hardening.md`, add a short subsection under a data-at-rest heading:

```markdown
## Data at rest

The cloud credentials are encrypted in the local database (Slice 2C) with an on-disk key. This
protects a **copied** database (support bundle, stray file, partial backup) but **not** theft of
the whole powered device — the key lives on the same disk. For full-disk-theft protection, enable
**LUKS full-disk encryption** (or a TPM-sealed key) on the host; this is a deployment control.
Device/protocol credentials remain plaintext by design (recoverable via backup — decision R-008).
```

- [ ] **Step 3: Record R-010 (accept B-11) in the limitations doc**

In `docs/PULSE_Edge_Pilot_Known_Limitations.md`, add an entry (matching the surrounding format):

```markdown
- **R-010 — Config integrity hash is unkeyed (Windows-only, accepted).** The `config.json.sha256`
  integrity check detects accidental change but not authenticated tampering. It is Windows-only,
  and Windows deployment is deferred (R-006), so this is accepted as a documented risk. Reinstate a
  keyed MAC (e.g. HMAC keyed by the DataProtection key) when Windows returns to the supported scope.
```

- [ ] **Step 4: Commit**

```bash
git add docs/PULSE_Edge_Credential_Rotation.md docs/PULSE_Edge_Network_Hardening.md docs/PULSE_Edge_Pilot_Known_Limitations.md
git commit -m "docs(security): credential rotation runbook + LUKS/TPM note + R-010 (B-12/B-11)"
```

---

## Slice completion

- [ ] Full backend suite green: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`.
- [ ] `dotnet build Pulse.Edge.slnx --warnaserror --no-incremental` — zero warnings.
- [ ] Open the Slice 2C PR. In the description, note the manual smoke: upgrade an existing (pre-2C) box and confirm it still connects to cloud after the plaintext→encrypted migration, and confirm `<data dir>/dp-keys` exists with `0700`.
- [ ] Update the roadmap: record Slice 2B merged + Slice 2C, add **R-010** to the risk log, and point the Phase 2 evidence rows at this slice. Leave the G2 gate open — **Slice 2D** (the security-test sweep + gate review) remains.

## Self-review notes (for the implementer)

- The value converter reads `SecretProtection.Protector` at call time — so the protector MUST be published (Program.cs Step 7b) before any `DeviceConfig` write. In tests, build the host (`CreateClient()`) before seeding when you assert on ciphertext.
- `Unprotect` and the converter's read path MUST passthrough legacy plaintext (catch `CryptographicException`) — this is what makes upgrades safe; do not remove it.
- Do NOT encrypt `DriverAdapter.ConfigJson` (device creds — R-008). Only the 3 `DeviceConfig` cloud fields.
- DataProtection `Protect` is non-deterministic (random per call) — never assert two ciphertexts are equal; assert `IsProtected` / round-trip instead.
