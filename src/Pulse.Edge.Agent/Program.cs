using Pulse.Edge.Agent;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Protocols.Modbus;
using Pulse.Edge.Protocols.LibPlcTag;
using Pulse.Edge.Protocols.S7Net;
using Pulse.Edge.Protocols.RestApi;
using Pulse.Edge.Protocols.Bacnet;
using Pulse.Edge.Agent.Drivers;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Agent.Security;
using Microsoft.AspNetCore.DataProtection;

// MultiPort dev mode runs this Agent process alongside the separate Api process, both reading
// and writing the same edge.db. Cloud credentials (DeviceConfig.ApiKey/ClaimSecret/PairingToken)
// are encrypted at rest via SecretProtection.Protector (Slice 2C / B-07); without setting it
// here, the Agent would fall back to the passthrough protector and (a) write those fields back
// as plaintext, and (b) fail to decrypt ciphertext the Api process wrote. The key directory and
// application name below MUST match the Api's DataProtection registration in
// src/Pulse.Edge.Api/Program.cs exactly, or ciphertext produced by one process is unreadable by
// the other.
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
Pulse.Edge.Storage.Security.SecretProtection.Protector = new DataProtectionSecretProtector(
    DataProtectionProvider.Create(new DirectoryInfo(dpKeysDir), b => b.SetApplicationName("pulse-edge")));

var builder = Host.CreateApplicationBuilder(args);

// MultiPort development bridge: forward structured Agent logs to the API's
// bounded diagnostics pipeline without blocking protocol or worker threads.
var diagnosticCaptureMonitor = new DiagnosticCaptureMonitor();
builder.Services.AddSingleton(diagnosticCaptureMonitor);
builder.Services.AddSingleton<IHostedService>(diagnosticCaptureMonitor);
var diagnosticForwarder = new DiagnosticForwardingProvider(diagnosticCaptureMonitor);
builder.Logging.AddProvider(diagnosticForwarder);
builder.Logging.AddFilter<DiagnosticForwardingProvider>(null, LogLevel.Debug);
builder.Services.AddSingleton<IHostedService>(diagnosticForwarder);

// Register Storage Service (Database)
builder.Services.AddSingleton<QueueStorageService>();

// Register Cloud Client & Sync Service
builder.Services.AddSingleton<CloudClient>();
builder.Services.AddSingleton<SyncService>();

// Register Protocol Drivers (Transient to isolate connections per adapter instance)
builder.Services.AddTransient<OpcUaDriver>();
builder.Services.AddTransient<MqttDriver>();
builder.Services.AddTransient<ModbusDriver>();
builder.Services.AddTransient<LibPlcTagDriver>();
builder.Services.AddTransient<S7NetDriver>();
builder.Services.AddTransient<RestApiDriver>();
builder.Services.AddTransient<BacnetDriver>();
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

// Register Background Worker
builder.Services.AddHostedService<Worker>();

var host = builder.Build();

// Initialize local SQLite storage before starting the hosted services to avoid race conditions
using (var scope = host.Services.CreateScope())
{
    var storage = scope.ServiceProvider.GetRequiredService<QueueStorageService>();
    await storage.InitializeAsync();
}

await host.RunAsync();

