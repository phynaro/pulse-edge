using Pulse.Edge.Agent;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Protocols.Modbus;
using Pulse.Edge.Protocols.LibPlcTag;

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

// Register Background Worker
builder.Services.AddHostedService<Worker>();

var host = builder.Build();
host.Run();
