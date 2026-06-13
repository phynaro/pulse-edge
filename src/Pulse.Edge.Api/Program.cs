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
using Microsoft.Extensions.FileProviders;
using Serilog;
using Serilog.Events;
using Pulse.Edge.Api.Endpoints;


// Configure Serilog daily rolling file and console logging
var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
var logFolder = OperatingSystem.IsWindows()
    ? Path.Combine(appDataFolder, "PULSE Edge", "logs")
    : Path.Combine(AppContext.BaseDirectory, "logs");

Directory.CreateDirectory(logFolder);
var logPath = Path.Combine(logFolder, "edge-.txt");

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .WriteTo.Console()
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

// Bind Kestrel port. Priority: Config override -> Default http://*:5288
var serverUrl = builder.Configuration["serverUrl"] ?? "http://*:5288";
builder.WebHost.UseUrls(serverUrl);

// Enable running as a Windows Service
builder.Host.UseWindowsService();

// Enable CORS so the development React UI running on port 8080 can poll the API on port 5244
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

// Register SQLite storage service and OPC UA driver
builder.Services.AddSingleton<QueueStorageService>();
builder.Services.AddSingleton<OpcUaDriver>();
builder.Services.AddSingleton<LibPlcTagDriver>();
builder.Services.AddSingleton<CloudClient>();

var hostingMode = builder.Configuration["hostingMode"] ?? "SinglePort";
var isSinglePort = string.Equals(hostingMode, "SinglePort", StringComparison.OrdinalIgnoreCase);

if (isSinglePort)
{
    // Register Agent background synchronization & communication protocols
    builder.Services.AddSingleton<SyncService>();
    builder.Services.AddSingleton<MqttDriver>();
    builder.Services.AddSingleton<ModbusDriver>();
    builder.Services.AddSingleton<SimulatorDriver>();

    // Register Poller Drivers
    builder.Services.AddSingleton<IProtocolDriver, OpcUaDriverPoller>();
    builder.Services.AddSingleton<IProtocolDriver, MqttDriverPoller>();
    builder.Services.AddSingleton<IProtocolDriver, ModbusDriverPoller>();
    builder.Services.AddSingleton<IProtocolDriver, LibPlcTagDriverPoller>();
    builder.Services.AddSingleton<IProtocolDriver, SimulatorDriverPoller>();
    builder.Services.AddSingleton<CustomSimulatedDriverPoller>();

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

app.UseCors();

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
app.MapDashboardEndpoints();
app.MapAdapterEndpoints();
app.MapDataSourceEndpoints();
app.MapDataPointEndpoints();
app.MapSettingsEndpoints();
app.MapBufferEndpoints();

// Run database initialization and setup before starting the web server
using (var scope = app.Services.CreateScope())
{
    var storage = scope.ServiceProvider.GetRequiredService<QueueStorageService>();
    await storage.InitializeAsync();
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


