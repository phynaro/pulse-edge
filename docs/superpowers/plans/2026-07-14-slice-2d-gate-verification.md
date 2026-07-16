# Slice 2D — Verification & Gate Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the automated tests, CI scans, and documents the G2 gate demands, and close the two defense-in-depth follow-ups (restore-endpoint `RequireAuthorization`, loopback-scoped diagnostic-forwarding certificate trust).

**Architecture:** Verification slice — almost all changes are tests and docs on the existing `PulseEdgeAppFactory` integration harness. The only production changes are: `.RequireAuthorization()` on three backup/restore endpoints (Task 1) and a loopback-scoped TLS trust policy replacing the Agent's accept-any-certificate callback (Task 3). CI gains a CodeQL workflow (Task 5); gitleaks already exists.

**Tech Stack:** .NET 10 Minimal APIs, xUnit + `WebApplicationFactory`, GitHub Actions (CodeQL).

**Spec:** `docs/superpowers/specs/2026-07-14-slice-2d-gate-verification-design.md`

## Global Constraints

- Build must stay clean under `dotnet build Pulse.Edge.slnx --warnaserror` (CI builds warnings-as-errors).
- `dotnet restore Pulse.Edge.slnx --locked-mode` must keep working (lockfiles committed; regenerate via restore only).
- Never hardcode secret-looking literals in tests — use the `TestCredentials` helper (`src/Pulse.Edge.Tests/Integration/TestCredentials.cs`).
- Do not push to `main`; work stays on branch `slice-2d-gate-verification`.
- Full backend suite must pass at the end of every task: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`.
- Integration tests join the serialized `[Collection("EdgeApi")]` collection and call `factory.ResetDatabaseAsync()` first.
- Run test commands from the repo root `/Users/jirawuth/Projects/pulse-edge`.

---

### Task 1: Restore-endpoint `RequireAuthorization` follow-up

The three backup/restore endpoints rely solely on `CurrentUserValidationMiddleware` (path-based) plus in-handler `IsInRole("Admin")` checks. Add declarative `.RequireAuthorization()` so each endpoint carries framework-level authorization metadata that survives any future middleware/path-list change. Runtime behavior is unchanged (the middleware already 401s anonymous callers before the authorization middleware runs), so the test asserts the **metadata**, which is the thing this task adds.

**Files:**
- Modify: `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs`
- Test: `src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs`

**Interfaces:**
- Consumes: `PulseEdgeAppFactory` (existing test fixture), `EndpointDataSource` from `factory.Services`.
- Produces: authorization metadata on `GET /api/backups/configuration`, `POST /api/restores/configuration/inspect`, `POST /api/restores/configuration/apply` (Task 4's matrix relies on runtime behavior only, not this metadata).

- [ ] **Step 1: Write the failing metadata test**

Add to `src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs` (add `using Microsoft.AspNetCore.Authorization;`, `using Microsoft.AspNetCore.Routing;`, `using Microsoft.Extensions.DependencyInjection;` to the usings):

```csharp
[Theory]
[InlineData("/api/backups/configuration")]
[InlineData("/api/restores/configuration/inspect")]
[InlineData("/api/restores/configuration/apply")]
public void Backup_and_restore_endpoints_declare_authorization_metadata(string path)
{
    // Defense in depth: CurrentUserValidationMiddleware already rejects anonymous /api calls,
    // but these endpoints must also carry their own authorization requirement so a future
    // change to the middleware's path handling cannot silently expose them.
    var endpoint = factory.Services.GetServices<EndpointDataSource>()
        .SelectMany(s => s.Endpoints)
        .OfType<RouteEndpoint>()
        .Single(e => string.Equals("/" + (e.RoutePattern.RawText ?? "").TrimStart('/'), path, StringComparison.OrdinalIgnoreCase));

    Assert.NotNull(endpoint.Metadata.GetMetadata<IAuthorizeData>());
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~Backup_and_restore_endpoints_declare_authorization_metadata`
Expected: FAIL — `Assert.NotNull` (no `IAuthorizeData` metadata yet).

- [ ] **Step 3: Add `.RequireAuthorization()` to the three endpoints**

In `src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs`, chain `.RequireAuthorization()` onto each of the three `Map*` calls. The closing of each handler lambda currently ends with `});` — change each to `}).RequireAuthorization();`. For example the export endpoint becomes:

```csharp
routes.MapGet("/api/backups/configuration", async (ConfigurationBackupService backups, HttpContext context, CancellationToken cancellationToken) =>
{
    if (!context.User.IsInRole("Admin")) return Results.Forbid();
    var document = await backups.CreateAsync(cancellationToken);
    await AuditAsync(context, "ConfigurationBackupCreated", true, cancellationToken);
    var serial = SafeFilePart(document.SourceSerialNumber);
    var fileName = $"pulse-edge-{serial}-{DateTime.UtcNow:yyyyMMdd-HHmmss}.pulsebackup.json";
    return Results.File(backups.Serialize(document), "application/json", fileName);
}).RequireAuthorization();
```

Apply the same `.RequireAuthorization()` suffix to `POST /api/restores/configuration/inspect` and `POST /api/restores/configuration/apply`. Keep the in-handler `IsInRole("Admin")` checks — they are the role gate (authenticated non-admin → 403).

- [ ] **Step 4: Run the test to verify it passes, then the full suite**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~Backup_and_restore_endpoints_declare_authorization_metadata`
Expected: PASS (3 theory cases).
Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`
Expected: all tests pass (101 existing + 3 new). If any previously-passing test now fails with a 302 redirect, the cookie challenge is firing before the middleware — that would mean middleware ordering changed; stop and investigate rather than adjusting assertions.

- [ ] **Step 5: Commit**

```bash
git add src/Pulse.Edge.Api/Endpoints/BackupEndpoints.cs src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs
git commit -m "B-09 follow-up: declarative RequireAuthorization on backup/restore endpoints"
```

---

### Task 2: Backup abuse tests — malformed and tampered documents

`ConfigurationBackupService.Validate` already rejects wrong format, wrong version, missing payload/collections, checksum mismatch, duplicate IDs, and dangling references. Oversized bodies were tested in Slice 2C. This task adds the missing **gate evidence**: tests proving malformed and tampered documents are rejected safely (400, never 500, no partial write). These tests are expected to pass without production changes — they are regression locks. If any case returns 500, fix the endpoint/service minimally so it returns 400.

**Files:**
- Test: `src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs`

**Interfaces:**
- Consumes: `GET /api/backups/configuration` (export), `POST /api/restores/configuration/{inspect,apply}`, `PulseEdgeAppFactory.CreateClientLoggedInAsync`, `TestCredentials`.
- Produces: nothing used by later tasks.

- [ ] **Step 1: Add helpers and the malformed-document tests**

Add `using System.Text.Json.Nodes;` to the usings of `BackupHardeningTests.cs`, then add:

```csharp
private async Task<HttpClient> AdminClientAsync()
{
    await factory.ResetDatabaseAsync();
    return await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
}

private static async Task<JsonNode> ExportAsync(HttpClient admin)
{
    var response = await admin.GetAsync("/api/backups/configuration");
    response.EnsureSuccessStatusCode();
    return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
}

private static StringContent AsJson(JsonNode document) =>
    new(document.ToJsonString(), Encoding.UTF8, "application/json");

private static async Task AssertRejectedAsync(HttpClient admin, HttpContent content, string expectedError)
{
    var response = await admin.PostAsync("/api/restores/configuration/apply", content);
    Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    if (expectedError.Length > 0)
        Assert.Contains(expectedError, await response.Content.ReadAsStringAsync());
}

[Fact]
public async Task Non_json_restore_body_is_rejected_as_bad_request()
{
    var admin = await AdminClientAsync();
    // Declared as JSON but unparseable — must be a clean 400 from model binding, not a 500.
    var content = new StringContent("this is not json", Encoding.UTF8, "application/json");
    await AssertRejectedAsync(admin, content, expectedError: "");
}

[Fact]
public async Task Document_with_wrong_format_is_rejected()
{
    var admin = await AdminClientAsync();
    var document = await ExportAsync(admin);
    document["format"] = "some-other-file-format";
    await AssertRejectedAsync(admin, AsJson(document), "not a PULSE Edge configuration backup");
}

[Fact]
public async Task Document_with_unsupported_format_version_is_rejected()
{
    var admin = await AdminClientAsync();
    var document = await ExportAsync(admin);
    document["formatVersion"] = 99;
    await AssertRejectedAsync(admin, AsJson(document), "Unsupported backup format version");
}

[Fact]
public async Task Document_with_missing_configuration_payload_is_rejected()
{
    var admin = await AdminClientAsync();
    var document = await ExportAsync(admin);
    document["configuration"] = null;
    await AssertRejectedAsync(admin, AsJson(document), "configuration payload is missing");
}

[Fact]
public async Task Document_with_missing_collection_is_rejected()
{
    var admin = await AdminClientAsync();
    var document = await ExportAsync(admin);
    document["configuration"]!["adapters"] = null;
    await AssertRejectedAsync(admin, AsJson(document), "required configuration collections are missing");
}
```

- [ ] **Step 2: Run the malformed-document tests**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~BackupHardeningTests`
Expected: PASS (these lock in existing behavior). If `Non_json_restore_body...` returns 500 instead of 400, add a minimal fix in the endpoint (e.g. catch `JsonException` → `Results.BadRequest`) — but ASP.NET Core minimal APIs return 400 for JSON binding failures by default, so a 500 here signals something unusual worth reading the stack trace for.

- [ ] **Step 3: Add the tampered-document and no-partial-write tests**

```csharp
private static JsonNode TamperedExport(JsonNode export)
{
    // Mutate the configuration payload but keep the exported (now stale) checksum.
    // The checksum only covers the configuration payload, so this simulates an attacker
    // or corruption editing the backup contents.
    var tampered = export.DeepClone();
    tampered["configuration"]!["adapters"] = new JsonArray(new JsonObject
    {
        ["id"] = "tampered-adapter",
        ["name"] = "Tampered",
        ["protocol"] = "Simulator",
        ["host"] = "localhost",
        ["port"] = 0,
        ["configJson"] = "{}",
        ["isEnabled"] = false,
        ["status"] = "Disconnected",
    });
    return tampered;
}

[Fact]
public async Task Tampered_configuration_with_stale_checksum_is_rejected()
{
    var admin = await AdminClientAsync();
    var tampered = TamperedExport(await ExportAsync(admin));
    await AssertRejectedAsync(admin, AsJson(tampered), "checksum does not match");
}

[Fact]
public async Task Document_with_dangling_reference_is_rejected()
{
    var admin = await AdminClientAsync();
    var document = (await ExportAsync(admin)).DeepClone();
    // A data point that references an adapter which is not in the backup. (The mutation also
    // invalidates the checksum; Validate accumulates errors, so the referential error is
    // still reported and is what this test asserts.)
    document["configuration"]!["dataPoints"] = new JsonArray(new JsonObject
    {
        ["id"] = "dangling-tag",
        ["adapterId"] = "no-such-adapter",
        ["metric"] = "m1",
        ["address"] = "a1",
        ["dataType"] = "Float",
    });
    await AssertRejectedAsync(admin, AsJson(document), "references missing adapter");
}

[Fact]
public async Task Rejected_apply_performs_no_partial_write_and_matches_inspect()
{
    var admin = await AdminClientAsync();
    var before = await (await admin.GetAsync("/api/adapters")).Content.ReadAsStringAsync();
    var tampered = TamperedExport(await ExportAsync(admin));

    var inspect = await admin.PostAsync("/api/restores/configuration/inspect", AsJson(tampered));
    var apply = await admin.PostAsync("/api/restores/configuration/apply", AsJson(tampered));

    // Both endpoints validate identically and reject identically.
    Assert.Equal(HttpStatusCode.BadRequest, inspect.StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, apply.StatusCode);
    Assert.Equal(await inspect.Content.ReadAsStringAsync(), await apply.Content.ReadAsStringAsync());

    // The rejected apply must not have written anything.
    var after = await (await admin.GetAsync("/api/adapters")).Content.ReadAsStringAsync();
    Assert.Equal(before, after);
}
```

- [ ] **Step 4: Run all backup tests, then the full suite**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~BackupHardeningTests`
Expected: PASS. If `Tampered_configuration...` fails with a binding error instead of the checksum message, the inline `JsonObject` is missing a property the `DriverAdapter`/`DataPoint` model requires — read the 400 body, add the missing property to the `JsonObject`, and re-run.
Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/Pulse.Edge.Tests/Integration/BackupHardeningTests.cs
git commit -m "B-09 gate evidence: malformed/tampered backup rejection tests"
```

---

### Task 3: Loopback-scoped certificate trust + TLS-bypass guard

`DiagnosticForwardingProvider.cs:13-18` accepts **any** TLS certificate for **any** host. Its only legitimate purpose is trusting this machine's own self-signed local-API certificate (Slice 2B) on `https://127.0.0.1:5288`. Replace the blanket bypass with a loopback-scoped policy, and add a source-level guard test so no other bypass can be introduced anywhere in production code. `CloudClient` uses a plain `new HttpClient()` (default validation, no bypass knob) — the guard test locks that in.

**Files:**
- Create: `src/Pulse.Edge.Agent/Services/LoopbackCertificateTrust.cs`
- Modify: `src/Pulse.Edge.Agent/Services/DiagnosticForwardingProvider.cs:13-18`
- Test: `src/Pulse.Edge.Tests/LoopbackCertificateTrustTests.cs` (create)
- Test: `src/Pulse.Edge.Tests/TlsBypassGuardTests.cs` (create)

**Interfaces:**
- Produces: `public static bool LoopbackCertificateTrust.Validate(HttpRequestMessage request, SslPolicyErrors errors)` in namespace `Pulse.Edge.Agent.Services` (the tests project already references `Pulse.Edge.Agent`).

- [ ] **Step 1: Write the failing policy unit tests**

Create `src/Pulse.Edge.Tests/LoopbackCertificateTrustTests.cs`:

```csharp
using System.Net.Security;
using Pulse.Edge.Agent.Services;

namespace Pulse.Edge.Tests;

public sealed class LoopbackCertificateTrustTests
{
    [Theory]
    [InlineData("https://127.0.0.1:5288/api/diagnostic-logs/ingest", true)]
    [InlineData("https://localhost:5288/api/diagnostic-logs/ingest", true)]
    [InlineData("https://[::1]:5288/api/diagnostic-logs/ingest", true)]
    [InlineData("https://pulse.example.com/api/diagnostic-logs/ingest", false)]
    [InlineData("https://192.168.1.10:5288/api/diagnostic-logs/ingest", false)]
    public void Invalid_certificate_is_trusted_only_for_loopback_hosts(string url, bool expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        Assert.Equal(expected, LoopbackCertificateTrust.Validate(request, SslPolicyErrors.RemoteCertificateChainErrors));
    }

    [Fact]
    public void Valid_certificate_chain_is_trusted_for_any_host()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://pulse.example.com/x");
        Assert.True(LoopbackCertificateTrust.Validate(request, SslPolicyErrors.None));
    }

    [Fact]
    public void Request_without_a_uri_is_not_trusted()
    {
        using var request = new HttpRequestMessage();
        Assert.False(LoopbackCertificateTrust.Validate(request, SslPolicyErrors.RemoteCertificateChainErrors));
    }
}
```

- [ ] **Step 2: Run to verify compilation failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LoopbackCertificateTrustTests`
Expected: BUILD FAILURE — `LoopbackCertificateTrust` does not exist.

- [ ] **Step 3: Implement the policy and rewire the provider**

Create `src/Pulse.Edge.Agent/Services/LoopbackCertificateTrust.cs`:

```csharp
using System.Net;
using System.Net.Security;

namespace Pulse.Edge.Agent.Services;

/// <summary>
/// TLS trust policy for HTTP clients that talk to this machine's own API over its
/// self-signed certificate (Slice 2B local HTTPS). A certificate that fails normal
/// validation is accepted only when the request targets a loopback address; any other
/// host keeps full chain validation, so this policy can never be used to reach a
/// remote server with an untrusted certificate.
/// </summary>
public static class LoopbackCertificateTrust
{
    public static bool Validate(HttpRequestMessage request, SslPolicyErrors errors)
    {
        if (errors == SslPolicyErrors.None) return true;
        return IsLoopbackHost(request.RequestUri?.Host);
    }

    private static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return false;
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        return IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
    }
}
```

In `src/Pulse.Edge.Agent/Services/DiagnosticForwardingProvider.cs`, replace the handler field (lines 13-18) with:

```csharp
private static readonly HttpClientHandler LoopbackHandler = new()
{
    // The local API serves a self-signed HTTPS cert (Slice 2B). Trust an otherwise-invalid
    // cert only for loopback targets; every other host keeps full validation (Slice 2D).
    ServerCertificateCustomValidationCallback = (request, _, _, errors) =>
        LoopbackCertificateTrust.Validate(request, errors),
};
```

(The callback's third/fourth parameters are the chain and `SslPolicyErrors`; only the request and errors are needed.)

- [ ] **Step 4: Run the policy tests**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LoopbackCertificateTrustTests`
Expected: PASS (7 cases).

- [ ] **Step 5: Write the TLS-bypass source guard test**

Create `src/Pulse.Edge.Tests/TlsBypassGuardTests.cs`:

```csharp
namespace Pulse.Edge.Tests;

/// <summary>
/// G2 gate check "production TLS verification cannot be bypassed": scans all production
/// source for certificate-validation bypass patterns. The single allowed site is the
/// diagnostic-forwarding client, and only because it delegates to the loopback-scoped
/// <c>LoopbackCertificateTrust</c> policy. Any new bypass anywhere fails this test.
/// </summary>
public sealed class TlsBypassGuardTests
{
    private static readonly string[] BypassMarkers =
    [
        "ServerCertificateCustomValidationCallback",
        "DangerousAcceptAnyServerCertificateValidator",
    ];

    [Fact]
    public void Certificate_validation_is_only_relaxed_via_the_loopback_policy()
    {
        var srcRoot = Path.Combine(FindRepoRoot(), "src");
        var offenders = new List<string>();
        foreach (var file in Directory.EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories))
        {
            var normalized = file.Replace('\\', '/');
            if (normalized.Contains("/obj/") || normalized.Contains("/bin/") ||
                normalized.Contains("/Pulse.Edge.Tests/")) continue;

            var text = File.ReadAllText(file);
            if (!BypassMarkers.Any(text.Contains)) continue;

            var isAllowedSite =
                normalized.EndsWith("/Pulse.Edge.Agent/Services/DiagnosticForwardingProvider.cs", StringComparison.Ordinal) &&
                text.Contains("LoopbackCertificateTrust.Validate");
            if (!isAllowedSite) offenders.Add(normalized);
        }

        Assert.True(offenders.Count == 0,
            "TLS certificate validation is bypassed outside the loopback policy in:\n" + string.Join("\n", offenders));
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Pulse.Edge.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException(
            "Repository root (Pulse.Edge.slnx) not found above " + AppContext.BaseDirectory);
    }
}
```

- [ ] **Step 6: Run the guard test and the full suite**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~TlsBypassGuardTests`
Expected: PASS (the provider now delegates to `LoopbackCertificateTrust.Validate`, so it is the allowed site).
Sanity-check the guard actually bites: temporarily change `LoopbackCertificateTrust.Validate` to `(_, _, _, _) => true` in the provider, re-run, confirm FAIL, then revert.
Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/Pulse.Edge.Agent/Services/LoopbackCertificateTrust.cs \
        src/Pulse.Edge.Agent/Services/DiagnosticForwardingProvider.cs \
        src/Pulse.Edge.Tests/LoopbackCertificateTrustTests.cs \
        src/Pulse.Edge.Tests/TlsBypassGuardTests.cs
git commit -m "T-02 hardening: loopback-scoped cert trust for diagnostic forwarding + TLS-bypass source guard"
```

---

### Task 4: Full authorization matrix with completeness guard

Replace the 5-endpoint `AuthorizationMatrixTests` with a matrix that classifies **every** mapped endpoint and fails if an endpoint exists without a classification (or a classification references a dead endpoint). Authorization semantics come from `CurrentUserValidationMiddleware` (`src/Pulse.Edge.Api/Security/CurrentUserValidationMiddleware.cs`): all `/api` paths not on its anonymous list → 401 when unauthenticated; all non-GET mutations outside `/api/auth/*`, webhooks, and ingest → 403 for non-Admins; some handlers add their own `IsInRole("Admin")` checks (e.g. `/api/users` GET).

**Files:**
- Rewrite: `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs`

**Interfaces:**
- Consumes: `PulseEdgeAppFactory`, `TestCredentials`, `EndpointDataSource` enumeration (same technique as Task 1).
- Produces: nothing used by later tasks.

- [ ] **Step 1: Replace the file with the matrix skeleton and completeness guard (classification table intentionally incomplete)**

Replace the entire contents of `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs` with the code below, but **leave `Matrix` containing only the first five entries** (the previously covered endpoints) so the guard demonstrably fails first:

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class AuthorizationMatrixTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private enum Access
    {
        AdminMutation,      // anonymous 401; ReadOnly 403 (middleware mutation rule or handler)
        AdminRead,          // anonymous 401; ReadOnly 403 (handler IsInRole check)
        AuthenticatedRead,  // anonymous 401; ReadOnly must not be blocked (not 401/403)
        AuthenticatedAction,// anonymous 401; ReadOnly allowed; probed with a dedicated client (logout kills the session)
        StreamRead,         // anonymous 401; ReadOnly probe skipped (SSE response never completes)
        SetupWindowClosed,  // anonymous 401 once users exist; ReadOnly 409 (setup already completed)
        AnonymousLogin,     // wrong credentials -> handler 401 with error body (proves the endpoint is reachable anonymously)
        AnonymousReachable, // must not be blocked by authentication/authorization (any non-401/403 status)
    }

    // Every mapped endpoint must have exactly one row here ("METHOD /pattern").
    // The completeness guard fails when this table and the live route set diverge.
    private static readonly Dictionary<string, Access> Matrix = new(StringComparer.OrdinalIgnoreCase)
    {
        ["POST /api/settings/factory-reset"] = Access.AdminMutation,
        ["POST /api/settings/soft-reset"] = Access.AdminMutation,
        ["POST /api/settings/toggle-sync"] = Access.AdminMutation,
        ["POST /api/restores/configuration/inspect"] = Access.AdminMutation,
        ["POST /api/restores/configuration/apply"] = Access.AdminMutation,
    };

    // Route patterns that are infrastructure, not API surface (filled in only if the
    // enumeration surfaces them; each entry needs a comment saying what it is).
    private static readonly string[] ExcludedPatterns = [];

    private List<(string Method, string Pattern)> LiveEndpoints()
    {
        var endpoints = new List<(string, string)>();
        foreach (var endpoint in factory.Services.GetServices<EndpointDataSource>()
                     .SelectMany(s => s.Endpoints).OfType<RouteEndpoint>())
        {
            var pattern = "/" + (endpoint.RoutePattern.RawText ?? "").TrimStart('/');
            if (ExcludedPatterns.Contains(pattern, StringComparer.OrdinalIgnoreCase)) continue;
            var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"];
            foreach (var method in methods) endpoints.Add((method, pattern));
        }
        return endpoints;
    }

    private static string Key(string method, string pattern) => $"{method.ToUpperInvariant()} {pattern}";

    // "/api/adapters/{id}" -> "/api/adapters/matrix-probe"
    private static string ProbeUrl(string pattern) => Regex.Replace(pattern, "\\{[^}]+\\}", "matrix-probe");

    [Fact]
    public void Every_endpoint_is_classified_and_every_classification_is_live()
    {
        var live = LiveEndpoints().Select(e => Key(e.Method, e.Pattern)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unclassified = live.Except(Matrix.Keys, StringComparer.OrdinalIgnoreCase).Order().ToList();
        var dead = Matrix.Keys.Except(live, StringComparer.OrdinalIgnoreCase).Order().ToList();

        Assert.True(unclassified.Count == 0 && dead.Count == 0,
            (unclassified.Count > 0 ? "Endpoints with no authorization classification:\n  " + string.Join("\n  ", unclassified) + "\n" : "") +
            (dead.Count > 0 ? "Classified endpoints that no longer exist:\n  " + string.Join("\n  ", dead) : ""));
    }
}
```

- [ ] **Step 2: Run the guard; harvest the endpoint inventory from the failure message**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~Every_endpoint_is_classified`
Expected: FAIL, and the message lists every unclassified `METHOD /pattern` — this is the authoritative endpoint inventory (it may include routes this plan's table below doesn't anticipate; classify whatever actually appears). If non-API infrastructure routes appear (e.g. a SPA fallback pattern like `{*path:nonfile}`), add them to `ExcludedPatterns` with a comment instead of classifying them.

- [ ] **Step 3: Fill in the full classification table**

Extend `Matrix` so every live endpoint is classified. Expected classifications based on the current codebase (verify each against the actual failure list from Step 2):

```csharp
        // --- Admin-only mutations (middleware: non-GET outside /api/auth, webhooks, ingest => Admin) ---
        ["POST /api/adapters"] = Access.AdminMutation,
        ["POST /api/adapters/power-meter"] = Access.AdminMutation,
        ["POST /api/adapters/test-connection"] = Access.AdminMutation,
        ["POST /api/adapters/opcua/discover"] = Access.AdminMutation,
        ["POST /api/adapters/opcua/browse"] = Access.AdminMutation,
        ["POST /api/adapters/discover-hosts"] = Access.AdminMutation,
        ["POST /api/adapters/mqtt/browse"] = Access.AdminMutation,
        ["POST /api/adapters/webhook/browse"] = Access.AdminMutation,
        ["POST /api/adapters/restapi/browse"] = Access.AdminMutation,
        ["POST /api/adapters/ethernetip/browse"] = Access.AdminMutation,
        ["POST /api/adapters/ethernetip/template"] = Access.AdminMutation,
        ["POST /api/adapters/ethernetip/program-tags"] = Access.AdminMutation,
        ["POST /api/adapters/siemens-s7/browse"] = Access.AdminMutation,
        ["POST /api/adapters/bacnet/browse"] = Access.AdminMutation,
        ["DELETE /api/adapters/{id}"] = Access.AdminMutation,
        ["POST /api/datasources"] = Access.AdminMutation,
        ["DELETE /api/datasources/{id}"] = Access.AdminMutation,
        ["POST /api/stream-templates"] = Access.AdminMutation,
        ["DELETE /api/stream-templates/{id}"] = Access.AdminMutation,
        ["POST /api/datapoints"] = Access.AdminMutation,
        ["DELETE /api/datapoints/{id}"] = Access.AdminMutation,
        ["DELETE /api/datapoints/hard/{id}"] = Access.AdminMutation,
        ["POST /api/datapoints/bulk-bind"] = Access.AdminMutation,
        ["POST /api/datapoints/poll/{id}"] = Access.AdminMutation,
        ["POST /api/mqtt-devices"] = Access.AdminMutation,
        ["DELETE /api/mqtt-devices/{id}"] = Access.AdminMutation,
        ["POST /api/diagnostic-logs/debug-capture"] = Access.AdminMutation,
        ["DELETE /api/diagnostic-logs/debug-capture"] = Access.AdminMutation,
        ["DELETE /api/diagnostic-logs"] = Access.AdminMutation,
        ["POST /api/settings"] = Access.AdminMutation,
        ["POST /api/settings/validate-cloud"] = Access.AdminMutation,
        ["POST /api/users"] = Access.AdminMutation,
        ["PUT /api/users/{id}"] = Access.AdminMutation,
        ["DELETE /api/users/{id}"] = Access.AdminMutation,

        // --- Admin-only reads (handler IsInRole check) ---
        ["GET /api/users"] = Access.AdminRead,
        ["GET /api/backups/configuration"] = Access.AdminRead,

        // --- Authenticated reads (ReadOnly allowed) ---
        ["GET /api/buffer/telemetry"] = Access.AuthenticatedRead,
        ["GET /api/buffer/events"] = Access.AuthenticatedRead,
        ["GET /api/adapters"] = Access.AuthenticatedRead,
        ["GET /api/adapters/templates/modbus-power-meters"] = Access.AuthenticatedRead,
        ["GET /api/auth/me"] = Access.AuthenticatedRead,
        ["GET /api/dashboard"] = Access.AuthenticatedRead,
        ["GET /api/diagnostics"] = Access.AuthenticatedRead,
        ["GET /api/datasources"] = Access.AuthenticatedRead,
        ["GET /api/stream-templates"] = Access.AuthenticatedRead,
        ["GET /api/datapoints"] = Access.AuthenticatedRead,
        ["GET /api/mqtt-devices"] = Access.AuthenticatedRead,
        ["GET /api/diagnostic-logs/debug-capture"] = Access.AuthenticatedRead,
        ["GET /api/diagnostic-logs/recent"] = Access.AuthenticatedRead,
        ["GET /api/diagnostic-logs/history"] = Access.AuthenticatedRead,
        ["GET /api/settings"] = Access.AuthenticatedRead,
        ["GET /api/settings/sync-status"] = Access.AuthenticatedRead,

        // --- Special cases ---
        ["POST /api/auth/logout"] = Access.AuthenticatedAction,
        ["GET /api/diagnostic-logs/stream"] = Access.StreamRead,
        ["POST /api/auth/first-admin"] = Access.SetupWindowClosed,
        ["POST /api/auth/login"] = Access.AnonymousLogin,
        ["GET /api/auth/setup-status"] = Access.AnonymousReachable,
        ["POST /api/webhooks/receive/{adapterId}"] = Access.AnonymousReachable,
        ["POST /api/diagnostic-logs/ingest"] = Access.AnonymousReachable, // loopback+key guarded in-handler; TestServer has no remote IP -> 404
        ["GET /health"] = Access.AnonymousReachable,
```

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~Every_endpoint_is_classified`
Expected: PASS. Iterate on the table (guided by the failure diff) until it does.

- [ ] **Step 4: Add the anonymous matrix fact**

```csharp
    [Fact]
    public async Task Anonymous_requests_are_rejected_on_every_protected_endpoint()
    {
        await factory.ResetDatabaseAsync();
        // Seed a user so the app is operational (the anonymous setup window is closed).
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var anonymous = factory.CreateClient();

        var failures = new List<string>();
        foreach (var (method, pattern) in LiveEndpoints())
        {
            var access = Matrix[Key(method, pattern)];
            using var request = new HttpRequestMessage(new HttpMethod(method), ProbeUrl(pattern));
            if (method is "POST" or "PUT") request.Content = JsonContent.Create(new { });
            if (access == Access.AnonymousLogin)
                request.Content = JsonContent.Create(new { Username = TestCredentials.NonexistentUsername, Password = TestCredentials.Password });

            var response = await anonymous.SendAsync(request);
            var ok = access switch
            {
                Access.AnonymousReachable => response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden),
                Access.AnonymousLogin => response.StatusCode == HttpStatusCode.Unauthorized &&
                    (await response.Content.ReadAsStringAsync()).Contains("Invalid username or password"),
                _ => response.StatusCode == HttpStatusCode.Unauthorized,
            };
            if (!ok) failures.Add($"{Key(method, pattern)} [{access}] -> {(int)response.StatusCode}");
        }

        Assert.True(failures.Count == 0, "Anonymous matrix failures:\n  " + string.Join("\n  ", failures));
    }
```

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~Anonymous_requests_are_rejected`
Expected: PASS. Any failure line means either the classification is wrong (fix the table) or an endpoint is genuinely unprotected (a real finding — stop and surface it before "fixing" the test).

- [ ] **Step 5: Add the ReadOnly matrix fact**

```csharp
    [Fact]
    public async Task ReadOnly_users_cannot_mutate_or_read_admin_data_on_any_endpoint()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var readOnly = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);

        var failures = new List<string>();
        foreach (var (method, pattern) in LiveEndpoints())
        {
            var access = Matrix[Key(method, pattern)];
            // Not meaningful for ReadOnly (anonymous-only semantics or non-terminating stream).
            if (access is Access.AnonymousLogin or Access.AnonymousReachable or Access.StreamRead) continue;

            // Logout terminates the session it runs on — give it its own client.
            var client = access == Access.AuthenticatedAction
                ? await factory.CreateClientLoggedInAsync("ReadOnly", "test-readonly-action", TestCredentials.Password)
                : readOnly;

            using var request = new HttpRequestMessage(new HttpMethod(method), ProbeUrl(pattern));
            if (method is "POST" or "PUT") request.Content = JsonContent.Create(new { });

            var response = await client.SendAsync(request);
            var ok = access switch
            {
                Access.AdminMutation or Access.AdminRead => response.StatusCode == HttpStatusCode.Forbidden,
                Access.SetupWindowClosed => response.StatusCode == HttpStatusCode.Conflict, // first admin already exists
                _ => response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden),
            };
            if (!ok) failures.Add($"{Key(method, pattern)} [{access}] -> {(int)response.StatusCode}");
        }

        Assert.True(failures.Count == 0, "ReadOnly matrix failures:\n  " + string.Join("\n  ", failures));
    }
```

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ReadOnly_users_cannot`
Expected: PASS. Same rule as Step 4: a failure is either a misclassification or a real authorization gap — investigate before touching the table.

- [ ] **Step 6: Run the full suite**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`
Expected: all pass. Note the total test count for the PR description.

- [ ] **Step 7: Commit**

```bash
git add src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs
git commit -m "B-02 gate evidence: full endpoint authorization matrix with completeness guard"
```

---

### Task 5: CodeQL workflow

Dependency scans (NuGet + pnpm) and the gitleaks secret scan already run in `quality.yml`. Add the missing static-analysis scan: a CodeQL workflow for C# and JavaScript/TypeScript. The repo is public, so code scanning is free. Local verification is limited to YAML validity — the real check is the workflow run on the PR.

**Files:**
- Create: `.github/workflows/codeql.yml`

**Interfaces:**
- Produces: a `CodeQL` check on PRs (made a required check at gate-review time, not in this PR).

- [ ] **Step 1: Check for a conflicting CodeQL default setup**

Run: `gh api repos/phynaro/pulse-edge/code-scanning/default-setup --jq .state`
Expected: `not-configured`. If it says `configured`, disable it first (`gh api -X PATCH repos/phynaro/pulse-edge/code-scanning/default-setup -f state=not-configured`) — an advanced workflow cannot upload results while default setup is enabled.

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/codeql.yml`:

```yaml
name: CodeQL

on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main
  schedule:
    - cron: '30 2 * * 1'

permissions:
  contents: read
  security-events: write

concurrency:
  group: codeql-${{ github.ref }}
  cancel-in-progress: true

jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        include:
          - language: csharp
          - language: javascript-typescript
    steps:
      - name: Check out source
        uses: actions/checkout@v6

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: ${{ matrix.language }}
          build-mode: none

      - name: Analyze
        uses: github/codeql-action/analyze@v4
        with:
          category: '/language:${{ matrix.language }}'
```

Notes for the implementer:
- `build-mode: none` analyzes C# without compiling — no .NET SDK setup step is needed and the .NET 10 toolchain requirement disappears. This is the supported mode for C# since CodeQL 2.16.
- If `github/codeql-action@v4` does not resolve (tag not found on the runner), fall back to `@v3` — same inputs.

- [ ] **Step 3: Validate the YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/codeql.yml')); print('ok')"`
Expected: `ok`. (If PyYAML is unavailable: `pnpm dlx js-yaml .github/workflows/codeql.yml > /dev/null && echo ok`.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/codeql.yml
git commit -m "G2 gate: CodeQL static analysis workflow (csharp + javascript-typescript)"
```

The workflow's first real run happens on the PR — confirm both language jobs are green there (`gh pr checks`). Making `CodeQL` a required branch-protection check happens at gate review, after it has proven green on `main`.

---

### Task 6: Security exception register, smoke runbook, roadmap risk row

**Files:**
- Create: `docs/PULSE_Edge_Security_Exception_Register.md`
- Create: `docs/PULSE_Edge_G2_Smoke_Runbook.md`
- Modify: `docs/PULSE_Edge_Production_Readiness_Roadmap.md` (append one row to the Decision and risk log table, after the R-010 row at line ~473)

**Interfaces:**
- Consumes: R-008/R-009/R-010 wording from the roadmap Decision and risk log and threat model §6.
- Produces: register entry IDs (R-008…R-011) referenced by the later gate-review PR.

- [ ] **Step 1: Write the exception register**

Create `docs/PULSE_Edge_Security_Exception_Register.md`:

```markdown
# PULSE Edge — Security Exception Register

The gate-facing view of every deliberate deviation from the G2 hardening posture. The
master record is the Decision and risk log in
[PULSE_Edge_Production_Readiness_Roadmap.md](PULSE_Edge_Production_Readiness_Roadmap.md);
threat-model context is in [PULSE_Edge_Threat_Model.md](PULSE_Edge_Threat_Model.md) §6.
An exception stays in this register until the listed review trigger fires and the
mitigation lands (or the exception is re-accepted).

| ID | Accepted | Scope | Rationale | Accepted consequence | Review trigger |
|----|----------|-------|-----------|----------------------|----------------|
| R-008 | 2026-07-13 | Device/protocol credentials (`DriverAdapter.ConfigJson`) are plaintext at rest and included in backups; only cloud keys (`ApiKey`, `ClaimSecret`, `PairingToken`) are encrypted | OT-device credentials are often the only copy maintenance staff hold; an encryption key that can be lost would strand the site configuration. Devices sit on the customer-controlled OT network | A leaked backup or stolen appliance exposes device credentials | Customer/regulatory requirement for encrypted device credentials, or a key-escrow mechanism becomes available |
| R-009 | 2026-07-13 | Pre-first-admin setup window is trust-on-first-use: no setup token, loopback-only binding, or bounded window | The window is brief, occurs during physical install on an operator-controlled network; mechanisms add commissioning friction disproportionate to the risk | During the window a LAN client could read the pairing token or claim the first admin. Mitigated operationally: commission on a controlled/isolated network | A commissioning workflow change, or field evidence of setup-window abuse |
| R-010 | 2026-07-14 | Windows-only `config.json.sha256` integrity check remains an unkeyed hash (detects corruption, not authenticated tampering) | Windows deployment is deferred (R-006); a keyed MAC needs the DataProtection key ring wiring on Windows | Offline attacker with file access can edit config and hash together (threat T-11 / L-007) | Windows returns to supported scope → replace with an HMAC keyed by the DataProtection key ring |
| R-011 | 2026-07-14 | MultiPort diagnostic forwarding (Agent → local API) accepts an otherwise-invalid TLS certificate **for loopback targets only** (`LoopbackCertificateTrust`) | The local API serves a self-signed certificate (Slice 2B); the Agent must trust its own machine's cert. Scoped so no non-loopback connection can ever bypass validation; enforced by `TlsBypassGuardTests` | Traffic to 127.0.0.1 is not authenticated by certificate (it never leaves the machine; the ingest endpoint additionally requires the shared `X-Pulse-Diagnostic-Key`) | Local API certificate gains a provisioned trust chain, or MultiPort mode is dropped |
```

- [ ] **Step 2: Append the R-011 row to the roadmap risk log**

In `docs/PULSE_Edge_Production_Readiness_Roadmap.md`, directly after the `R-010` row in the Decision and risk log table, add:

```markdown
| R-011 | 2026-07-14 | Decision | MultiPort diagnostic forwarding trusts an otherwise-invalid TLS certificate for **loopback targets only** (`LoopbackCertificateTrust`, Slice 2D). Replaces the previous accept-any-certificate callback; non-loopback bypass is impossible and locked in by `TlsBypassGuardTests`. Recorded in [PULSE_Edge_Security_Exception_Register.md](PULSE_Edge_Security_Exception_Register.md). | Project owner | Accepted | Accepted |
```

- [ ] **Step 3: Write the smoke runbook**

Create `docs/PULSE_Edge_G2_Smoke_Runbook.md`:

```markdown
# PULSE Edge — G2 Manual Smoke Runbook

Five manual checks left open by Slices 2B and 2C. Run on the Linux staging box
(steps 1–5) before the G2 gate review; record each result inline and commit the
completed copy to `docs/readiness-evidence/g2-smoke-results.md`.

Build under test: `git rev-parse HEAD` = ________  Date: ________  Operator: ________

## 1. Published-build HTTPS (Slice 2B)

On the build machine (macOS: prefix with `COPYFILE_DISABLE=1` when tarring):

    ./build.sh

Install/copy the published build onto the staging box, start the service, then from a
workstation browser open `https://<staging-host>:5288`.

Expected:
- The browser warns about a self-signed certificate (accept it); the UI loads over HTTPS.
- After logging in, DevTools → Application → Cookies shows the session cookie with the
  `Secure` and `HttpOnly` flags set.
- `http://<staging-host>:5288` does not serve the UI in plaintext.

Result: ________

## 2. systemd sandboxing score (Slice 2B)

On the staging box:

    systemd-analyze security pulse-edge --no-pager

Expected: the unit loads with the hardening directives from the shipped unit file applied
(no `Failed to determine unit` error). Record the exposure score; it should be
categorised "OK"/"Medium" or better — investigate anything the tool marks as an
unexpected regression from the Slice 2B baseline.

Score: ________  Result: ________

## 3. Pre-2C upgrade reconnects to cloud (Slice 2C)

Precondition: a device (or VM snapshot) paired to cloud on a pre-Slice-2C build, with
plaintext cloud credentials in `edge.db`.

1. Stop the service; install this build; start the service.
2. Watch the log (`journalctl -u pulse-edge -f`): the startup credential migration runs once.
3. Confirm the device shows Connected in the dashboard and telemetry resumes.
4. Expected side effect: the first browser visit after the upgrade requires a re-login
   (shared DataProtection key ring replaced the ephemeral one).

Result: ________

## 4. DataProtection key ring permissions (Slice 2C)

On the staging box (Debian install; the service user's home is `/var/lib/pulse-edge`, and the app stores its data under `$HOME/.pulse`):

    sudo stat -c '%a %U %n' /var/lib/pulse-edge/.pulse/dp-keys
    sudo ls /var/lib/pulse-edge/.pulse/dp-keys

If the data directory was customized via `PULSE_EDGE_DATA_DIR`, run the same two commands against `dp-keys` inside that directory instead.

Expected: mode `700`, owned by the service user; the directory contains at least one `key-*.xml`.

Result: ________

## 5. MultiPort two-process pairing (Slice 2C)

On a dev machine (or the staging box) with `hostingMode: MultiPort`:

1. Start the API process, then the Agent process as separate `dotnet run` processes.
2. Confirm in the Agent log that it decrypts the stored cloud credentials (no
   `CryptographicException` / re-pairing prompt) — both processes share the same data
   directory's `dp-keys` (see Check 4 for how that directory is resolved).
3. Confirm Agent diagnostics appear in the API's diagnostic log UI (forwarding works over
   the self-signed local HTTPS with the loopback-scoped trust from Slice 2D).

Result: ________
```

- [ ] **Step 4: Verify docs and commit**

Run: `dotnet build Pulse.Edge.slnx --warnaserror` (docs don't affect the build — this is the pre-commit sanity check that nothing else drifted).
Check the register's four rows render as a table (open preview or paste into a Markdown viewer).

```bash
git add docs/PULSE_Edge_Security_Exception_Register.md docs/PULSE_Edge_G2_Smoke_Runbook.md docs/PULSE_Edge_Production_Readiness_Roadmap.md
git commit -m "G2 gate: security exception register (R-008..R-011) + manual smoke runbook"
```

---

### Task 7: Whole-branch verification and PR

- [ ] **Step 1: Full local verification**

```bash
dotnet restore Pulse.Edge.slnx --locked-mode
dotnet build Pulse.Edge.slnx --no-restore --warnaserror
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --no-build
```

Expected: restore succeeds in locked mode, zero warnings, all tests pass. Record the final test count.

- [ ] **Step 2: Whole-branch code review**

Request a whole-branch review (same cadence as Slices 2A–2C) covering all commits on `slice-2d-gate-verification` vs `main`. Address findings per the receiving-code-review skill before opening the PR.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin slice-2d-gate-verification
gh pr create --title "G2 Slice 2D: gate verification & evidence (authz matrix, backup abuse tests, TLS guard, CodeQL, exception register)" --body "<summary per repo convention>"
gh pr checks --watch
```

Expected: Quality (backend, frontend, secrets, artifacts) and both new CodeQL jobs green. If CodeQL flags findings in existing code, triage them: real issues get fixed or explicitly dismissed with a reason in the Security tab — do not suppress the workflow.

**After merge (not part of this PR):** owner runs `docs/PULSE_Edge_G2_Smoke_Runbook.md` on the staging box and commits results to `docs/readiness-evidence/g2-smoke-results.md`; then the G2 gate-review docs PR checks the gate boxes with evidence links, updates the dashboard/gate log, and adds `CodeQL` + `Secret scan` to the required branch-protection checks.
