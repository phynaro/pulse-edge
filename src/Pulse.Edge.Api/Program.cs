using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage;
using Microsoft.EntityFrameworkCore;
using System;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Threading.Tasks;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Agent;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Agent.Drivers;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Protocols.Modbus;
using Pulse.Edge.Protocols.LibPlcTag;
using Pulse.Edge.Protocols.S7Net;
using Pulse.Edge.Protocols.RestApi;
using Pulse.Edge.Protocols.Bacnet;
using Microsoft.Extensions.FileProviders;
using Serilog;
using Serilog.Events;
using Pulse.Edge.Api.Endpoints;
using Pulse.Edge.Api.Security;
using Microsoft.AspNetCore.Authentication.Cookies;
using Pulse.Edge.Api.Diagnostics;
using Pulse.Edge.Api.Services;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.DataProtection;


// Configure Serilog daily rolling file and console logging
var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
var logFolder = OperatingSystem.IsWindows()
    ? Path.Combine(appDataFolder, "PULSE Edge", "logs")
    : Path.Combine(AppContext.BaseDirectory, "logs");

Directory.CreateDirectory(logFolder);
var logPath = Path.Combine(logFolder, "edge-.txt");
var diagnosticLogs = new DiagnosticLogService();

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.Sink(diagnosticLogs)
    .WriteTo.File(
        logPath,
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 30,
        fileSizeLimitBytes: 10 * 1024 * 1024,
        rollOnFileSizeLimit: true,
        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}"
    )
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog();

// Append custom persistent configuration from ProgramData on Windows
if (OperatingSystem.IsWindows())
{
    var appData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    var pulseConfigFolder = Path.Combine(appData, "PULSE Edge");
    var configPath = Path.Combine(pulseConfigFolder, "config.json");
    var hashPath = Path.Combine(pulseConfigFolder, "config.json.sha256");

    if (File.Exists(configPath))
    {
        if (File.Exists(hashPath))
        {
            try
            {
                using var sha256 = System.Security.Cryptography.SHA256.Create();
                using var stream = File.OpenRead(configPath);
                var hashBytes = sha256.ComputeHash(stream);
                var calculatedHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                var expectedHash = File.ReadAllText(hashPath).Trim().ToLowerInvariant();

                if (calculatedHash != expectedHash)
                {
                    Log.Fatal("Configuration integrity validation failed. config.json may have been modified without authorization. Expected hash {ExpectedHash}; calculated {CalculatedHash}", expectedHash, calculatedHash);
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[CRITICAL SECURITY ALERT] Configuration file 'config.json' has been tampered with or modified unauthorized! Hash verification failed.");
                    Console.WriteLine($"Expected: {expectedHash}");
                    Console.WriteLine($"Calculated: {calculatedHash}");
                    Console.ResetColor();
                }
                else
                {
                    Console.WriteLine("[INFO] Configuration file integrity check passed successfully.");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WARNING] Failed to verify configuration integrity: {ex.Message}");
            }
        }
        else
        {
            Console.WriteLine("[WARNING] Configuration integrity signature file 'config.json.sha256' is missing. Security validation skipped.");
        }

        builder.Configuration.AddJsonFile(configPath, optional: true, reloadOnChange: true);
    }
}

// Bind Kestrel. Default HTTPS on :5288 with a local self-signed (or configured) certificate.
var serverUrl = builder.Configuration["serverUrl"] ?? "https://*:5288";
builder.WebHost.UseUrls(serverUrl);

var certificateProvider = new Pulse.Edge.Api.Security.LocalCertificateProvider(builder.Configuration);
var serverCertificate = certificateProvider.GetOrCreateCertificate();
builder.WebHost.ConfigureKestrel(options =>
    options.ConfigureHttpsDefaults(https => https.ServerCertificate = serverCertificate));

// Enable running as a Windows Service
builder.Host.UseWindowsService();

// Enable CORS so the development React UI running on port 8080 can poll the API on port 5244.
// Allowed origins are configurable via "Cors:AllowedOrigins" (string array), falling back to
// the localhost dev-server defaults when unset.
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

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "pulse.edge.session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        // Force the session cookie Secure in production (browser talks HTTPS directly to :5288).
        // In Development the browser reaches the app over plaintext http://localhost:8080 (Vite
        // dev proxy), where a Secure cookie is dropped by the browser — so it must not be Secure
        // there. Production security is unchanged.
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.None
            : CookieSecurePolicy.Always;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = 401; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = 403; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

// IP-based login throttling (B-05). This is in addition to the existing per-account
// 5-attempt / 15-minute lockout in AuthEndpoints — that guard is unchanged. This one
// caps login attempts per source IP within a fixed window, independent of username.
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

builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton(diagnosticLogs);
builder.Services.AddSingleton<ConfigurationBackupService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<DiagnosticLogService>());

// DataProtection key ring for encrypting cloud credentials at rest (Slice 2C / B-07). The keys
// live alongside edge.db under the same data directory so a relocated/override data dir keeps
// its own key ring (matching QueueDbContext's path resolution below).
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
// NOTE: this key ring is also the ambient key ring ASP.NET Core's cookie auth uses to protect
// the session cookie's authentication ticket — that sharing is intentional (one key ring, one
// set of keys persisted under the data dir, so both cookie auth and cloud-credential encryption
// survive process restarts). Consequence, accepted by the project owner: the first boot after
// this change redirects cookie auth onto these persisted keys instead of its previous in-memory
// or default key ring, which invalidates any existing UI session cookies (one-time re-login;
// nothing else is re-encrypted or migrated). Do not rename/move `dpKeysDir` or the application
// name casually — besides invalidating sessions again, the Agent process (MultiPort mode) must
// construct its DataProtection provider with this exact same key directory and application name
// ("pulse-edge") for cloud-credential ciphertext to be readable across both processes.
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dpKeysDir))
    .SetApplicationName("pulse-edge");

// Register SQLite storage service and transient protocol drivers
builder.Services.AddSingleton<QueueStorageService>();
builder.Services.AddTransient<OpcUaDriver>();
builder.Services.AddTransient<LibPlcTagDriver>();
builder.Services.AddTransient<S7NetDriver>();
builder.Services.AddTransient<RestApiDriver>();
builder.Services.AddTransient<BacnetDriver>();
builder.Services.AddSingleton<CloudClient>();

var hostingMode = builder.Configuration["hostingMode"] ?? "SinglePort";
var isSinglePort = string.Equals(hostingMode, "SinglePort", StringComparison.OrdinalIgnoreCase);

if (isSinglePort)
{
    // Register Agent background synchronization & communication protocols
    builder.Services.AddSingleton<SyncService>();
    builder.Services.AddTransient<MqttDriver>();
    builder.Services.AddTransient<ModbusDriver>();
    builder.Services.AddTransient<SimulatorDriver>();

    // Register Poller Drivers (Transient)
    builder.Services.AddTransient<OpcUaDriverPoller>();
    builder.Services.AddTransient<MqttDriverPoller>();
    builder.Services.AddTransient<ModbusDriverPoller>();
    builder.Services.AddTransient<LibPlcTagDriverPoller>();
    builder.Services.AddTransient<S7DriverPoller>();
    builder.Services.AddTransient<RestApiDriverPoller>();
    builder.Services.AddTransient<BacnetDriverPoller>();
    builder.Services.AddTransient<SimulatorDriverPoller>();

    // Register Registry
    builder.Services.AddSingleton<DriverPollerRegistry>();

    // Register Configuration Monitor & Provisioning Services
    builder.Services.AddSingleton<EdgeConfigMonitor>();
    builder.Services.AddHostedService<EdgeConfigMonitor>(provider => provider.GetRequiredService<EdgeConfigMonitor>());

    builder.Services.AddSingleton<CloudProvisioningService>();
    builder.Services.AddHostedService<CloudProvisioningService>(provider => provider.GetRequiredService<CloudProvisioningService>());

    // Register background Worker process
    builder.Services.AddHostedService<Worker>();
}

var app = builder.Build();

// Publish the DataProtection-backed secret protector so every QueueDbContext value conversion
// (Storage project has no DI/ASP.NET dependency) can reach it before any storage I/O happens.
// DataProtectionSecretProtector lives in Pulse.Edge.Agent.Security (not Api) so the Agent
// process — which has no ASP.NET shared framework of its own — can construct the exact same
// wrapper class when it wires up its own DataProtection provider in MultiPort mode. Both
// processes must use the same class, app name, and key directory for ciphertext to interoperate.
Pulse.Edge.Storage.Security.SecretProtection.Protector =
    new Pulse.Edge.Agent.Security.DataProtectionSecretProtector(
        app.Services.GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>());

if (Pulse.Edge.Api.Security.ForwardedHeadersConfig.IsEnabled(app.Configuration))
{
    app.UseForwardedHeaders(Pulse.Edge.Api.Security.ForwardedHeadersConfig.Build(app.Configuration));
}

app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseCors();
app.UseAuthentication();
app.UseMiddleware<CurrentUserValidationMiddleware>();
app.UseAuthorization();
app.UseRateLimiter();

if (isSinglePort)
{
    // Serve React UI static assets embedded in the assembly
    var embeddedProvider = new ManifestEmbeddedFileProvider(typeof(Program).Assembly, "wwwroot");

    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = embeddedProvider
    });

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = embeddedProvider
    });
}

// GET /health - Service health endpoint for installer and monitoring systems
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

// Map Modular Endpoints
app.MapAuthEndpoints();
app.MapDiagnosticLogEndpoints();
app.MapDashboardEndpoints();
app.MapAdapterEndpoints();
app.MapDataSourceEndpoints();
app.MapDataPointEndpoints();
app.MapSettingsEndpoints();
app.MapBufferEndpoints();
app.MapBackupEndpoints();

// Run database initialization and setup before starting the web server
using (var scope = app.Services.CreateScope())
{
    var storage = scope.ServiceProvider.GetRequiredService<QueueStorageService>();
    try
    {
        await storage.InitializeAsync();
    }
    catch (Exception ex)
    {
        Log.Fatal(ex, "Critical storage initialization failure. The API cannot safely start.");
        throw;
    }
}

if (isSinglePort)
{
    // Fallback all SPA routing to index.html from embedded files
    app.MapFallbackToFile("index.html", new StaticFileOptions
    {
        FileProvider = new ManifestEmbeddedFileProvider(typeof(Program).Assembly, "wwwroot")
    });
}

try
{
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application host terminated unexpectedly.");
}
finally
{
    Log.CloseAndFlush();
}

// Exposes the implicit top-level Program type to the test project for WebApplicationFactory<Program>.
public partial class Program { }
