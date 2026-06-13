using Pulse.Edge.Agent;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Protocols.Modbus;
using Pulse.Edge.Protocols.LibPlcTag;
using Pulse.Edge.Protocols.S7Net;
using Pulse.Edge.Agent.Drivers;
using Pulse.Edge.Agent.Services;

var builder = Host.CreateApplicationBuilder(args);

// Register Storage Service (Database)
builder.Services.AddSingleton<QueueStorageService>();

// Register Cloud Client & Sync Service
builder.Services.AddSingleton<CloudClient>();
builder.Services.AddSingleton<SyncService>();

// Register Protocol Drivers
builder.Services.AddSingleton<OpcUaDriver>();
builder.Services.AddSingleton<MqttDriver>();
builder.Services.AddSingleton<ModbusDriver>();
builder.Services.AddSingleton<LibPlcTagDriver>();
builder.Services.AddSingleton<S7NetDriver>();
builder.Services.AddSingleton<SimulatorDriver>();

// Register Poller Drivers
builder.Services.AddSingleton<IProtocolDriver, OpcUaDriverPoller>();
builder.Services.AddSingleton<IProtocolDriver, MqttDriverPoller>();
builder.Services.AddSingleton<IProtocolDriver, ModbusDriverPoller>();
builder.Services.AddSingleton<IProtocolDriver, LibPlcTagDriverPoller>();
builder.Services.AddSingleton<IProtocolDriver, S7DriverPoller>();
builder.Services.AddSingleton<IProtocolDriver, SimulatorDriverPoller>();
builder.Services.AddSingleton<CustomSimulatedDriverPoller>();

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



