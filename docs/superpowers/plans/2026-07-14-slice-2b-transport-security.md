# Slice 2B — Transport Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt the local UI connection (self-signed HTTPS on `:5288` + forced-Secure cookie) and enforce HTTPS on the cloud uplink, plus config-gated forwarded-headers and Linux systemd sandboxing — closing threats T-02, T-12, and hardening T-15.

**Architecture:** A new `LocalCertificateProvider` resolves a server certificate at startup (custom cert → persisted self-signed → generate). Kestrel binds HTTPS on the existing single port `5288`. A shared `IsAcceptableCloudEndpoint` check (in the Cloud project) enforces HTTPS-to-cloud at both the settings API and the `CloudClient` chokepoint. Forwarded-headers support is added but off by default. Integration tests reuse the Slice 2A `WebApplicationFactory` harness with an HTTPS base address.

**Tech Stack:** .NET 10, ASP.NET Core Minimal APIs + Kestrel, `System.Security.Cryptography.X509Certificates`, xUnit + `Microsoft.AspNetCore.Mvc.Testing`.

Design spec: `docs/superpowers/specs/2026-07-14-slice-2b-transport-security-design.md`.

## Global Constraints

- **Depends on Slice 2A (PR #12).** This plan modifies files 2A created (`PulseEdgeAppFactory`, `TestCredentials`, the cookie policy). **Implement only after PR #12 is merged to `main`** (or rebase this branch onto the 2A branch). If those files are absent, stop and report BLOCKED.
- **Target framework:** `net10.0`; SDK pinned in `global.json` (10.0.300).
- **Warnings are errors:** `dotnet build Pulse.Edge.slnx --warnaserror --no-incremental` must be clean. A clean/`--no-incremental` build is required to surface analyzer warnings.
- **.NET 10 cert-loading API:** use `X509CertificateLoader` (e.g. `X509CertificateLoader.LoadPkcs12(...)`), **not** the obsolete `new X509Certificate2(bytes, password)` constructor — the obsolete overload fails the warnings-as-errors build.
- **Committed lockfiles:** no new NuGet packages are expected in this slice (`ForwardedHeaders` and the crypto APIs are in the shared framework). If you must add one, run `dotnet restore Pulse.Edge.slnx` and commit the regenerated `packages.lock.json`.
- **Test credentials:** reuse the `TestCredentials` helper from Slice 2A (`src/Pulse.Edge.Tests/Integration/TestCredentials.cs`) — never hardcode passwords (GitGuardian scans history).
- **Decisions (from the spec, do not re-litigate):** single port `5288` becomes HTTPS; self-signed RSA-2048 / 5-year cert; custom-cert override via `Tls:CertPath`/`Tls:CertPassword`; **no HSTS**; cookie `SecurePolicy = Always`; forwarded-headers off by default; **do NOT set `MemoryDenyWriteExecute`** in systemd (breaks the .NET JIT).
- **Accepted-risk boundaries (do NOT re-open):** R-008 (device creds plaintext), R-009 (setup-window). OS-keystore encryption of the cert key is Slice 2C, not here.

## File structure

- **Create:** `src/Pulse.Edge.Api/Security/LocalCertificateProvider.cs` — resolve/generate/persist the server cert.
- **Create:** `src/Pulse.Edge.Api/Security/ForwardedHeadersConfig.cs` — build forwarded-headers options from config (testable).
- **Modify:** `src/Pulse.Edge.Api/Program.cs` — Kestrel HTTPS, cookie policy, forwarded-headers wiring.
- **Modify:** `src/Pulse.Edge.Cloud/Services/CloudClient.cs` — `IsAcceptableCloudEndpoint` + guard in `GetUri`.
- **Modify:** `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs` — reject insecure cloud endpoints.
- **Modify:** `src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs` — HTTPS client base address.
- **Create:** test files under `src/Pulse.Edge.Tests/`.
- **Modify:** `build-deb.sh` — systemd sandboxing. **Create:** `docs/PULSE_Edge_Network_Hardening.md`. **Modify:** `docs/PULSE_Edge_Pilot_Known_Limitations.md` (L-004).

---

### Task 1: `LocalCertificateProvider` (B-03a)

**Files:**
- Create: `src/Pulse.Edge.Api/Security/LocalCertificateProvider.cs`
- Create: `src/Pulse.Edge.Tests/LocalCertificateProviderTests.cs`

**Interfaces:**
- Produces:
  - `LocalCertificateProvider(IConfiguration config)` and `LocalCertificateProvider(IConfiguration config, string dataDir)` (the second is the test seam — no env var needed).
  - `X509Certificate2 GetOrCreateCertificate()` — custom cert (`Tls:CertPath`) → persisted `pulse-edge.pfx` → generate+persist.
  - `static X509Certificate2 GenerateSelfSigned(DateTimeOffset? notBefore = null, DateTimeOffset? notAfter = null)`.

- [ ] **Step 1: Write the failing tests**

Create `src/Pulse.Edge.Tests/LocalCertificateProviderTests.cs`:

```csharp
using System.Linq;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Configuration;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class LocalCertificateProviderTests
{
    private static string TempDir() => Path.Combine(Path.GetTempPath(), $"pulse-cert-{Guid.NewGuid():N}");

    [Fact]
    public void GenerateSelfSigned_has_private_key_and_localhost_san()
    {
        using var cert = LocalCertificateProvider.GenerateSelfSigned();

        Assert.True(cert.HasPrivateKey);
        Assert.Contains("PULSE Edge", cert.Subject);
        var san = cert.Extensions.FirstOrDefault(e => e.Oid?.Value == "2.5.29.17");
        Assert.NotNull(san);
        var text = san!.Format(false);
        Assert.Contains("localhost", text);
        Assert.Contains("127.0.0.1", text);
    }

    [Fact]
    public void GetOrCreate_generates_then_reuses_the_persisted_cert()
    {
        var dir = TempDir();
        try
        {
            var provider = new LocalCertificateProvider(new ConfigurationBuilder().Build(), dir);
            using var first = provider.GetOrCreateCertificate();
            using var second = provider.GetOrCreateCertificate();

            Assert.True(File.Exists(Path.Combine(dir, "pulse-edge.pfx")));
            Assert.Equal(first.Thumbprint, second.Thumbprint);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void GetOrCreate_prefers_a_configured_custom_cert()
    {
        var dir = TempDir();
        try
        {
            // Write a distinct custom cert to disk.
            using var custom = LocalCertificateProvider.GenerateSelfSigned();
            var customPath = Path.Combine(dir, "custom.pfx");
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(customPath, custom.Export(X509ContentType.Pfx));

            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Tls:CertPath"] = customPath })
                .Build();
            var provider = new LocalCertificateProvider(config, dir);
            using var loaded = provider.GetOrCreateCertificate();

            Assert.Equal(custom.Thumbprint, loaded.Thumbprint);
            Assert.False(File.Exists(Path.Combine(dir, "pulse-edge.pfx"))); // did not self-generate
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LocalCertificateProviderTests`
Expected: FAIL (compile error — `LocalCertificateProvider` does not exist).

- [ ] **Step 3: Implement the provider**

Create `src/Pulse.Edge.Api/Security/LocalCertificateProvider.cs`:

```csharp
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Configuration;

namespace Pulse.Edge.Api.Security;

public sealed class LocalCertificateProvider
{
    private readonly IConfiguration _config;
    private readonly string _dataDir;

    public LocalCertificateProvider(IConfiguration config) : this(config, ResolveDataDir()) { }

    public LocalCertificateProvider(IConfiguration config, string dataDir)
    {
        _config = config;
        _dataDir = dataDir;
    }

    private static string ResolveDataDir()
    {
        var overrideDir = Environment.GetEnvironmentVariable("PULSE_EDGE_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(overrideDir)) return overrideDir;
        var folder = OperatingSystem.IsWindows()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PULSE Edge")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pulse");
        Directory.CreateDirectory(folder);
        return folder;
    }

    public X509Certificate2 GetOrCreateCertificate()
    {
        var certPath = _config["Tls:CertPath"];
        if (!string.IsNullOrWhiteSpace(certPath))
        {
            var pwd = _config["Tls:CertPassword"];
            return X509CertificateLoader.LoadPkcs12FromFile(
                certPath, string.IsNullOrEmpty(pwd) ? null : pwd, X509KeyStorageFlags.Exportable);
        }

        Directory.CreateDirectory(_dataDir);
        var pfxPath = Path.Combine(_dataDir, "pulse-edge.pfx");
        if (File.Exists(pfxPath))
        {
            return X509CertificateLoader.LoadPkcs12(File.ReadAllBytes(pfxPath), null, X509KeyStorageFlags.Exportable);
        }

        using var generated = GenerateSelfSigned();
        var pfxBytes = generated.Export(X509ContentType.Pfx);
        File.WriteAllBytes(pfxPath, pfxBytes);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(pfxPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        return X509CertificateLoader.LoadPkcs12(pfxBytes, null, X509KeyStorageFlags.Exportable);
    }

    public static X509Certificate2 GenerateSelfSigned(DateTimeOffset? notBefore = null, DateTimeOffset? notAfter = null)
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(
            new X500DistinguishedName("CN=PULSE Edge"),
            rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false)); // serverAuth
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));

        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(IPAddress.Loopback);
        san.AddIpAddress(IPAddress.IPv6Loopback);
        try { san.AddDnsName(Dns.GetHostName()); } catch { /* hostname unavailable */ }
        foreach (var ip in GetLocalIPv4Addresses()) san.AddIpAddress(ip);
        request.CertificateExtensions.Add(san.Build());

        var nb = notBefore ?? DateTimeOffset.UtcNow.AddDays(-1);
        var na = notAfter ?? DateTimeOffset.UtcNow.AddYears(5);
        return request.CreateSelfSigned(nb, na);
    }

    private static IEnumerable<IPAddress> GetLocalIPv4Addresses()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            foreach (var ua in ni.GetIPProperties().UnicastAddresses)
            {
                if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ua.Address))
                    yield return ua.Address;
            }
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LocalCertificateProviderTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Api/Security/LocalCertificateProvider.cs src/Pulse.Edge.Tests/LocalCertificateProviderTests.cs
git commit -m "feat(security): self-signed local certificate provider (B-03a)"
```

---

### Task 2: Kestrel HTTPS + forced-Secure cookie (B-03b)

**Files:**
- Modify: `src/Pulse.Edge.Api/Program.cs`
- Modify: `src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs`
- Modify: `src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs` (add the Secure-cookie test)

**Interfaces:**
- Consumes: `LocalCertificateProvider` (Task 1); `TestCredentials`, `PulseEdgeAppFactory` (Slice 2A).

- [ ] **Step 1: Write the failing test**

Add to `src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs` a new fact (inside the class):

```csharp
    [Fact]
    public async Task Login_issues_a_secure_session_cookie()
    {
        await factory.ResetDatabaseAsync();
        // CreateClientLoggedInAsync seeds the user; log in again to inspect Set-Cookie.
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.Password });

        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        Assert.Contains(cookies!, c =>
            c.Contains("pulse.edge.session") && c.Contains("secure", StringComparison.OrdinalIgnoreCase));
    }
```

Add `using System.Net.Http.Json;` to the file's usings if not present.

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~HarnessSmokeTests`
Expected: the new test FAILS — today the harness client uses `http://localhost`, so with `SecurePolicy = SameAsRequest` the cookie is not marked `Secure`.

- [ ] **Step 3: Point the harness at HTTPS**

In `src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs`, add this override method to the `PulseEdgeAppFactory` class (leave everything else unchanged):

```csharp
    protected override void ConfigureClient(HttpClient client)
    {
        base.ConfigureClient(client);
        // Forced-Secure cookies require the request to look like HTTPS. TestServer marks the
        // request scheme from the base address URI — no real TLS is involved.
        client.BaseAddress = new Uri("https://localhost");
    }
```

- [ ] **Step 4: Wire HTTPS + the Secure cookie in `Program.cs`**

In `src/Pulse.Edge.Api/Program.cs`:

(a) Change the Kestrel binding block (currently `var serverUrl = builder.Configuration["serverUrl"] ?? "http://*:5288"; builder.WebHost.UseUrls(serverUrl);`) to default to HTTPS and supply the cert:

```csharp
// Bind Kestrel. Default HTTPS on :5288 with a local self-signed (or configured) certificate.
var serverUrl = builder.Configuration["serverUrl"] ?? "https://*:5288";
builder.WebHost.UseUrls(serverUrl);

var certificateProvider = new Pulse.Edge.Api.Security.LocalCertificateProvider(builder.Configuration);
var serverCertificate = certificateProvider.GetOrCreateCertificate();
builder.WebHost.ConfigureKestrel(options =>
    options.ConfigureHttpsDefaults(https => https.ServerCertificate = serverCertificate));
```

(b) Change the cookie's secure policy (currently `options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;`) to:

```csharp
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
```

(Leave `HttpOnly`, `SameSite=Strict`, sliding expiration, and the 401/403 events as they are.)

- [ ] **Step 5: Run the harness tests**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~Integration`
Expected: PASS — the new Secure-cookie test passes, and all existing 2A integration tests still pass (they now run over the `https://localhost` base address).

- [ ] **Step 6: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Tests/Integration/PulseEdgeAppFactory.cs src/Pulse.Edge.Tests/Integration/HarnessSmokeTests.cs
git commit -m "feat(security): serve HTTPS on :5288 + forced-Secure cookie (B-03b)"
```

> Note: the real Kestrel HTTPS bind is not exercised by TestServer. Add to the Slice 2B PR description a manual-smoke follow-up: run a published SinglePort build, browse `https://<host-ip>:5288`, accept the expected self-signed warning, and confirm the UI loads and login works.

---

### Task 3: Enforce HTTPS to the cloud (B-08)

**Files:**
- Modify: `src/Pulse.Edge.Cloud/Services/CloudClient.cs`
- Modify: `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs`
- Create: `src/Pulse.Edge.Tests/CloudEndpointValidationTests.cs`
- Create: `src/Pulse.Edge.Tests/Integration/CloudEndpointEnforcementTests.cs`

**Interfaces:**
- Produces: `static bool CloudClient.IsAcceptableCloudEndpoint(string? url)` — true iff scheme is `https`, or `http` to a loopback host.

- [ ] **Step 1: Write the failing unit tests**

Create `src/Pulse.Edge.Tests/CloudEndpointValidationTests.cs`:

```csharp
using Pulse.Edge.Cloud.Services;

namespace Pulse.Edge.Tests;

public sealed class CloudEndpointValidationTests
{
    [Theory]
    [InlineData("https://cloud.example.com", true)]
    [InlineData("https://cloud.example.com:8443/api", true)]
    [InlineData("http://localhost:3000", true)]
    [InlineData("http://127.0.0.1:3000", true)]
    [InlineData("http://[::1]:3000", true)]
    [InlineData("http://cloud.example.com", false)]
    [InlineData("http://192.168.1.50:3000", false)]
    [InlineData("ftp://cloud.example.com", false)]
    [InlineData("not-a-url", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsAcceptableCloudEndpoint_enforces_https_except_loopback(string? url, bool expected)
    {
        Assert.Equal(expected, CloudClient.IsAcceptableCloudEndpoint(url));
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~CloudEndpointValidationTests`
Expected: FAIL (compile error — `IsAcceptableCloudEndpoint` does not exist).

- [ ] **Step 3: Add the check + the `GetUri` guard**

In `src/Pulse.Edge.Cloud/Services/CloudClient.cs`, add the static method (place it near `GetUri`):

```csharp
    public static bool IsAcceptableCloudEndpoint(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return false;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme == Uri.UriSchemeHttps) return true;
        if (uri.Scheme == Uri.UriSchemeHttp) return uri.IsLoopback;
        return false;
    }
```

Then, in `GetUri`, after the existing normalization (right before `return new Uri(...)`), fail closed on an insecure endpoint. Replace the final `return new Uri($"{baseUrl}/{path}");` with:

```csharp
        var full = $"{baseUrl}/{path}";
        if (!IsAcceptableCloudEndpoint(baseUrl))
            throw new InvalidOperationException(
                $"Refusing to contact PULSE Cloud over an insecure endpoint '{baseUrl}'. Use https:// (loopback may use http).");
        return new Uri(full);
```

- [ ] **Step 4: Enforce at the settings API**

In `src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs`:

(a) In the `POST /api/settings` handler, immediately after reading `request`, add a guard (before touching the DB):

```csharp
            if (!Pulse.Edge.Cloud.Services.CloudClient.IsAcceptableCloudEndpoint(request.CloudEndpoint))
                return Results.BadRequest(new { error = "Cloud endpoint must use https:// (localhost may use http)." });
```

(b) In the `POST /api/settings/validate-cloud` handler, replace the existing prefix check
(`if (!request.CloudEndpoint.StartsWith("http://") && !request.CloudEndpoint.StartsWith("https://"))`) with:

```csharp
            if (!Pulse.Edge.Cloud.Services.CloudClient.IsAcceptableCloudEndpoint(request.CloudEndpoint))
            {
                return Results.BadRequest(new { error = "Cloud endpoint must use https:// (localhost may use http)." });
            }
```

- [ ] **Step 5: Write the integration test**

Create `src/Pulse.Edge.Tests/Integration/CloudEndpointEnforcementTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class CloudEndpointEnforcementTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Saving_an_http_cloud_endpoint_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.PostAsJsonAsync("/api/settings",
            new { SerialNumber = "SN-1", CloudEndpoint = "http://cloud.example.com" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Saving_an_https_cloud_endpoint_is_accepted()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.PostAsJsonAsync("/api/settings",
            new { SerialNumber = "SN-1", CloudEndpoint = "https://cloud.example.com" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
```

- [ ] **Step 6: Run the tests, build, commit**

```bash
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter "FullyQualifiedName~CloudEndpointValidationTests|FullyQualifiedName~CloudEndpointEnforcementTests"
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Cloud/Services/CloudClient.cs src/Pulse.Edge.Api/Endpoints/SettingsEndpoints.cs src/Pulse.Edge.Tests/CloudEndpointValidationTests.cs src/Pulse.Edge.Tests/Integration/CloudEndpointEnforcementTests.cs
git commit -m "feat(security): enforce https:// for the cloud endpoint (B-08)"
```

---

### Task 4: Forwarded headers (config-gated, anti-spoof)

**Files:**
- Create: `src/Pulse.Edge.Api/Security/ForwardedHeadersConfig.cs`
- Modify: `src/Pulse.Edge.Api/Program.cs`
- Create: `src/Pulse.Edge.Tests/ForwardedHeadersConfigTests.cs`

**Interfaces:**
- Produces: `static bool ForwardedHeadersConfig.IsEnabled(IConfiguration)`; `static ForwardedHeadersOptions ForwardedHeadersConfig.Build(IConfiguration)`.

- [ ] **Step 1: Write the failing tests**

Create `src/Pulse.Edge.Tests/ForwardedHeadersConfigTests.cs`:

```csharp
using System.Net;
using Microsoft.Extensions.Configuration;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class ForwardedHeadersConfigTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Fact]
    public void IsEnabled_defaults_to_false()
    {
        Assert.False(ForwardedHeadersConfig.IsEnabled(Config(new())));
    }

    [Fact]
    public void Build_trusts_only_the_configured_known_proxy()
    {
        var config = Config(new()
        {
            ["ForwardedHeaders:Enabled"] = "true",
            ["ForwardedHeaders:KnownProxies:0"] = "10.0.0.5",
        });

        var options = ForwardedHeadersConfig.Build(config);

        Assert.Contains(IPAddress.Parse("10.0.0.5"), options.KnownProxies);
    }

    [Fact]
    public void Build_with_no_known_sources_trusts_nothing()
    {
        var config = Config(new() { ["ForwardedHeaders:Enabled"] = "true" });

        var options = ForwardedHeadersConfig.Build(config);

        Assert.Empty(options.KnownProxies);
        Assert.Empty(options.KnownNetworks);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ForwardedHeadersConfigTests`
Expected: FAIL (compile error — `ForwardedHeadersConfig` does not exist).

- [ ] **Step 3: Implement the config builder**

Create `src/Pulse.Edge.Api/Security/ForwardedHeadersConfig.cs`:

```csharp
using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;

namespace Pulse.Edge.Api.Security;

public static class ForwardedHeadersConfig
{
    public static bool IsEnabled(IConfiguration config) =>
        config.GetValue("ForwardedHeaders:Enabled", false);

    public static ForwardedHeadersOptions Build(IConfiguration config)
    {
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        };
        // Default lists include loopback; clear so ONLY explicitly-configured sources are trusted
        // (prevents X-Forwarded-For spoofing that would evade the per-IP login throttle).
        options.KnownProxies.Clear();
        options.KnownNetworks.Clear();

        foreach (var proxy in config.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
            if (IPAddress.TryParse(proxy, out var ip)) options.KnownProxies.Add(ip);

        foreach (var network in config.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
        {
            var parts = network.Split('/');
            if (parts.Length == 2 && IPAddress.TryParse(parts[0], out var prefix) && int.TryParse(parts[1], out var len))
                options.KnownNetworks.Add(new IPNetwork(prefix, len));
        }
        return options;
    }
}
```

> **`IPNetwork` namespace gotcha:** `ForwardedHeadersOptions.KnownNetworks` and `System.Net.IPNetwork` can collide. Use the exact element type that `options.KnownNetworks` expects — if the compiler reports an ambiguous or wrong `IPNetwork`, fully-qualify it (either `Microsoft.AspNetCore.HttpOverrides.IPNetwork` or `System.Net.IPNetwork`) to match `KnownNetworks`. Both have the same `(IPAddress prefix, int prefixLength)` constructor, so only the type name needs adjusting. Iterate against the warnings-as-errors build until clean.

- [ ] **Step 4: Run to verify it passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ForwardedHeadersConfigTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it into the pipeline**

In `src/Pulse.Edge.Api/Program.cs`, in the pipeline as the **first** middleware after `var app = builder.Build();` (before `app.UseMiddleware<SecurityHeadersMiddleware>();` from 2A), add — using the `UseForwardedHeaders(options)` overload so no separate DI registration is needed:

```csharp
if (Pulse.Edge.Api.Security.ForwardedHeadersConfig.IsEnabled(app.Configuration))
{
    app.UseForwardedHeaders(Pulse.Edge.Api.Security.ForwardedHeadersConfig.Build(app.Configuration));
}
```

Add `using Microsoft.AspNetCore.HttpOverrides;` to `Program.cs` usings only if the compiler requires it (avoid an unused using — warnings-as-errors).

- [ ] **Step 6: Build and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror --no-incremental
git add src/Pulse.Edge.Api/Security/ForwardedHeadersConfig.cs src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Tests/ForwardedHeadersConfigTests.cs
git commit -m "feat(security): config-gated forwarded-headers with anti-spoof (2A carry-over)"
```

---

### Task 5: systemd sandboxing + network-hardening doc (B-14)

**Files:**
- Modify: `build-deb.sh` (the systemd unit heredoc)
- Create: `docs/PULSE_Edge_Network_Hardening.md`
- Modify: `docs/PULSE_Edge_Pilot_Known_Limitations.md` (the L-004 entry)

This task has no automated test (shell + docs); verification is a syntax check plus inspection.

- [ ] **Step 1: Add sandboxing to the systemd unit**

In `build-deb.sh`, the `[Service]` block of the generated `pulse-edge.service` currently ends with `User=pulse` / `Group=pulse` / `Environment=HOME=/var/lib/pulse-edge`. Insert these hardening directives into that `[Service]` block (after `Environment=HOME=...`, before the closing `[Install]`):

```
# --- Sandboxing (systemd) ---
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
# ProtectSystem=strict makes the filesystem read-only except these paths:
ReadWritePaths=/var/lib/pulse-edge /opt/pulse-edge/logs
# NOTE: do NOT add MemoryDenyWriteExecute=true — it breaks the .NET JIT.
```

Because `ProtectSystem=strict` makes `/opt/pulse-edge` read-only and the app writes logs under `/opt/pulse-edge/logs` (`Program.cs:38`), ensure the postinst creates that directory owned by `pulse`. In the postinst script (which already `chown -R pulse:pulse /opt/pulse-edge`), add before the chown:

```bash
mkdir -p /opt/pulse-edge/logs
```

- [ ] **Step 2: Syntax-check the script**

Run: `bash -n build-deb.sh`
Expected: no output (syntax OK). If `shellcheck` is available, run `shellcheck build-deb.sh` and confirm no new errors were introduced by this change.

- [ ] **Step 3: Write the network-hardening doc**

Create `docs/PULSE_Edge_Network_Hardening.md` with this content:

```markdown
# PULSE Edge — Network & Host Hardening

Operational guidance for deploying PULSE Edge securely on a plant network. This complements the
in-product controls delivered in Phase 2 (local HTTPS, enforced cloud HTTPS, authentication).

## Network placement (prevents an IT↔OT pivot — threat T-15)

- Place the edge on a dedicated management VLAN. It must **never** route or bridge traffic between
  the IT/cloud-uplink network and the OT/PLC network.
- The edge needs: inbound `TCP 5288` (management UI/API) from the management network only, and
  outbound HTTPS to PULSE Cloud. Block everything else.

## Bind address

- By default Kestrel binds `https://*:5288` (all interfaces). On a flat or untrusted LAN, restrict
  it to the management interface or loopback via the `serverUrl` setting, e.g.
  `serverUrl = https://10.20.0.10:5288` or `serverUrl = https://127.0.0.1:5288` (with a reverse
  proxy in front).

## Host firewall defaults

- Allow inbound only `TCP 5288` from the management subnet; drop all other inbound.
- Example (Linux, ufw): `ufw default deny incoming`, `ufw allow from 10.20.0.0/24 to any port 5288 proto tcp`.

## TLS

- The local UI serves HTTPS with a self-signed certificate generated on first boot. Browsers show a
  one-time "not private" warning; this is expected — the connection is still encrypted. To remove
  the warning, either install the certificate (`pulse-edge.pfx` in the data directory) into the
  accessing machine's trust store, or supply a certificate from your own PKI via `Tls:CertPath` /
  `Tls:CertPassword`.
- HSTS is intentionally not sent while a self-signed certificate is in use (it would prevent the
  click-through). Enable it only after configuring a trusted certificate.

## Least-privilege service (Linux)

- The `.deb` package runs the service as a dedicated non-root user (`pulse`) under a systemd
  sandbox (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, dropped capabilities, scoped
  `ReadWritePaths`). Verify with `systemd-analyze security pulse-edge.service`.

## Windows

Windows deployment and service-account hardening are deferred (decision R-006) and must be
reinstated before a Windows-supporting release.
```

- [ ] **Step 4: Update the L-004 limitation**

In `docs/PULSE_Edge_Pilot_Known_Limitations.md`, find the **L-004** entry (TLS enforcement incomplete / HTTP default). Update it to record that Slice 2B addresses it: the local UI now defaults to HTTPS (self-signed) and the cloud endpoint is enforced to HTTPS; the residual is the self-signed browser warning and HSTS pending a trusted cert. Keep the entry (do not delete it) and cross-reference `PULSE_Edge_Network_Hardening.md`. Match the surrounding entry format.

- [ ] **Step 5: Commit**

```bash
bash -n build-deb.sh
git add build-deb.sh docs/PULSE_Edge_Network_Hardening.md docs/PULSE_Edge_Pilot_Known_Limitations.md
git commit -m "feat(security): systemd sandboxing + network-hardening doc (B-14)"
```

---

## Slice completion

- [ ] Full backend suite green: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`.
- [ ] `dotnet build Pulse.Edge.slnx --warnaserror --no-incremental` — zero warnings.
- [ ] Open the Slice 2B PR. In the description, list the manual-smoke follow-ups that TestServer cannot cover: (1) browse `https://<host-ip>:5288` on a real published build, accept the self-signed warning, confirm login; (2) end-to-end reverse-proxy forwarded-headers with a real proxy; (3) `systemd-analyze security pulse-edge.service` on an installed `.deb` and confirm the service reads/writes its data + logs.
- [ ] Update the roadmap Phase 2 evidence + gate-coverage rows ("Enforce TLS", "secure cookie settings", "production TLS cannot be bypassed") to point at this slice. Leave the G2 gate open — Slices 2C/2D remain.

## Self-review notes (for the implementer)

- The Secure-cookie test depends on the harness `ConfigureClient` override (Task 2 Step 3). If it still fails after Step 3, confirm the base address is `https://localhost` and that `CookieSecurePolicy.Always` was set.
- `GetUri`'s guard fails closed by throwing; the primary UX enforcement is at settings-save, so a bad endpoint is normally rejected with a clean 400 before it ever reaches `CloudClient`. Do not weaken the settings-save validation to avoid the throw.
- Do not add HSTS, do not set `MemoryDenyWriteExecute`, and do not encrypt the cert key with the OS keystore (that is Slice 2C).
