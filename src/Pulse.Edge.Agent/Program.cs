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

var builder = Host.CreateApplicationBuilder(args);

// MultiPort development bridge: forward structured Agent logs to the API's
// bounded diagnostics pipeline without blocking protocol or worker threads.
var diagnosticForwarder = new DiagnosticForwardingProvider();
builder.Logging.AddProvider(diagnosticForwarder);
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


