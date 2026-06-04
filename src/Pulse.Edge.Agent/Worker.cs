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
using Pulse.Edge.Protocols.Modbus;
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
    private readonly ModbusDriver _modbusDriver;
    private readonly SyncService _syncService;

    private DeviceConfig? _deviceConfig;
    private string _activeOpcUaEndpoint = string.Empty;
    private string _activeMqttHost = string.Empty;
    private int _activeMqttPort = 0;
    private List<string> _activeMqttTopics = new();
    private string _activeModbusHost = string.Empty;
    private int _activeModbusPort = 0;
    private bool _activeMqttIsEnabled = false;
    private bool _activeOpcUaIsEnabled = false;
    private bool _activeModbusIsEnabled = false;
    private bool _isMqttConnecting = false;
    private string _opcUaAdapterId = "adp-opcua-1";
    private string _mqttAdapterId = "adp-mqtt-1";
    private string _modbusAdapterId = "adp-modbus-1";

    private DateTime _lastMqttPublish = DateTime.MinValue;
    private DateTime _lastHeartbeat = DateTime.MinValue;
    private DateTime _lastConfigReload = DateTime.MinValue;
    private readonly Dictionary<string, DateTime> _lastDbWriteTimes = new();
    private List<DataPoint> _cachedDataPoints = new();
    private List<DriverAdapter> _cachedAdapters = new();

    private static string? GetJsonValueByPath(string json, string path)
    {
        if (string.IsNullOrWhiteSpace(json) || string.IsNullOrWhiteSpace(path))
            return null;

        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            var element = doc.RootElement;
            
            var cleanPath = path;
            if (cleanPath.StartsWith("$.")) cleanPath = cleanPath[2..];
            else if (cleanPath.StartsWith("$")) cleanPath = cleanPath[1..];
            
            var parts = cleanPath.Split('.', StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in parts)
            {
                var cleanPart = part;
                int arrayIndex = -1;
                
                if (part.EndsWith("]") && part.Contains("["))
                {
                    int openBracket = part.IndexOf("[");
                    cleanPart = part[..openBracket];
                    string indexStr = part[(openBracket + 1)..^1];
                    int.TryParse(indexStr, out arrayIndex);
                }

                if (element.ValueKind == System.Text.Json.JsonValueKind.Object && element.TryGetProperty(cleanPart, out var child))
                {
                    element = child;
                }
                else
                {
                    return null;
                }

                if (arrayIndex >= 0)
                {
                    if (element.ValueKind == System.Text.Json.JsonValueKind.Array && arrayIndex < element.GetArrayLength())
                    {
                        element = element[arrayIndex];
                    }
                    else
                    {
                        return null;
                    }
                }
            }
            
            return element.ValueKind switch
            {
                System.Text.Json.JsonValueKind.String => element.GetString(),
                System.Text.Json.JsonValueKind.Number => element.GetRawText(),
                System.Text.Json.JsonValueKind.True => "true",
                System.Text.Json.JsonValueKind.False => "false",
                System.Text.Json.JsonValueKind.Null => null,
                _ => element.GetRawText()
            };
        }
        catch
        {
            return null;
        }
    }

    public Worker(
        ILogger<Worker> logger,
        IConfiguration configuration,
        QueueStorageService storageService,
        CloudClient cloudClient,
        OpcUaDriver opcUaDriver,
        MqttDriver mqttDriver,
        ModbusDriver modbusDriver,
        SyncService syncService)
    {
        _logger = logger;
        _configuration = configuration;
        _storageService = storageService;
        _cloudClient = cloudClient;
        _opcUaDriver = opcUaDriver;
        _mqttDriver = mqttDriver;
        _modbusDriver = modbusDriver;
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
        string configApiKey = _configuration["Cloud:ApiKey"] ?? "";
        string configBaseUrl = _configuration["Cloud:BaseUrl"] ?? "http://localhost:3000";
        string currentBaseUrl = _deviceConfig?.CloudEndpoint ?? configBaseUrl;

        if (_deviceConfig == null)
        {
            _logger.LogWarning("No local configuration found. Initiating first-startup Device Registration Flow...");
            
            string serial = _configuration["EdgeSettings:SerialNumber"] ?? "PULSE-EDGE-MOCK-999";
            string deviceId = Guid.NewGuid().ToString();
            
            // Call real Cloud API to register
            var (edgeId, status) = await _cloudClient.RegisterDeviceAsync(currentBaseUrl, deviceId, Environment.MachineName, "1.0.0");

            _deviceConfig = new DeviceConfig
            {
                Id = deviceId,
                CloudEdgeId = edgeId,
                SerialNumber = serial,
                SiteId = "",
                ApiKey = configApiKey,
                CloudEndpoint = currentBaseUrl,
                Version = "1.0.0",
                CloudStatus = status == "active" ? "Connected" : "PendingApproval"
            };

            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            _logger.LogInformation("Device registered with cloud. DeviceId: {DeviceId}, CloudEdgeId: {EdgeId}, Status: {Status}", _deviceConfig.Id, _deviceConfig.CloudEdgeId, status);
        }
        else
        {
            _logger.LogInformation("Loaded existing device configuration. DeviceId: {DeviceId}", _deviceConfig.Id);
            
            if (string.IsNullOrEmpty(_deviceConfig.ApiKey) && !string.IsNullOrEmpty(configApiKey))
            {
                _deviceConfig.ApiKey = configApiKey;
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                _logger.LogInformation("Imported API key from configuration.");
            }

            if (_configuration["Cloud:BaseUrl"] != null && _deviceConfig.CloudEndpoint != _configuration["Cloud:BaseUrl"])
            {
                _deviceConfig.CloudEndpoint = _configuration["Cloud:BaseUrl"]!;
                currentBaseUrl = _deviceConfig.CloudEndpoint;
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                _logger.LogInformation("Updated CloudEndpoint from configuration overrides: {CloudEndpoint}", _deviceConfig.CloudEndpoint);
            }
        }

        // Check if we have an API Key configured
        if (string.IsNullOrEmpty(_deviceConfig.ApiKey))
        {
            _logger.LogWarning("No API Key configured. Device is pending approval. Please copy the API key from the PULSE Cloud Web UI and add it to config/env.");
            
            if (_deviceConfig.CloudStatus != "Revoked")
            {
                _deviceConfig.CloudStatus = "PendingApproval";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }

            // Call register again (it is idempotent) to verify status or update agent version
            var (edgeId, status) = await _cloudClient.RegisterDeviceAsync(currentBaseUrl, _deviceConfig.Id, Environment.MachineName, "1.0.0");
            if (!string.IsNullOrEmpty(edgeId) && (_deviceConfig.CloudEdgeId != edgeId || _deviceConfig.CloudStatus != "PendingApproval"))
            {
                _deviceConfig.CloudEdgeId = edgeId;
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }
        }
        else
        {
            _logger.LogInformation("API Key is present. Fetching configuration from PULSE Cloud...");
            
            var configResult = await _cloudClient.GetConfigAsync(currentBaseUrl, _deviceConfig.ApiKey);
            if (configResult.Success)
            {
                _logger.LogInformation("Successfully retrieved config. Assigned Site: {SiteName} ({SiteId})", 
                    configResult.SiteName, configResult.SiteId);
                
                _deviceConfig.SiteId = configResult.SiteId;
                _deviceConfig.SiteName = configResult.SiteName;
                _deviceConfig.CloudStatus = "Connected";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);

                // Push logical data sources to cloud control plane
                await PushDataSourcesToCloudAsync(currentBaseUrl, _deviceConfig.ApiKey);
            }
            else if (configResult.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _logger.LogError("API Key is invalid or has been revoked (401 Unauthorized). Resetting API Key. Re-approval required.");
                _deviceConfig.ApiKey = "";
                _deviceConfig.SiteId = "";
                _deviceConfig.SiteName = "";
                _deviceConfig.CloudStatus = "Revoked";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }
            else
            {
                _logger.LogWarning("Failed to fetch configuration from cloud (Status Code: {StatusCode}). Continuing with local cached config.", configResult.StatusCode);
                _deviceConfig.CloudStatus = "Disconnected";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }
        }

        // Start Cloud Sync Loop in the background (Non-blocking Task)
        _ = Task.Run(() => _syncService.StartSyncLoopAsync(_deviceConfig.Id, _deviceConfig.ApiKey, stoppingToken), stoppingToken);

        // 3. Connect to Protocols (loaded dynamically from SQLite DB configs)
        using var db = new QueueDbContext();
        var opcUaAdapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "OPC_UA", stoppingToken);
        var mqttAdapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "MQTT", stoppingToken);

        _opcUaAdapterId = opcUaAdapter?.Id ?? "adp-opcua-1";
        _mqttAdapterId = mqttAdapter?.Id ?? "adp-mqtt-1";

        _activeOpcUaEndpoint = opcUaAdapter?.Host ?? "opc.tcp://localhost:4840";
        _activeMqttHost = mqttAdapter?.Host ?? "broker.hivemq.com";
        _activeMqttPort = mqttAdapter?.Port ?? 1883;

        // Find all active MQTT topics
        var mqttDataPoints = await db.DataPoints
            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled)
            .ToListAsync(stoppingToken);
        _activeMqttTopics = mqttDataPoints
            .Select(x => x.Address)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        // Whenever MQTT receives a packet, save it directly to SQLite!
        _mqttDriver.MessageReceivedAsync += async (topic, payload) =>
        {
            _logger.LogInformation("[MQTT Link] Telemetry packet intercepted on topic '{Topic}'. Resolving mapping...", topic);

            // Capture ONE timestamp for this entire MQTT message so all DataPoints
            // mapped to the same topic share the same key and merge into one row.
            var receivedAt = DateTime.UtcNow;

            using var dbLookup = new QueueDbContext();
            var matchingDps = await dbLookup.DataPoints
                .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && x.Address == topic)
                .ToListAsync();

            if (matchingDps.Count == 0)
            {
                _logger.LogWarning("[MQTT Link] No active data point mapped to topic '{Topic}'. Message ignored.", topic);
                return;
            }

            System.Text.Json.JsonDocument? jsonDoc = null;
            bool anyJson = matchingDps.Any(x => x.MqttParseMode == "JSON");
            if (anyJson)
            {
                try
                {
                    jsonDoc = System.Text.Json.JsonDocument.Parse(payload);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[MQTT Link] Failed to parse payload as JSON on topic '{Topic}': {Payload}", topic, payload);
                }
            }

            try
            {
                foreach (var dp in matchingDps)
                {
                    string? extractedValue = null;
                    if (dp.MqttParseMode == "JSON")
                    {
                        if (jsonDoc == null)
                        {
                            dp.LastError = "Failed to parse JSON payload";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = receivedAt;
                            dbLookup.DataPoints.Update(dp);
                            continue;
                        }
                        
                        extractedValue = GetJsonValueByPath(payload, dp.MqttJsonPath ?? string.Empty);
                        if (extractedValue == null)
                        {
                            dp.LastError = $"JSON path '{dp.MqttJsonPath}' not found";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = receivedAt;
                            dbLookup.DataPoints.Update(dp);
                            continue;
                        }
                    }
                    else
                    {
                        extractedValue = payload;
                    }

                    double val;
                    bool parseSuccess = false;
                    if (double.TryParse(extractedValue, out val))
                    {
                        parseSuccess = true;
                    }
                    else if (bool.TryParse(extractedValue, out bool boolVal))
                    {
                        val = boolVal ? 1.0 : 0.0;
                        parseSuccess = true;
                    }

                    if (parseSuccess)
                    {
                        double processedVal = (val * dp.ScaleFactor) + dp.Offset;
                        dp.LastValue = processedVal.ToString("F2");
                        dp.LastError = null;
                        dp.ConsecutiveFailures = 0;
                        dp.LastUpdated = receivedAt;

                        // Enqueue if stream is mapped and enabled
                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                            {
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, processedVal);
                                _logger.LogInformation("[Queue Buffer] Enqueued MQTT telemetry for Stream {Source} | Metric: {Metric} | Val: {Val}", dp.DataSourceId, dp.Metric, processedVal);
                            }
                            else
                            {
                                _logger.LogInformation("[MQTT Link] Telemetry ignored: Stream {Source} is disabled.", dp.DataSourceId);
                            }
                        }
                    }
                    else
                    {
                        dp.LastError = $"Failed to parse extracted value '{extractedValue}' as double or boolean";
                        dp.ConsecutiveFailures++;
                        dp.LastUpdated = receivedAt;
                    }
                    
                    dbLookup.DataPoints.Update(dp);
                }
                
                await dbLookup.SaveChangesAsync();
            }
            finally
            {
                jsonDoc?.Dispose();
            }
        };

        _activeOpcUaIsEnabled = opcUaAdapter?.IsEnabled ?? true;
        _activeMqttIsEnabled = mqttAdapter?.IsEnabled ?? true;

        var modbusAdapterInit = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "MODBUS_TCP", stoppingToken);
        _modbusAdapterId = modbusAdapterInit?.Id ?? "adp-modbus-1";
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
            if (mqttAdapter != null) mqttAdapter.Status = "Connecting";
            ConnectMqttBackground(_activeMqttHost, _activeMqttPort, _activeMqttTopics);
        }
        else
        {
            if (mqttAdapter != null) mqttAdapter.Status = "Disconnected";
        }
        if (mqttAdapter != null) db.DriverAdapters.Update(mqttAdapter);

        _activeModbusHost = modbusAdapterInit?.Host ?? "127.0.0.1";
        _activeModbusPort = modbusAdapterInit?.Port ?? 502;

        if (_activeModbusIsEnabled)
        {
            try
            {
                _modbusDriver.Connect(_activeModbusHost, _activeModbusPort);
                if (modbusAdapterInit != null) modbusAdapterInit.Status = "Connected";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect Modbus TCP adapter on startup");
                if (modbusAdapterInit != null) modbusAdapterInit.Status = "Error";
            }
        }
        else
        {
            if (modbusAdapterInit != null) modbusAdapterInit.Status = "Disconnected";
        }
        if (modbusAdapterInit != null) db.DriverAdapters.Update(modbusAdapterInit);

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

        int loopCount = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            loopCount++;
            var now = DateTime.UtcNow;

            // 1. Reload configuration and check adapter updates from SQLite DB every 2 seconds
            if ((now - _lastConfigReload).TotalSeconds >= 2)
            {
                _lastConfigReload = now;
                
                var dbConfig = await _storageService.GetDeviceConfigAsync();
                if (dbConfig != null && _deviceConfig != null)
                {
                    bool endpointChanged = dbConfig.CloudEndpoint != _deviceConfig.CloudEndpoint;
                    bool apiKeyChanged = dbConfig.ApiKey != _deviceConfig.ApiKey;

                    if (endpointChanged || apiKeyChanged)
                    {
                        _logger.LogInformation("System settings update detected from SQLite! Updating Edge Agent runtime. Endpoint: {Endpoint}, API Key updated.", 
                            dbConfig.CloudEndpoint);

                        if (!string.IsNullOrEmpty(dbConfig.ApiKey) && (apiKeyChanged || endpointChanged))
                        {
                            _logger.LogInformation("API key is present or updated. Fetching config from PULSE Cloud dynamically...");
                            // Fetch config in the background
                            _ = Task.Run(async () =>
                            {
                                try
                                {
                                    var configResult = await _cloudClient.GetConfigAsync(dbConfig.CloudEndpoint, dbConfig.ApiKey);
                                    if (configResult.Success)
                                    {
                                        _logger.LogInformation("Successfully retrieved dynamic config. Assigned Site: {SiteName}", configResult.SiteName);
                                        dbConfig.SiteId = configResult.SiteId;
                                        dbConfig.SiteName = configResult.SiteName;
                                        dbConfig.CloudStatus = "Connected";
                                        await _storageService.SaveDeviceConfigAsync(dbConfig);
                                        
                                        // Push logical data sources to cloud control plane
                                        await PushDataSourcesToCloudAsync(dbConfig.CloudEndpoint, dbConfig.ApiKey);
                                    }
                                    else if (configResult.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                                    {
                                        _logger.LogError("API Key has been rejected as invalid or revoked by cloud.");
                                        dbConfig.ApiKey = "";
                                        dbConfig.SiteId = "";
                                        dbConfig.SiteName = "";
                                        dbConfig.CloudStatus = "Revoked";
                                        await _storageService.SaveDeviceConfigAsync(dbConfig);
                                    }
                                    else
                                    {
                                        _logger.LogWarning("Failed to retrieve config dynamically from cloud (Status Code: {StatusCode}).", configResult.StatusCode);
                                        dbConfig.CloudStatus = "Disconnected";
                                        await _storageService.SaveDeviceConfigAsync(dbConfig);
                                    }
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogError(ex, "Failed to pull config or declare data sources on dynamic settings update");
                                }
                            });
                        }
                    }
                    _deviceConfig = dbConfig;
                }

                using var dbLoop = new QueueDbContext();

                var opcUaAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "OPC_UA", stoppingToken);
                var mqttAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "MQTT", stoppingToken);
                var modbusAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "MODBUS_TCP", stoppingToken);

                _opcUaAdapterId = opcUaAdapterLoop?.Id ?? "adp-opcua-1";
                _mqttAdapterId = mqttAdapterLoop?.Id ?? "adp-mqtt-1";
                _modbusAdapterId = modbusAdapterLoop?.Id ?? "adp-modbus-1";

                string latestOpcUaEndpoint = opcUaAdapterLoop?.Host ?? "opc.tcp://localhost:4840";
                string latestMqttHost = mqttAdapterLoop?.Host ?? "broker.hivemq.com";
                int latestMqttPort = mqttAdapterLoop?.Port ?? 1883;
                bool isMqttEnabled = mqttAdapterLoop?.IsEnabled ?? true;
                bool isOpcUaEnabled = opcUaAdapterLoop?.IsEnabled ?? true;

                // Find active MQTT data points and extract unique topics
                var mqttDps = await dbLoop.DataPoints
                    .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled)
                    .ToListAsync(stoppingToken);
                var latestMqttTopics = mqttDps
                    .Select(x => x.Address)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct()
                    .OrderBy(x => x)
                    .ToList();

                bool topicsChanged = !latestMqttTopics.SequenceEqual(_activeMqttTopics);

                // 1. Check for MQTT Adapter configuration changes
                if (latestMqttHost != _activeMqttHost || latestMqttPort != _activeMqttPort || topicsChanged || isMqttEnabled != _activeMqttIsEnabled)
                {
                    // If ONLY topics changed, and we are already connected, and broker config didn't change, we subscribe/unsubscribe dynamically
                    if (topicsChanged && 
                        latestMqttHost == _activeMqttHost && 
                        latestMqttPort == _activeMqttPort && 
                        isMqttEnabled == _activeMqttIsEnabled && 
                        isMqttEnabled && 
                        _mqttDriver.IsConnected)
                    {
                        _logger.LogInformation("[MQTT Link] Subscriptions change detected in SQLite. Applying changes dynamically without reconnecting...");
                        var newTopics = latestMqttTopics.Except(_activeMqttTopics).ToList();
                        var removedTopics = _activeMqttTopics.Except(latestMqttTopics).ToList();

                        foreach (var topic in removedTopics)
                        {
                            try
                            {
                                await _mqttDriver.UnsubscribeAsync(topic);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "Error unsubscribing from topic {Topic}", topic);
                            }
                        }

                        foreach (var topic in newTopics)
                        {
                            try
                            {
                                await _mqttDriver.SubscribeAsync(topic);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "Error subscribing to topic {Topic}", topic);
                            }
                        }

                        _activeMqttTopics = latestMqttTopics;
                    }
                    else
                    {
                        _logger.LogWarning("[MQTT Link] Configuration or subscription change detected in SQLite! Reconnecting driver...");
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
                        _activeMqttTopics = latestMqttTopics;
                        _activeMqttIsEnabled = isMqttEnabled;

                        if (isMqttEnabled)
                        {
                            if (mqttAdapterLoop != null)
                            {
                                mqttAdapterLoop.Status = "Connecting";
                                dbLoop.DriverAdapters.Update(mqttAdapterLoop);
                            }
                            ConnectMqttBackground(_activeMqttHost, _activeMqttPort, _activeMqttTopics);
                        }
                        else
                        {
                            if (mqttAdapterLoop != null)
                            {
                                mqttAdapterLoop.Status = "Disconnected";
                                dbLoop.DriverAdapters.Update(mqttAdapterLoop);
                            }
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

                // 2.5 Check for Modbus Adapter configuration changes
                string latestModbusHost = modbusAdapterLoop?.Host ?? "127.0.0.1";
                int latestModbusPort = modbusAdapterLoop?.Port ?? 502;
                bool isModbusEnabled = modbusAdapterLoop?.IsEnabled ?? true;

                if (modbusAdapterLoop != null && (latestModbusHost != _activeModbusHost || latestModbusPort != _activeModbusPort || isModbusEnabled != _activeModbusIsEnabled))
                {
                    _logger.LogWarning("[Modbus Link] Configuration change detected in SQLite! Reconnecting driver...");
                    try
                    {
                        _modbusDriver.Disconnect();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error disconnecting Modbus TCP client");
                    }

                    _activeModbusHost = latestModbusHost;
                    _activeModbusPort = latestModbusPort;
                    _activeModbusIsEnabled = isModbusEnabled;

                    if (isModbusEnabled)
                    {
                        try
                        {
                            _modbusDriver.Connect(_activeModbusHost, _activeModbusPort);
                            modbusAdapterLoop.Status = "Connected";
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Error reconnecting Modbus TCP client to {Host}:{Port}", _activeModbusHost, _activeModbusPort);
                            modbusAdapterLoop.Status = "Error";
                            _activeModbusIsEnabled = isModbusEnabled;
                        }
                    }
                    else
                    {
                        modbusAdapterLoop.Status = "Disconnected";
                    }

                    dbLoop.DriverAdapters.Update(modbusAdapterLoop);
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 2.5 Automatic OPC UA Reconnection Loop
                if (_activeOpcUaIsEnabled && !_opcUaDriver.IsConnected)
                {
                    _logger.LogWarning("[OPC UA Link] Driver is disconnected. Attempting automatic reconnection to {Endpoint}...", _activeOpcUaEndpoint);
                    try
                    {
                        _opcUaDriver.Connect(_activeOpcUaEndpoint);
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _opcUaAdapterId, stoppingToken);
                        if (adapterUpdate != null && adapterUpdate.Status != "Connected")
                        {
                            adapterUpdate.Status = "Connected";
                            dbLoop.DriverAdapters.Update(adapterUpdate);
                            await dbLoop.SaveChangesAsync(stoppingToken);
                        }
                        _logger.LogInformation("[OPC UA Link] Automatic reconnection successful!");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError("[OPC UA Link] Reconnection attempt failed: {Message}", ex.Message);
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _opcUaAdapterId, stoppingToken);
                        if (adapterUpdate != null && adapterUpdate.Status != "Error")
                        {
                            adapterUpdate.Status = "Error";
                            dbLoop.DriverAdapters.Update(adapterUpdate);
                            await dbLoop.SaveChangesAsync(stoppingToken);
                        }
                    }
                }

                // 2.55 Automatic MQTT Reconnection Loop
                if (_activeMqttIsEnabled && !_mqttDriver.IsConnected && !_isMqttConnecting)
                {
                    _logger.LogWarning("[MQTT Link] Driver is disconnected. Attempting automatic reconnection to {Host}:{Port}...", _activeMqttHost, _activeMqttPort);
                    ConnectMqttBackground(_activeMqttHost, _activeMqttPort, _activeMqttTopics);
                }

                // 2.6 Automatic Modbus Reconnection Loop
                if (_activeModbusIsEnabled && !_modbusDriver.IsConnected)
                {
                    _logger.LogWarning("[Modbus Link] Driver is disconnected. Attempting automatic reconnection to {Host}:{Port}...", _activeModbusHost, _activeModbusPort);
                    try
                    {
                        _modbusDriver.Connect(_activeModbusHost, _activeModbusPort);
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _modbusAdapterId, stoppingToken);
                        if (adapterUpdate != null && adapterUpdate.Status != "Connected")
                        {
                            adapterUpdate.Status = "Connected";
                            dbLoop.DriverAdapters.Update(adapterUpdate);
                            await dbLoop.SaveChangesAsync(stoppingToken);
                        }
                        _logger.LogInformation("[Modbus Link] Automatic reconnection successful!");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError("[Modbus Link] Reconnection attempt failed: {Message}", ex.Message);
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _modbusAdapterId, stoppingToken);
                        if (adapterUpdate != null && adapterUpdate.Status != "Error")
                        {
                            adapterUpdate.Status = "Error";
                            dbLoop.DriverAdapters.Update(adapterUpdate);
                            await dbLoop.SaveChangesAsync(stoppingToken);
                        }
                    }
                }

                var customAdapters = await dbLoop.DriverAdapters
                    .Where(x => x.Id != _opcUaAdapterId && x.Id != _mqttAdapterId && x.Id != _modbusAdapterId)
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

                // Sync configs to in-memory cache lists
                var dbDps = await dbLoop.DataPoints.ToListAsync(stoppingToken);
                var dbAdapters = await dbLoop.DriverAdapters.ToListAsync(stoppingToken);

                _cachedAdapters = dbAdapters;

                var newCacheList = new List<DataPoint>();
                foreach (var dbDp in dbDps)
                {
                    var existing = _cachedDataPoints.FirstOrDefault(x => x.Id == dbDp.Id);
                    if (existing != null)
                    {
                        existing.AdapterId = dbDp.AdapterId;
                        existing.DataSourceId = dbDp.DataSourceId;
                        existing.Metric = dbDp.Metric;
                        existing.Address = dbDp.Address;
                        existing.DataType = dbDp.DataType;
                        existing.ScanIntervalMs = dbDp.ScanIntervalMs;
                        existing.ScaleFactor = dbDp.ScaleFactor;
                        existing.Offset = dbDp.Offset;
                        existing.IsEnabled = dbDp.IsEnabled;
                        existing.ByteOrder = dbDp.ByteOrder;
                        if (existing.LastUpdated == null)
                        {
                            existing.LastValue = dbDp.LastValue;
                            existing.LastError = dbDp.LastError;
                            existing.LastUpdated = dbDp.LastUpdated;
                            existing.ConsecutiveFailures = dbDp.ConsecutiveFailures;
                        }
                        newCacheList.Add(existing);
                    }
                    else
                    {
                        newCacheList.Add(dbDp);
                    }
                }
                _cachedDataPoints = newCacheList;
            }

            // 2. Active Telemetry Polling (ticks every 100ms based on ScanIntervalMs)
            var dirtyDps = new System.Collections.Concurrent.ConcurrentBag<DataPoint>();

            // Group the due data points by AdapterId to execute different adapters in parallel
            var dueGroups = _cachedDataPoints
                .Where(dp => dp.IsEnabled)
                .GroupBy(dp => dp.AdapterId)
                .ToList();

            var pollTasks = dueGroups.Select(async group =>
            {
                var adapter = _cachedAdapters.FirstOrDefault(a => a.Id == group.Key);
                if (adapter == null || !adapter.IsEnabled) return;
                if (adapter.Protocol == "MQTT") return; // MQTT is purely event-driven

                // ── Modbus TCP: use block-read optimized path ─────────────────────
                if (adapter.Protocol == "MODBUS_TCP" && _activeModbusIsEnabled && _modbusDriver.IsConnected)
                {
                    byte unitId = GetModbusUnitId(adapter);
                    await PollModbusGroupAsync(group, unitId, now, dirtyDps, stoppingToken);
                    return;
                }

                // ── OPC UA: collect all due tags → single batched Read call ─────
                if (adapter.Protocol == "OPC_UA" && _activeOpcUaIsEnabled)
                {
                    // Determine which data points are due for polling
                    var dueDps = group.Where(dp =>
                    {
                        int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
                        int effectiveInterval = dp.ConsecutiveFailures > 0
                            ? baseInterval * (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6))
                            : baseInterval;
                        return dp.LastUpdated == null || (now - dp.LastUpdated.Value).TotalMilliseconds >= effectiveInterval;
                    }).ToList();

                    if (dueDps.Count > 0)
                    {
                        var nodeIds = dueDps.Select(dp => dp.Address).ToList();

                        // Single OPC UA Read call for all due nodes
                        Dictionary<string, OpcUaReadResult> batchResult;
                        try
                        {
                            batchResult = _opcUaDriver.ReadMetricsBatch(nodeIds);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "OPC UA batch read failed for adapter {AdapterId}", adapter.Id);
                            foreach (var dp in dueDps)
                            {
                                dp.LastError = ex.Message;
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);
                            }

                            // Also, if the batch read failed completely (exception thrown),
                            // check if the driver connection was lost, to update adapter status
                            if (!_opcUaDriver.IsConnected)
                            {
                                using var dbUpdate = new QueueDbContext();
                                var adpUpdate = await dbUpdate.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                                if (adpUpdate != null && adpUpdate.Status != "Error")
                                {
                                    adpUpdate.Status = "Error";
                                    dbUpdate.DriverAdapters.Update(adpUpdate);
                                    await dbUpdate.SaveChangesAsync(stoppingToken);
                                }
                            }
                            return;
                        }

                        foreach (var dp in dueDps)
                        {
                            if (!batchResult.TryGetValue(dp.Address, out var readRes) || readRes == null)
                            {
                                dp.LastError = "Tag value was not returned in batch result";
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);
                                continue;
                            }

                            if (!readRes.Success)
                            {
                                dp.LastError = readRes.ErrorMessage ?? "Unknown OPC UA read error";
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);
                                continue;
                            }

                            try
                            {
                                double currentVal = readRes.Value;
                                double processedVal = (currentVal * dp.ScaleFactor) + dp.Offset;
                                _logger.LogInformation("[Telemetry Read] Node: {Node} | Raw: {Raw} | Processed: {Value}", dp.Address, currentVal, processedVal);
                                dp.LastValue = processedVal.ToString("F2");
                                dp.LastError = null;
                                dp.ConsecutiveFailures = 0;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        // Pass the poll-tick `now` so all tags in the same tick share one row
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal);
                                        _logger.LogInformation("[Queue Buffer] Enqueued OPC UA telemetry | Stream: {Source} Metric: {Metric}", dp.DataSourceId, dp.Metric);
                                    }
                                }
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "Failed to enqueue OPC UA telemetry for Node {Node}", dp.Address);
                            }
                        }
                    }
                    return;
                }

                // ── Simulated custom adapters: per-tag sequential loop ───────────
                foreach (var dp in group)
                {
                    int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
                    int effectiveInterval = dp.ConsecutiveFailures > 0
                        ? baseInterval * (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6))
                        : baseInterval;

                    if (dp.LastUpdated != null && (now - dp.LastUpdated.Value).TotalMilliseconds < effectiveInterval)
                        continue;

                    bool updated = false;
                    string? prevError = dp.LastError;

                    if (adapter.Id != _opcUaAdapterId && adapter.Id != _mqttAdapterId && adapter.Id != _modbusAdapterId)
                    {
                        // Simulated custom adapter
                        try
                        {
                            double rawVal = Math.Round(Random.Shared.NextDouble() * 100.0, 2);
                            double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;
                            dp.LastValue = processedVal.ToString("F2");
                            dp.LastError = null;
                            dp.ConsecutiveFailures = 0;
                            dp.LastUpdated = now;
                            updated = true;
                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal);
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Failed to simulate custom adapter");
                            dp.LastError = ex.Message;
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = now;
                            updated = true;
                        }
                    }

                    if (updated)
                    {
                        bool shouldWrite = dp.LastError != prevError
                            || !_lastDbWriteTimes.TryGetValue(dp.Id, out var lastWrite)
                            || (now - lastWrite).TotalSeconds >= 1;
                        if (shouldWrite)
                        {
                            _lastDbWriteTimes[dp.Id] = now;
                            dirtyDps.Add(dp);
                        }
                    }
                }
            });

            await Task.WhenAll(pollTasks);

            // 3. Batch save diagnostic updates to avoid high disk write I/O
            if (dirtyDps.Any())
            {
                try
                {
                    using var dbWrite = new QueueDbContext();
                    foreach (var dirty in dirtyDps)
                    {
                        var dbEntry = await dbWrite.DataPoints.FirstOrDefaultAsync(x => x.Id == dirty.Id, stoppingToken);
                        if (dbEntry != null)
                        {
                            dbEntry.LastValue = dirty.LastValue;
                            dbEntry.LastError = dirty.LastError;
                            dbEntry.LastUpdated = dirty.LastUpdated;
                            dbEntry.ConsecutiveFailures = dirty.ConsecutiveFailures;
                            dbWrite.DataPoints.Update(dbEntry);
                        }
                    }
                    await dbWrite.SaveChangesAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to persist batched physical tag diagnostics to SQLite");
                }
            }



            // 5. Every 15 seconds, send heartbeat to Cloud
            if ((now - _lastHeartbeat).TotalSeconds >= 15)
            {
                _lastHeartbeat = now;
                
                if (_deviceConfig != null && !string.IsNullOrEmpty(_deviceConfig.ApiKey))
                {
                    var (success, status) = await _cloudClient.SendHeartbeatAsync(_deviceConfig.CloudEndpoint, _deviceConfig.ApiKey, _deviceConfig.Version);
                    if (success)
                    {
                        if (_deviceConfig.CloudStatus != "Connected")
                        {
                            _deviceConfig.CloudStatus = "Connected";
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                        }
                    }
                    else
                    {
                        _logger.LogWarning("Heartbeat failed.");
                        string newStatus = "Disconnected";
                        if (status == "revoked")
                        {
                            _logger.LogError("API Key has been revoked by cloud. Clearing device API Key.");
                            _deviceConfig.ApiKey = "";
                            _deviceConfig.SiteId = "";
                            _deviceConfig.SiteName = "";
                            newStatus = "Revoked";
                        }
                        
                        _deviceConfig.CloudStatus = newStatus;
                        await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                    }
                }
                else if (_deviceConfig != null)
                {
                    if (_deviceConfig.CloudStatus != "PendingApproval" && _deviceConfig.CloudStatus != "Revoked")
                    {
                        _deviceConfig.CloudStatus = "PendingApproval";
                        await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                    }
                }
                
                // Enqueue state change event to local database
                string eventPayload = $"{{\"state\": \"Running\", \"cycle\": {loopCount}}}";
                await _storageService.EnqueueEventAsync("MachineState", eventPayload);
                _logger.LogInformation("[Queue Buffer] Enqueued machine state event to SQLite.");
            }

            await Task.Delay(100, stoppingToken);
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // Modbus Block-Read Polling
    // ════════════════════════════════════════════════════════════════════════════

    private record ModbusTagMeta(
        DataPoint Dp,
        ModbusDriver.RegisterType RegType,
        int Offset,
        int WordCount);

    /// <summary>
    /// Polls all due Modbus tags for one adapter using block reads.
    /// Algorithm:
    ///   1. Filter to tags due this cycle.
    ///   2. Parse address → (RegisterType, offset, wordCount).
    ///   3. Group by (ScanIntervalMs, RegisterType) — different rates or types never share a block.
    ///   4. Within each group sort by offset; split into perfectly contiguous blocks (gap = 0).
    ///   5. Issue ONE ReadBlock per block → slice buffer → convert each tag.
    /// </summary>
    private async Task PollModbusGroupAsync(
        IEnumerable<DataPoint> allTags,
        byte unitId,
        DateTime now,
        System.Collections.Concurrent.ConcurrentBag<DataPoint> dirtyDps,
        CancellationToken ct)
    {
        // Step 1 — filter due tags and parse addresses
        var dueMetas = new List<ModbusTagMeta>();
        foreach (var dp in allTags)
        {
            int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
            int effectiveInterval = baseInterval;
            if (dp.ConsecutiveFailures > 0)
            {
                // Tier 2 Exponential Backoff
                int multiplier = (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6));
                effectiveInterval = baseInterval * multiplier;
            }

            if (dp.LastUpdated != null && (now - dp.LastUpdated.Value).TotalMilliseconds < effectiveInterval)
                continue;

            try
            {
                var (regType, offset) = _modbusDriver.ParseAddress(dp.Address);
                // Only HR and IR support block reads; Coil/DI fall back to single reads
                if (regType == ModbusDriver.RegisterType.Coil || regType == ModbusDriver.RegisterType.DiscreteInput)
                {
                    await PollSingleModbusTagAsync(dp, unitId, now, dirtyDps, ct);
                    continue;
                }
                int words = _modbusDriver.GetWordCount(dp.DataType);
                dueMetas.Add(new ModbusTagMeta(dp, regType, offset, words));
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[Modbus Block] Could not parse address '{Addr}': {Msg}", dp.Address, ex.Message);
                dp.LastError = $"Address parse error: {ex.Message}";
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                dirtyDps.Add(dp);
            }
        }

        if (dueMetas.Count == 0) return;

        // Step 2 — group by (ScanIntervalMs, RegisterType) then sort by offset
        var rateRegGroups = dueMetas
            .GroupBy(m => (m.Dp.ScanIntervalMs, m.RegType))
            .ToList();

        foreach (var rateGroup in rateRegGroups)
        {
            var sorted = rateGroup.OrderBy(m => m.Offset).ToList();

            // Step 3 — split into perfectly contiguous blocks (gap = 0)
            var blocks = new List<List<ModbusTagMeta>>();
            foreach (var meta in sorted)
            {
                var lastBlock = blocks.LastOrDefault();
                var lastMeta  = lastBlock?.LastOrDefault();

                if (lastMeta == null || meta.Offset != lastMeta.Offset + lastMeta.WordCount)
                {
                    // Gap detected (or first tag) — start a new block
                    blocks.Add(new List<ModbusTagMeta> { meta });
                }
                else
                {
                    // Perfectly adjacent — extend current block
                    lastBlock!.Add(meta);
                }
            }

            // Step 4 — execute one read per block
            foreach (var block in blocks)
            {
                int blockStart = block.First().Offset;
                int blockWords = block.Last().Offset + block.Last().WordCount - blockStart;
                var regType   = block.First().RegType;
                string regLabel = regType == ModbusDriver.RegisterType.HoldingRegister ? "HR" : "IR";

                _logger.LogDebug(
                    "[Modbus Block] {Reg} @{Start}..{End} ({Words} words, {Count} tag(s) merged)",
                    regLabel, blockStart, blockStart + blockWords - 1, blockWords, block.Count);

                ushort[] buffer;
                try
                {
                    buffer = regType == ModbusDriver.RegisterType.HoldingRegister
                        ? _modbusDriver.ReadBlockHolding(blockStart, blockWords, unitId)
                        : _modbusDriver.ReadBlockInput(blockStart, blockWords, unitId);
                }
                catch (Exception ex)
                {
                    // Block read failed — degrade to individual reads with retries!
                    _logger.LogWarning(ex,
                        "[Modbus Block] {Reg} block read failed @{Start} ({Words} words). Degrading to individual tag reads...",
                        regLabel, blockStart, blockWords);

                    foreach (var meta in block)
                    {
                        var dp = meta.Dp;
                        int maxRetries = 3;
                        double rawVal = 0;
                        bool readSuccess = false;
                        string lastOpError = "";

                        for (int attempt = 1; attempt <= maxRetries; attempt++)
                        {
                            try
                            {
                                rawVal = _modbusDriver.ReadRegister(dp.Address, dp.DataType, unitId, dp.ByteOrder);
                                readSuccess = true;
                                break;
                            }
                            catch (Exception ex2)
                            {
                                lastOpError = ex2.Message;
                                if (attempt < maxRetries)
                                    await Task.Delay(150, ct);
                            }
                        }

                        if (readSuccess)
                        {
                            try
                            {
                                double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;
                                _logger.LogInformation(
                                    "[Modbus Degraded Success] Tag {Addr} read successfully after degradation. Raw: {Raw} Processed: {Proc}",
                                    dp.Address, rawVal, processedVal);
                                dp.LastValue = processedVal.ToString("F2");
                                dp.LastError = null;
                                dp.ConsecutiveFailures = 0;
                                dp.LastUpdated = now;

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        await _storageService.EnqueueTelemetryAsync(
                                            dp.DataSourceId, now, dp.Metric, processedVal);
                                    }
                                }
                            }
                            catch (Exception ex3)
                            {
                                _logger.LogError(ex3, "[Modbus Degraded] Error enqueuing telemetry for tag {Addr}", dp.Address);
                            }
                        }
                        else
                        {
                            _logger.LogError(
                                "[Modbus Degraded Failure] Tag {Addr} failed all {Retries} individual read retries. Last error: {Error}",
                                dp.Address, maxRetries, lastOpError);
                            dp.LastError = lastOpError;
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = now;
                        }

                        AddDirtyIfNeeded(dp, now, dirtyDps);
                    }
                    continue;
                }

                // Step 5 — slice buffer and convert each tag
                foreach (var meta in block)
                {
                    string? prevError = meta.Dp.LastError;
                    try
                    {
                        int sliceStart = meta.Offset - blockStart;
                        var slice = buffer.Skip(sliceStart).Take(meta.WordCount).ToArray();

                        double rawVal      = _modbusDriver.ConvertToDouble(slice, meta.Dp.DataType, meta.Dp.ByteOrder);
                        double processedVal = (rawVal * meta.Dp.ScaleFactor) + meta.Dp.Offset;

                        _logger.LogDebug(
                            "[Modbus Block]   └─ {Addr} ({Type}) slice[{S}..{E}] Raw:{Raw} → Processed:{Proc}",
                            meta.Dp.Address, meta.Dp.DataType,
                            sliceStart, sliceStart + meta.WordCount - 1,
                            rawVal, processedVal);

                        meta.Dp.LastValue  = processedVal.ToString("F2");
                        meta.Dp.LastError  = null;
                        meta.Dp.ConsecutiveFailures = 0;
                        meta.Dp.LastUpdated = now;

                        // Enqueue telemetry if this tag is mapped to a data stream
                        if (!string.IsNullOrEmpty(meta.Dp.DataSourceId) && !string.IsNullOrEmpty(meta.Dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(meta.Dp.DataSourceId))
                            {
                                // Pass the block-read `now` so contiguous Modbus tags merge into one row
                                await _storageService.EnqueueTelemetryAsync(
                                    meta.Dp.DataSourceId, now, meta.Dp.Metric, processedVal);
                                _logger.LogInformation(
                                    "[Queue Buffer] Enqueued Modbus telemetry | Stream: {Source} Metric: {Metric}",
                                    meta.Dp.DataSourceId, meta.Dp.Metric);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "[Modbus Block] Conversion error for tag {Addr}", meta.Dp.Address);
                        meta.Dp.LastError  = ex.Message;
                        meta.Dp.ConsecutiveFailures++;
                        meta.Dp.LastUpdated = now;
                    }

                    AddDirtyIfNeeded(meta.Dp, now, dirtyDps);
                }
            }
        }
    }

    /// <summary>Fallback single-tag read for Coil and Discrete Input registers.</summary>
    private async Task PollSingleModbusTagAsync(
        DataPoint dp, byte unitId, DateTime now,
        System.Collections.Concurrent.ConcurrentBag<DataPoint> dirtyDps,
        CancellationToken ct)
    {
        string? prevError = dp.LastError;
        int maxRetries = 3;
        double rawVal = 0;
        bool readSuccess = false;
        string lastOpError = "";

        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                rawVal = _modbusDriver.ReadRegister(dp.Address, dp.DataType, unitId, dp.ByteOrder);
                readSuccess = true;
                break;
            }
            catch (Exception ex)
            {
                lastOpError = ex.Message;
                if (attempt < maxRetries)
                    await Task.Delay(150, ct);
            }
        }

        if (readSuccess)
        {
            try
            {
                double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;
                _logger.LogDebug("[Modbus] {Addr} Raw:{Raw} → Processed:{Proc}", dp.Address, rawVal, processedVal);
                dp.LastValue  = processedVal.ToString("F2");
                dp.LastError  = null;
                dp.ConsecutiveFailures = 0;
                dp.LastUpdated = now;

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Modbus] Error enqueuing telemetry for {Addr}", dp.Address);
            }
        }
        else
        {
            _logger.LogError("[Modbus] Single read failed for {Addr} after {Retries} retries. Last error: {Error}", dp.Address, maxRetries, lastOpError);
            dp.LastError  = lastOpError;
            dp.ConsecutiveFailures++;
            dp.LastUpdated = now;
        }
        AddDirtyIfNeeded(dp, now, dirtyDps);
    }

    /// <summary>Applies the 1-second DB write throttle and adds the tag to the dirty bag.</summary>
    private void AddDirtyIfNeeded(
        DataPoint dp, DateTime now,
        System.Collections.Concurrent.ConcurrentBag<DataPoint> dirtyDps)
    {
        bool shouldWrite = !_lastDbWriteTimes.TryGetValue(dp.Id, out var lastWrite)
                          || (now - lastWrite).TotalSeconds >= 1;
        if (shouldWrite)
        {
            _lastDbWriteTimes[dp.Id] = now;
            dirtyDps.Add(dp);
        }
    }

    /// <summary>Parses UnitId from adapter ConfigJson, defaulting to 1.</summary>
    private static byte GetModbusUnitId(DriverAdapter adapter)
    {
        try
        {
            if (!string.IsNullOrEmpty(adapter.ConfigJson))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                if (doc.RootElement.TryGetProperty("UnitId", out var prop))
                    return prop.GetByte();
            }
        }
        catch { /* fallback */ }
        return 1;
    }

    private void ConnectMqttBackground(string host, int port, List<string> topics)
    {
        if (_isMqttConnecting) return;
        _isMqttConnecting = true;

        _ = Task.Run(async () =>
        {
            _logger.LogInformation("[MQTT Link] Starting background connection attempt to {Host}:{Port}...", host, port);
            try
            {
                using (var db = new QueueDbContext())
                {
                    var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _mqttAdapterId);
                    if (adapter != null && adapter.Status != "Connecting")
                    {
                        adapter.Status = "Connecting";
                        db.DriverAdapters.Update(adapter);
                        await db.SaveChangesAsync();
                    }
                }

                await _mqttDriver.ConnectAndSubscribeAsync(host, port, topics);

                using (var db = new QueueDbContext())
                {
                    var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _mqttAdapterId);
                    if (adapter != null)
                    {
                        adapter.Status = "Connected";
                        db.DriverAdapters.Update(adapter);
                        await db.SaveChangesAsync();
                    }
                }
                _logger.LogInformation("[MQTT Link] Background connection to {Host}:{Port} succeeded.", host, port);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[MQTT Link] Background connection to {Host}:{Port} failed.", host, port);
                using (var db = new QueueDbContext())
                {
                    var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _mqttAdapterId);
                    if (adapter != null)
                    {
                        adapter.Status = "Error";
                        db.DriverAdapters.Update(adapter);
                        await db.SaveChangesAsync();
                    }
                }
            }
            finally
            {
                _isMqttConnecting = false;
            }
        });
    }

    private async Task PushDataSourcesToCloudAsync(string baseUrl, string apiKey)
    {
        try
        {
            using var db = new QueueDbContext();
            var dataSources = await db.DataSources.ToListAsync();
            var dataPoints = await db.DataPoints.ToListAsync();
            var adapters = await db.DriverAdapters.ToListAsync();

            var dtoList = new List<CloudClient.DeclareDataSourceRequest>();
            foreach (var ds in dataSources)
            {
                var metrics = dataPoints
                    .Where(dp => dp.DataSourceId == ds.Id && !string.IsNullOrEmpty(dp.Metric))
                    .Select(dp => dp.Metric!)
                    .Distinct()
                    .ToArray();

                string? protocol = null;
                var dpSample = dataPoints.FirstOrDefault(dp => dp.DataSourceId == ds.Id);
                if (dpSample != null)
                {
                    var adp = adapters.FirstOrDefault(a => a.Id == dpSample.AdapterId);
                    if (adp != null)
                    {
                        protocol = adp.Protocol.ToLower().Replace("_", "");
                    }
                }

                dtoList.Add(new CloudClient.DeclareDataSourceRequest(ds.Id, ds.Name, metrics, protocol));
            }

            if (dtoList.Any() && !string.IsNullOrEmpty(apiKey))
            {
                _logger.LogInformation("Declaring/updating {Count} data sources with PULSE Cloud...", dtoList.Count);
                bool success = await _cloudClient.UpsertDataSourcesAsync(baseUrl, apiKey, dtoList);
                if (success)
                {
                    _logger.LogInformation("Successfully declared data sources to cloud.");
                }
                else
                {
                    _logger.LogWarning("Failed to declare data sources to cloud.");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error while pushing data sources to cloud");
        }
    }
}

