using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Storage;
using Microsoft.EntityFrameworkCore;

namespace Pulse.Edge.Agent;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly IConfiguration _configuration;
    private readonly QueueStorageService _storageService;
    private readonly CloudClient _cloudClient;
    private readonly OpcUaDriver _opcUaDriver;
    private readonly MqttDriver _mqttDriver;
    private readonly SyncService _syncService;

    private DeviceConfig? _deviceConfig;
    private string _activeOpcUaEndpoint = string.Empty;
    private string _activeMqttHost = string.Empty;
    private int _activeMqttPort = 0;
    private string _activeMqttTopic = string.Empty;
    private bool _activeMqttIsEnabled = false;
    private bool _activeOpcUaIsEnabled = false;
    private bool _activeModbusIsEnabled = false;

    public Worker(
        ILogger<Worker> logger,
        IConfiguration configuration,
        QueueStorageService storageService,
        CloudClient cloudClient,
        OpcUaDriver opcUaDriver,
        MqttDriver mqttDriver,
        SyncService syncService)
    {
        _logger = logger;
        _configuration = configuration;
        _storageService = storageService;
        _cloudClient = cloudClient;
        _opcUaDriver = opcUaDriver;
        _mqttDriver = mqttDriver;
        _syncService = syncService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PULSE Edge Agent starting up...");

        // 1. Initialize SQLite Database
        _logger.LogInformation("Initializing local SQLite storage...");
        await _storageService.InitializeAsync();
        _logger.LogInformation("SQLite database initialized successfully.");

        // 2. Load Device Config or Register Device
        _deviceConfig = await _storageService.GetDeviceConfigAsync();
        if (_deviceConfig == null)
        {
            _logger.LogWarning("No local configuration found. Initiating first-startup Device Registration Flow...");
            
            // Read Serial Number from App Settings (defaults to standard mock)
            string serial = _configuration["EdgeSettings:SerialNumber"] ?? "PULSE-EDGE-MOCK-999";
            
            // Call simulated Cloud API
            var (apiKey, siteId) = await _cloudClient.RegisterDeviceAsync(serial);

            // Save to SQLite
            _deviceConfig = new DeviceConfig
            {
                Id = Guid.NewGuid().ToString(),
                SerialNumber = serial,
                SiteId = siteId,
                ApiKey = apiKey,
                Version = "1.0.0"
            };

            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            _logger.LogInformation("Device credentials saved locally. DeviceId: {DeviceId}", _deviceConfig.Id);
        }
        else
        {
            _logger.LogInformation("Loaded existing device configuration. DeviceId: {DeviceId}", _deviceConfig.Id);
        }

        // Start Cloud Sync Loop in the background (Non-blocking Task)
        _ = Task.Run(() => _syncService.StartSyncLoopAsync(_deviceConfig.Id, _deviceConfig.ApiKey, stoppingToken), stoppingToken);

        // 3. Connect to Protocols (loaded dynamically from SQLite DB configs)
        using var db = new QueueDbContext();
        var opcUaAdapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == "adp-opcua-1", stoppingToken);
        var mqttAdapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == "adp-mqtt-1", stoppingToken);

        _activeOpcUaEndpoint = opcUaAdapter?.Host ?? "opc.tcp://localhost:4840";
        _activeMqttHost = mqttAdapter?.Host ?? "broker.hivemq.com";
        _activeMqttPort = mqttAdapter?.Port ?? 1883;

        // Find the MQTT data point address to subscribe to
        var mqttDataPoint = await db.DataPoints.FirstOrDefaultAsync(x => x.AdapterId == "adp-mqtt-1", stoppingToken);
        _activeMqttTopic = mqttDataPoint?.Address ?? "pulse/factory/casepacker/temp";

        // Whenever MQTT receives a packet, save it directly to SQLite!
        _mqttDriver.MessageReceivedAsync += async (topic, payload) =>
        {
            _logger.LogInformation("[MQTT Link] Telemetry packet intercepted on topic '{Topic}'. Resolving mapping...", topic);
            
            using var dbLookup = new QueueDbContext();
            var dp = await dbLookup.DataPoints.FirstOrDefaultAsync(x => x.Address == topic);
            if (dp != null && dp.IsEnabled)
            {
                double val = 0;
                double.TryParse(payload, out val);
                double processedVal = (val * dp.ScaleFactor) + dp.Offset;

                dp.LastValue = processedVal.ToString("F2");
                dp.LastError = null;
                dp.LastUpdated = DateTime.UtcNow;

                // Enqueue if stream is mapped and enabled
                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    var parentStream = await dbLookup.DataSources.FirstOrDefaultAsync(x => x.Id == dp.DataSourceId);
                    if (parentStream?.IsEnabled ?? true)
                    {
                        string payloadJson = $"{{\"metric\": \"{dp.Metric}\", \"value\": {processedVal}}}";
                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, payloadJson);
                        _logger.LogInformation("[Queue Buffer] Enqueued MQTT telemetry for Stream {Source} | Metric: {Metric}", dp.DataSourceId, dp.Metric);
                    }
                    else
                    {
                        _logger.LogInformation("[MQTT Link] Telemetry ignored: Stream {Source} is disabled.", dp.DataSourceId);
                    }
                }
                
                dbLookup.DataPoints.Update(dp);
                await dbLookup.SaveChangesAsync();
            }
            else
            {
                _logger.LogWarning("[MQTT Link] No active data point mapped to topic '{Topic}'. Message ignored.", topic);
            }
        };

        _activeOpcUaIsEnabled = opcUaAdapter?.IsEnabled ?? true;
        _activeMqttIsEnabled = mqttAdapter?.IsEnabled ?? true;

        var modbusAdapterInit = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == "adp-modbus-1", stoppingToken);
        _activeModbusIsEnabled = modbusAdapterInit?.IsEnabled ?? true;

        if (_activeOpcUaIsEnabled)
        {
            try
            {
                _opcUaDriver.Connect(_activeOpcUaEndpoint);
                if (opcUaAdapter != null) opcUaAdapter.Status = "Connected";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect OPC UA adapter on startup");
                if (opcUaAdapter != null) opcUaAdapter.Status = "Error";
            }
        }
        else
        {
            if (opcUaAdapter != null) opcUaAdapter.Status = "Disconnected";
        }
        if (opcUaAdapter != null) db.DriverAdapters.Update(opcUaAdapter);
        
        if (_activeMqttIsEnabled)
        {
            try
            {
                await _mqttDriver.ConnectAndSubscribeAsync(_activeMqttHost, _activeMqttPort, _activeMqttTopic);
                if (mqttAdapter != null) mqttAdapter.Status = "Connected";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect MQTT adapter on startup");
                if (mqttAdapter != null) mqttAdapter.Status = "Error";
            }
        }
        else
        {
            if (mqttAdapter != null) mqttAdapter.Status = "Disconnected";
        }
        if (mqttAdapter != null) db.DriverAdapters.Update(mqttAdapter);

        if (modbusAdapterInit != null)
        {
            modbusAdapterInit.Status = _activeModbusIsEnabled ? "Connected" : "Disconnected";
            db.DriverAdapters.Update(modbusAdapterInit);
        }

        // Initialize any user-created custom adapters to Connected/Disconnected in SQLite
        var allAdapters = await db.DriverAdapters.ToListAsync(stoppingToken);
        foreach (var adapter in allAdapters)
        {
            if (adapter.Id != "adp-opcua-1" && adapter.Id != "adp-mqtt-1" && adapter.Id != "adp-modbus-1")
            {
                adapter.Status = adapter.IsEnabled ? "Connected" : "Disconnected";
                db.DriverAdapters.Update(adapter);
            }
        }

        await db.SaveChangesAsync(stoppingToken);

        _logger.LogInformation("PULSE Edge loops active. Running telemetry simulation...");

        // 4. Run loop
        int loopCount = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            loopCount++;

            // Query latest driver configs from shared SQLite database
            using (var dbLoop = new QueueDbContext())
            {
                var opcUaAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == "adp-opcua-1", stoppingToken);
                var mqttAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == "adp-mqtt-1", stoppingToken);

                string latestOpcUaEndpoint = opcUaAdapterLoop?.Host ?? "opc.tcp://localhost:4840";
                string latestMqttHost = mqttAdapterLoop?.Host ?? "broker.hivemq.com";
                int latestMqttPort = mqttAdapterLoop?.Port ?? 1883;
                bool isMqttEnabled = mqttAdapterLoop?.IsEnabled ?? true;
                bool isOpcUaEnabled = opcUaAdapterLoop?.IsEnabled ?? true;

                // Find active MQTT data point address
                var mqttDp = await dbLoop.DataPoints.FirstOrDefaultAsync(x => x.AdapterId == "adp-mqtt-1" && x.IsEnabled, stoppingToken);
                string latestMqttTopic = mqttDp?.Address ?? "pulse/factory/casepacker/temp";

                // 1. Check for MQTT Adapter configuration changes
                if (latestMqttHost != _activeMqttHost || latestMqttPort != _activeMqttPort || latestMqttTopic != _activeMqttTopic || isMqttEnabled != _activeMqttIsEnabled)
                {
                    _logger.LogWarning("[MQTT Link] Configuration change detected in SQLite! Reconnecting driver...");
                    try
                    {
                        await _mqttDriver.DisconnectAsync();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error disconnecting MQTT client");
                    }
                    
                    _activeMqttHost = latestMqttHost;
                    _activeMqttPort = latestMqttPort;
                    _activeMqttTopic = latestMqttTopic;
                    _activeMqttIsEnabled = isMqttEnabled;

                    if (isMqttEnabled)
                    {
                        try
                        {
                            await _mqttDriver.ConnectAndSubscribeAsync(_activeMqttHost, _activeMqttPort, _activeMqttTopic);
                            if (mqttAdapterLoop != null)
                            {
                                mqttAdapterLoop.Status = "Connected";
                                dbLoop.DriverAdapters.Update(mqttAdapterLoop);
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Error reconnecting MQTT client to {Host}:{Port}", _activeMqttHost, _activeMqttPort);
                            if (mqttAdapterLoop != null)
                            {
                                mqttAdapterLoop.Status = "Error";
                                dbLoop.DriverAdapters.Update(mqttAdapterLoop);
                            }
                            _activeMqttIsEnabled = false;
                        }
                    }
                    else
                    {
                        if (mqttAdapterLoop != null)
                        {
                            mqttAdapterLoop.Status = "Disconnected";
                            dbLoop.DriverAdapters.Update(mqttAdapterLoop);
                        }
                    }
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 2. Check for OPC UA Adapter configuration changes
                if (latestOpcUaEndpoint != _activeOpcUaEndpoint || isOpcUaEnabled != _activeOpcUaIsEnabled)
                {
                    _logger.LogWarning("[OPC UA Driver] Configuration change detected in SQLite! Re-initializing adapter...");
                    _activeOpcUaEndpoint = latestOpcUaEndpoint;
                    _activeOpcUaIsEnabled = isOpcUaEnabled;
                    
                    if (isOpcUaEnabled)
                    {
                        try
                        {
                            _opcUaDriver.Connect(_activeOpcUaEndpoint);
                            if (opcUaAdapterLoop != null)
                            {
                                opcUaAdapterLoop.Status = "Connected";
                                dbLoop.DriverAdapters.Update(opcUaAdapterLoop);
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Error reconnecting OPC UA client");
                            if (opcUaAdapterLoop != null)
                            {
                                opcUaAdapterLoop.Status = "Error";
                                dbLoop.DriverAdapters.Update(opcUaAdapterLoop);
                            }
                            _activeOpcUaIsEnabled = false;
                        }
                    }
                    else
                    {
                        if (opcUaAdapterLoop != null)
                        {
                            opcUaAdapterLoop.Status = "Disconnected";
                            dbLoop.DriverAdapters.Update(opcUaAdapterLoop);
                        }
                    }
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 2.5 Check for Modbus Adapter or Custom adapter status changes
                var modbusAdapter = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == "adp-modbus-1", stoppingToken);
                if (modbusAdapter != null && modbusAdapter.IsEnabled != _activeModbusIsEnabled)
                {
                    _activeModbusIsEnabled = modbusAdapter.IsEnabled;
                    modbusAdapter.Status = _activeModbusIsEnabled ? "Connected" : "Disconnected";
                    dbLoop.DriverAdapters.Update(modbusAdapter);
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                var customAdapters = await dbLoop.DriverAdapters
                    .Where(x => x.Id != "adp-opcua-1" && x.Id != "adp-mqtt-1" && x.Id != "adp-modbus-1")
                    .ToListAsync(stoppingToken);
                bool anyCustomChanged = false;
                foreach (var adapter in customAdapters)
                {
                    string expectedStatus = adapter.IsEnabled ? "Connected" : "Disconnected";
                    if (adapter.Status != expectedStatus)
                    {
                        adapter.Status = expectedStatus;
                        dbLoop.DriverAdapters.Update(adapter);
                        anyCustomChanged = true;
                    }
                }
                if (anyCustomChanged)
                {
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 3. Simulating Telemetry Read from OPC UA (if enabled)
                if (isOpcUaEnabled)
                {
                    // Find all active OPC UA data points to read
                    var opcUaDps = await dbLoop.DataPoints
                        .Where(x => x.AdapterId == "adp-opcua-1" && x.IsEnabled)
                        .ToListAsync(stoppingToken);

                    foreach (var dp in opcUaDps)
                    {
                        string metricNode = dp.Address;
                        double currentVal = _opcUaDriver.ReadMetric(metricNode);
                        double processedVal = (currentVal * dp.ScaleFactor) + dp.Offset;

                        _logger.LogInformation("[Telemetry Read] Node: {Node} | Raw: {Raw} | Processed: {Value}", metricNode, currentVal, processedVal);

                        dp.LastValue = processedVal.ToString("F2");
                        dp.LastError = null;
                        dp.LastUpdated = DateTime.UtcNow;

                        // Enqueue if stream is mapped and enabled
                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            var parentStream = await dbLoop.DataSources.FirstOrDefaultAsync(x => x.Id == dp.DataSourceId, stoppingToken);
                            if (parentStream?.IsEnabled ?? true)
                            {
                                string telemetryPayload = $"{{\"metric\": \"{dp.Metric}\", \"value\": {processedVal}}}";
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, telemetryPayload);
                                _logger.LogInformation("[Queue Buffer] Enqueued OPC UA telemetry for Stream {Source} | Metric: {Metric}", dp.DataSourceId, dp.Metric);
                            }
                        }
                        dbLoop.DataPoints.Update(dp);
                    }
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 4. Simulating publishing MQTT test messages (if enabled and mapped)
                if (isMqttEnabled && loopCount % 2 == 0 && mqttDp != null)
                {
                    // Publish raw value which will be received by MessageReceivedAsync above
                    string mqttTestPayload = $"{Random.Shared.Next(45, 65)}";
                    try
                    {
                        await _mqttDriver.PublishAsync(latestMqttTopic, mqttTestPayload);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to publish test MQTT message");
                    }
                }

                // 5. Simulating Modbus TCP meter readings (if enabled)
                if (modbusAdapter != null && modbusAdapter.IsEnabled && loopCount % 2 == 0)
                {
                    var modbusDps = await dbLoop.DataPoints
                        .Where(x => x.AdapterId == "adp-modbus-1" && x.IsEnabled)
                        .ToListAsync(stoppingToken);

                    foreach (var dp in modbusDps)
                      {
                        // Simulate a reading (e.g. random value)
                        double rawVal = dp.Metric == "voltage" ? Random.Shared.Next(215, 230) : Random.Shared.Next(1500, 3500);
                        double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;

                        _logger.LogInformation("[Modbus Read] Reg: {Reg} | Raw: {Raw} | Processed: {Value}", dp.Address, rawVal, processedVal);

                        dp.LastValue = processedVal.ToString("F2");
                        dp.LastError = null;
                        dp.LastUpdated = DateTime.UtcNow;

                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            var parentStream = await dbLoop.DataSources.FirstOrDefaultAsync(x => x.Id == dp.DataSourceId, stoppingToken);
                            if (parentStream?.IsEnabled ?? true)
                            {
                                string telemetryPayload = $"{{\"metric\": \"{dp.Metric}\", \"value\": {processedVal}}}";
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, telemetryPayload);
                                _logger.LogInformation("[Queue Buffer] Enqueued Modbus telemetry for Stream {Source} | Metric: {Metric}", dp.DataSourceId, dp.Metric);
                            }
                        }
                        dbLoop.DataPoints.Update(dp);
                    }
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 5.5 Simulating readings for other custom/user-created adapters
                var otherAdaptersSim = await dbLoop.DriverAdapters
                    .Where(x => x.Id != "adp-opcua-1" && x.Id != "adp-mqtt-1" && x.Id != "adp-modbus-1" && x.IsEnabled)
                    .ToListAsync(stoppingToken);

                foreach (var adapterSim in otherAdaptersSim)
                {
                    var customDps = await dbLoop.DataPoints
                        .Where(x => x.AdapterId == adapterSim.Id && x.IsEnabled)
                        .ToListAsync(stoppingToken);

                    foreach (var dp in customDps)
                    {
                        double rawVal = Math.Round(Random.Shared.NextDouble() * 100.0, 2);
                        double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;

                        dp.LastValue = processedVal.ToString("F2");
                        dp.LastError = null;
                        dp.LastUpdated = DateTime.UtcNow;

                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            var parentStream = await dbLoop.DataSources.FirstOrDefaultAsync(x => x.Id == dp.DataSourceId, stoppingToken);
                            if (parentStream?.IsEnabled ?? true)
                            {
                                string telemetryPayload = $"{{\"metric\": \"{dp.Metric}\", \"value\": {processedVal}}}";
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, telemetryPayload);
                            }
                        }
                        dbLoop.DataPoints.Update(dp);
                    }
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }
            }

            // Every 15 seconds, simulate sending a heartbeat and enqueuing an event
            if (loopCount % 3 == 0)
            {
                await _cloudClient.SendHeartbeatAsync(_deviceConfig.Id, _deviceConfig.ApiKey, _deviceConfig.Version);
                
                // Enqueue state change event to local database
                string eventPayload = $"{{\"state\": \"Running\", \"cycle\": {loopCount}}}";
                await _storageService.EnqueueEventAsync("MachineState", eventPayload);
                _logger.LogInformation("[Queue Buffer] Enqueued machine state event to SQLite.");
            }

            await Task.Delay(5000, stoppingToken);
        }
    }
}

