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
using Pulse.Edge.Protocols.LibPlcTag;
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
    private readonly LibPlcTagDriver _libPlcTagDriver;
    private readonly SyncService _syncService;
    private readonly SimulatorDriver _simulatorDriver;

    private DeviceConfig? _deviceConfig;
    private string _activeOpcUaEndpoint = string.Empty;
    private string _activeMqttHost = string.Empty;
    private int _activeMqttPort = 0;
    private List<string> _activeMqttTopics = new();
    private string _activeModbusProtocol = "MODBUS_TCP";
    private string _activeModbusHost = string.Empty;
    private int _activeModbusPort = 0;
    private string _activeModbusConfigJson = string.Empty;
    private string _activeLibPlcTagHost = string.Empty;
    private string _activeLibPlcTagPlcType = "ControlLogix";
    private string _activeLibPlcTagProtocol = "ab_eip";
    private string _activeLibPlcTagPath = "1,0";
    private int _activeLibPlcTagTimeoutMs = 5000;
    private bool _activeMqttIsEnabled = false;
    private bool _activeOpcUaIsEnabled = false;
    private bool _activeModbusIsEnabled = false;
    private bool _activeLibPlcTagIsEnabled = false;
    private bool _isMqttConnecting = false;
    private string _opcUaAdapterId = "adp-opcua-1";
    private string _mqttAdapterId = "adp-mqtt-1";
    private string _modbusAdapterId = "adp-modbus-1";
    private string _libPlcTagAdapterId = "adp-libplctag-1";

    private DateTime _lastMqttPublish = DateTime.MinValue;
    private DateTime _lastHeartbeat = DateTime.MinValue;
    private DateTime _lastConfigReload = DateTime.MinValue;
    private string _lastDataSourcesHash = string.Empty;
    private DateTime _lastDataSourceCheck = DateTime.MinValue;
    private readonly Dictionary<string, DateTime> _lastDbWriteTimes = new();
    private List<DataPoint> _cachedDataPoints = new();
    private List<DriverAdapter> _cachedAdapters = new();
    private bool _hasInitialConfigSyncRun = false;

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
        LibPlcTagDriver libPlcTagDriver,
        SyncService syncService,
        SimulatorDriver simulatorDriver)
    {
        _logger = logger;
        _configuration = configuration;
        _storageService = storageService;
        _cloudClient = cloudClient;
        _opcUaDriver = opcUaDriver;
        _mqttDriver = mqttDriver;
        _modbusDriver = modbusDriver;
        _libPlcTagDriver = libPlcTagDriver;
        _syncService = syncService;
        _simulatorDriver = simulatorDriver;
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
            _logger.LogWarning("No local device configuration found. Agent is pausing and waiting for user onboarding via the Web UI...");
            while (_deviceConfig == null && !stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(3000, stoppingToken);
                _deviceConfig = await _storageService.GetDeviceConfigAsync();
            }
            
            if (stoppingToken.IsCancellationRequested)
                return;

            _logger.LogInformation("Device configuration detected! Proceeding with startup registration flow...");
            currentBaseUrl = _deviceConfig!.CloudEndpoint;
            configApiKey = _deviceConfig.ApiKey;
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

            if (!string.IsNullOrEmpty(_configuration["Cloud:BaseUrl"]) && _deviceConfig.CloudEndpoint != _configuration["Cloud:BaseUrl"])
            {
                _deviceConfig.CloudEndpoint = _configuration["Cloud:BaseUrl"]!;
                currentBaseUrl = _deviceConfig.CloudEndpoint;
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                _logger.LogInformation("Updated CloudEndpoint from configuration overrides: {CloudEndpoint}", _deviceConfig.CloudEndpoint);
            }

            if (!string.IsNullOrEmpty(_configuration["EdgeSettings:SerialNumber"]) && _deviceConfig.SerialNumber != _configuration["EdgeSettings:SerialNumber"])
            {
                _deviceConfig.SerialNumber = _configuration["EdgeSettings:SerialNumber"]!;
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                _logger.LogInformation("Updated SerialNumber from configuration overrides: {SerialNumber}", _deviceConfig.SerialNumber);
            }
        }

        // Generate ClaimSecret if not present
        if (string.IsNullOrEmpty(_deviceConfig.ClaimSecret))
        {
            var secretBytes = new byte[24];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                rng.GetBytes(secretBytes);
            }
            _deviceConfig.ClaimSecret = Convert.ToHexString(secretBytes).ToLowerInvariant();
            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            _logger.LogInformation("Generated new device onboarding ClaimSecret.");
        }

        // Generate PairingToken if not present
        if (string.IsNullOrEmpty(_deviceConfig.PairingToken))
        {
            var tokenBytes = new byte[24];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
            {
                rng.GetBytes(tokenBytes);
            }
            _deviceConfig.PairingToken = Convert.ToHexString(tokenBytes).ToLowerInvariant();
            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            _logger.LogInformation("Generated new device onboarding PairingToken.");
        }

        // Check if we have an API Key configured at boot
        if (!string.IsNullOrEmpty(_deviceConfig.ApiKey))
        {
            _logger.LogInformation("API Key is present at boot. Fetching configuration from PULSE Cloud...");
            
            var configResult = await _cloudClient.GetConfigAsync(currentBaseUrl, _deviceConfig.ApiKey);
            if (configResult.Success)
            {
                _logger.LogInformation("Successfully retrieved config. Assigned Site: {SiteName} ({SiteId})", 
                    configResult.SiteName, configResult.SiteId);
                
                _deviceConfig.SiteId = configResult.SiteId;
                _deviceConfig.SiteName = configResult.SiteName;
                _deviceConfig.CloudStatus = "Connected";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                _hasInitialConfigSyncRun = true;

                // Push logical data sources to cloud control plane
                bool success = await PushDataSourcesToCloudAsync(currentBaseUrl, _deviceConfig.ApiKey);
                if (success)
                {
                    _lastDataSourcesHash = await CalculateDataSourcesHashAsync();
                }
            }
            else if (configResult.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                _logger.LogError("API Key is invalid or has been revoked (401 Unauthorized) on startup. Resetting API Key. Re-approval required.");
                _deviceConfig.ApiKey = "";
                _deviceConfig.SiteId = "";
                _deviceConfig.SiteName = "";
                _deviceConfig.CloudStatus = "Revoked";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }
            else
            {
                _logger.LogWarning("Failed to fetch configuration from cloud (Status Code: {StatusCode}) on startup. Continuing with local cached config.", configResult.StatusCode);
                _deviceConfig.CloudStatus = "Disconnected";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }
        }
        else
        {
            _logger.LogWarning("No API Key configured. Device is pending approval. Register/Claim polling will begin in the background.");
            if (_deviceConfig.CloudStatus != "Revoked")
            {
                _deviceConfig.CloudStatus = "PendingApproval";
                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
            }
        }

        // Start Cloud Provisioning Loop in the background (Non-blocking Task)
        _ = Task.Run(() => StartCloudProvisioningLoopAsync(stoppingToken), stoppingToken);

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
        _activeMqttTopics = await GetActiveMqttTopicsAsync(db);

        // Whenever MQTT receives a packet, save it directly to SQLite!
        _mqttDriver.MessageReceivedAsync += async (topic, payload) =>
        {
            _logger.LogInformation("[MQTT Link] Telemetry packet intercepted on topic '{Topic}'. Resolving mapping...", topic);

            var receivedAt = DateTime.UtcNow;

            using var dbLookup = new QueueDbContext();

            // Cache the seen topic and payload for browsing support
            try
            {
                await dbLookup.Database.ExecuteSqlRawAsync(
                    "INSERT INTO MqttSeenTopics (Topic, Payload, LastSeen) VALUES ({0}, {1}, {2}) ON CONFLICT(Topic) DO UPDATE SET Payload = {1}, LastSeen = {2};",
                    topic, payload ?? string.Empty, receivedAt.ToString("o"));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to cache MQTT seen topic '{Topic}' in database", topic);
            }

            // 1. Process Last Will and Testament (LWT) status updates for devices
            var lwtDevices = await dbLookup.MqttDevices
                .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && x.LwtTopic == topic)
                .ToListAsync();

            foreach (var dev in lwtDevices)
            {
                bool isOffline = string.Equals(payload, dev.LwtOfflinePayload, StringComparison.OrdinalIgnoreCase);
                bool isOnline = string.Equals(payload, dev.LwtOnlinePayload, StringComparison.OrdinalIgnoreCase);

                if (isOffline)
                {
                    dev.Status = "Offline";
                    dev.LastError = "Device reported offline via LWT";
                    dev.LastUpdated = receivedAt;
                    dev.ConsecutiveFailures++;
                    dbLookup.MqttDevices.Update(dev);

                    _logger.LogWarning("[MQTT Device] Device '{DeviceName}' reported offline via LWT on topic '{LwtTopic}'", dev.Name, topic);

                    // Propagate offline status to all child tags
                    var childDps = await dbLookup.DataPoints
                        .Where(x => x.MqttDeviceId == dev.Id && x.IsEnabled)
                        .ToListAsync();

                    foreach (var dp in childDps)
                    {
                        dp.LastError = "Device reported offline via LWT";
                        dp.ConsecutiveFailures = dev.ConsecutiveFailures;
                        dp.LastUpdated = receivedAt;
                        dbLookup.DataPoints.Update(dp);

                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                            {
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "CommunicationLost");
                            }
                        }
                    }
                }
                else if (isOnline)
                {
                    dev.Status = "Connected";
                    dev.LastError = null;
                    dev.LastUpdated = receivedAt;
                    dev.ConsecutiveFailures = 0;
                    dbLookup.MqttDevices.Update(dev);

                    _logger.LogInformation("[MQTT Device] Device '{DeviceName}' reported online via LWT on topic '{LwtTopic}'", dev.Name, topic);

                    // Propagate online status to all child tags (mark as stale until next telemetry)
                    var childDps = await dbLookup.DataPoints
                        .Where(x => x.MqttDeviceId == dev.Id && x.IsEnabled)
                        .ToListAsync();

                    foreach (var dp in childDps)
                    {
                        dp.LastError = null;
                        dp.ConsecutiveFailures = 0;
                        dp.LastUpdated = receivedAt;
                        dbLookup.DataPoints.Update(dp);

                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                            {
                                double? lastVal = null;
                                if (double.TryParse(dp.LastValue, out double parsedVal))
                                {
                                    lastVal = parsedVal;
                                }
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, lastVal, "Stale");
                            }
                        }
                    }
                }
            }

            if (lwtDevices.Count > 0)
            {
                await dbLookup.SaveChangesAsync();
            }

            // 2. Process first-class MqttDevice telemetry
            var allDevices = await dbLookup.MqttDevices
                .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled)
                .ToListAsync();

            var matchingDevices = allDevices
                .Where(x => MqttTopicMatches(x.TopicSubscription, topic))
                .ToList();

            foreach (var dev in matchingDevices)
            {
                // Update device health metrics
                dev.Status = "Connected";
                dev.LastError = null;
                dev.LastUpdated = receivedAt;
                dev.ConsecutiveFailures = 0;
                dbLookup.MqttDevices.Update(dev);

                var deviceDps = await dbLookup.DataPoints
                    .Where(x => x.MqttDeviceId == dev.Id && x.IsEnabled)
                    .ToListAsync();

                if (dev.MqttParseMode == "JSON")
                {
                    System.Text.Json.JsonDocument? jsonDoc = null;
                    try
                    {
                        jsonDoc = System.Text.Json.JsonDocument.Parse(payload);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "[MQTT Device Link] Failed to parse payload as JSON on topic '{Topic}': {Payload}", topic, payload);
                        dev.Status = "Error";
                        dev.LastError = "Failed to parse JSON payload";
                        dev.ConsecutiveFailures++;
                        dbLookup.MqttDevices.Update(dev);

                        foreach (var dp in deviceDps)
                        {
                            dp.LastError = "Failed to parse JSON payload";
                            dp.ConsecutiveFailures = dev.ConsecutiveFailures;
                            dp.LastUpdated = receivedAt;
                            dbLookup.DataPoints.Update(dp);

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                                }
                            }
                        }
                        continue;
                    }

                    try
                    {
                        foreach (var dp in deviceDps)
                        {
                            string? jsonPath = !string.IsNullOrEmpty(dp.MqttJsonPath) ? dp.MqttJsonPath : dp.Address;
                            string? extractedValue = GetJsonValueByPath(payload, jsonPath ?? string.Empty);

                            if (extractedValue == null)
                            {
                                dp.LastError = $"JSON path '{jsonPath}' not found";
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = receivedAt;
                                dbLookup.DataPoints.Update(dp);

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                                    }
                                }
                                continue;
                            }

                            // Process the telemetry value
                            await ProcessDataPointValueAsync(dbLookup, dp, extractedValue, receivedAt);
                        }
                    }
                    finally
                    {
                        jsonDoc?.Dispose();
                    }
                }
                else // Plaintext mode / Wildcard multi-topic
                {
                    // Match the incoming topic directly against tag Address
                    var matchingDps = deviceDps
                        .Where(x => string.Equals(x.Address, topic, StringComparison.OrdinalIgnoreCase))
                        .ToList();

                    foreach (var dp in matchingDps)
                    {
                        string? extractedValue = null;
                        if (dp.MqttParseMode == "JSON")
                        {
                            extractedValue = GetJsonValueByPath(payload, dp.MqttJsonPath ?? string.Empty);
                        }
                        else
                        {
                            extractedValue = payload;
                        }

                        if (extractedValue == null)
                        {
                            dp.LastError = dp.MqttParseMode == "JSON" ? $"JSON path '{dp.MqttJsonPath}' not found" : "Null payload received";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = receivedAt;
                            dbLookup.DataPoints.Update(dp);

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                                }
                            }
                            continue;
                        }

                        await ProcessDataPointValueAsync(dbLookup, dp, extractedValue, receivedAt);
                    }
                }
            }

            // 3. Process legacy DataPoints (not associated with any MqttDevice)
            var legacyMatchingDps = await dbLookup.DataPoints
                .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && (x.MqttDeviceId == null || x.MqttDeviceId == "") && x.Address == topic)
                .ToListAsync();

            if (legacyMatchingDps.Count > 0)
            {
                System.Text.Json.JsonDocument? jsonDoc = null;
                bool anyJson = legacyMatchingDps.Any(x => x.MqttParseMode == "JSON");
                if (anyJson)
                {
                    try
                    {
                        jsonDoc = System.Text.Json.JsonDocument.Parse(payload);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "[MQTT Legacy Link] Failed to parse payload as JSON on topic '{Topic}': {Payload}", topic, payload);
                    }
                }

                try
                {
                    foreach (var dp in legacyMatchingDps)
                    {
                        string? extractedValue = null;
                        bool extractedOk = true;

                        if (dp.MqttParseMode == "JSON")
                        {
                            if (jsonDoc == null)
                            {
                                dp.LastError = "Failed to parse JSON payload";
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = receivedAt;
                                dbLookup.DataPoints.Update(dp);
                                extractedOk = false;
                            }
                            else
                            {
                                extractedValue = GetJsonValueByPath(payload, dp.MqttJsonPath ?? string.Empty);
                                if (extractedValue == null)
                                {
                                    dp.LastError = $"JSON path '{dp.MqttJsonPath}' not found";
                                    dp.ConsecutiveFailures++;
                                    dp.LastUpdated = receivedAt;
                                    dbLookup.DataPoints.Update(dp);
                                    extractedOk = false;
                                }
                            }
                        }
                        else
                        {
                            extractedValue = payload;
                        }

                        if (!extractedOk)
                        {
                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                                }
                            }
                            continue;
                        }

                        await ProcessDataPointValueAsync(dbLookup, dp, extractedValue, receivedAt);
                    }
                }
                finally
                {
                    jsonDoc?.Dispose();
                }
            }

            await dbLookup.SaveChangesAsync();
        };

        _activeOpcUaIsEnabled = opcUaAdapter?.IsEnabled ?? false;
        _activeMqttIsEnabled = mqttAdapter?.IsEnabled ?? false;

        var modbusAdapterInit = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "MODBUS_TCP" || x.Protocol == "MODBUS_RTU", stoppingToken);
        _modbusAdapterId = modbusAdapterInit?.Id ?? "adp-modbus-1";
        _activeModbusIsEnabled = modbusAdapterInit?.IsEnabled ?? false;
        _activeModbusProtocol = modbusAdapterInit?.Protocol ?? "MODBUS_TCP";
        _activeModbusHost = modbusAdapterInit?.Host ?? "127.0.0.1";
        _activeModbusPort = modbusAdapterInit?.Port ?? 502;
        _activeModbusConfigJson = modbusAdapterInit?.ConfigJson ?? string.Empty;

        if (_activeOpcUaIsEnabled)
        {
            try
            {
                await _opcUaDriver.ConnectAsync(_activeOpcUaEndpoint);
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

        if (_activeModbusIsEnabled && modbusAdapterInit != null)
        {
            try
            {
                await ConnectModbusDriverAsync(modbusAdapterInit, stoppingToken);
                modbusAdapterInit.Status = "Connected";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect Modbus {Protocol} adapter on startup", _activeModbusProtocol);
                modbusAdapterInit.Status = "Error";
            }
        }
        else
        {
            if (modbusAdapterInit != null) modbusAdapterInit.Status = "Disconnected";
        }
        if (modbusAdapterInit != null) db.DriverAdapters.Update(modbusAdapterInit);

        var libPlcTagAdapterInit = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "Ethernet/IP", stoppingToken);
        _libPlcTagAdapterId = libPlcTagAdapterInit?.Id ?? "adp-libplctag-1";
        _activeLibPlcTagIsEnabled = libPlcTagAdapterInit?.IsEnabled ?? false;
        _activeLibPlcTagHost = libPlcTagAdapterInit?.Host ?? "";
        
        var (initPlcType, initProtocol, initPath, initTimeoutMs) = libPlcTagAdapterInit != null 
            ? ParseLibPlcTagConfig(libPlcTagAdapterInit) 
            : ("ControlLogix", "ab_eip", "1,0", 5000);
            
        _activeLibPlcTagPlcType = initPlcType;
        _activeLibPlcTagProtocol = initProtocol;
        _activeLibPlcTagPath = initPath;
        _activeLibPlcTagTimeoutMs = initTimeoutMs;

        if (_activeLibPlcTagIsEnabled && libPlcTagAdapterInit != null)
        {
            try
            {
                _libPlcTagDriver.Connect(_activeLibPlcTagHost, _activeLibPlcTagPlcType, _activeLibPlcTagProtocol, _activeLibPlcTagPath, _activeLibPlcTagTimeoutMs);
                libPlcTagAdapterInit.Status = "Connected";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect LibPlcTag adapter on startup");
                libPlcTagAdapterInit.Status = "Error";
            }
        }
        else
        {
            if (libPlcTagAdapterInit != null) libPlcTagAdapterInit.Status = "Disconnected";
        }
        if (libPlcTagAdapterInit != null) db.DriverAdapters.Update(libPlcTagAdapterInit);

        // Initialize any user-created custom adapters to Connected/Disconnected in SQLite
        var allAdapters = await db.DriverAdapters.ToListAsync(stoppingToken);
        foreach (var adapter in allAdapters)
        {
            if (adapter.Id != "adp-opcua-1" && adapter.Id != "adp-mqtt-1" && adapter.Id != "adp-modbus-1" && adapter.Protocol != "Ethernet/IP")
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

            // 1b. Check for logical data source metadata changes locally every 5 seconds
            if ((now - _lastDataSourceCheck).TotalSeconds >= 5)
            {
                _lastDataSourceCheck = now;
                if (_deviceConfig != null && !string.IsNullOrEmpty(_deviceConfig.ApiKey) && _deviceConfig.CloudStatus == "Connected")
                {
                    string currentHash = await CalculateDataSourcesHashAsync();
                    if (currentHash != _lastDataSourcesHash)
                    {
                        _logger.LogInformation("Logical data sources or metrics mappings change detected! Syncing with PULSE Cloud...");
                        bool success = await PushDataSourcesToCloudAsync(_deviceConfig.CloudEndpoint, _deviceConfig.ApiKey);
                        if (success)
                        {
                            _lastDataSourcesHash = currentHash;
                        }
                    }
                }
            }

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
                                        bool success = await PushDataSourcesToCloudAsync(dbConfig.CloudEndpoint, dbConfig.ApiKey);
                                        if (success)
                                        {
                                            _lastDataSourcesHash = await CalculateDataSourcesHashAsync();
                                        }
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
                var modbusAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "MODBUS_TCP" || x.Protocol == "MODBUS_RTU", stoppingToken);

                _opcUaAdapterId = opcUaAdapterLoop?.Id ?? "adp-opcua-1";
                _mqttAdapterId = mqttAdapterLoop?.Id ?? "adp-mqtt-1";
                _modbusAdapterId = modbusAdapterLoop?.Id ?? "adp-modbus-1";

                string latestOpcUaEndpoint = opcUaAdapterLoop?.Host ?? "opc.tcp://localhost:4840";
                string latestMqttHost = mqttAdapterLoop?.Host ?? "broker.hivemq.com";
                int latestMqttPort = mqttAdapterLoop?.Port ?? 1883;
                bool isMqttEnabled = mqttAdapterLoop?.IsEnabled ?? false;
                bool isOpcUaEnabled = opcUaAdapterLoop?.IsEnabled ?? false;

                // Find active MQTT data points and extract unique topics
                var latestMqttTopics = await GetActiveMqttTopicsAsync(dbLoop);

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
                            await _opcUaDriver.ConnectAsync(_activeOpcUaEndpoint);
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
                string latestModbusProtocol = modbusAdapterLoop?.Protocol ?? "MODBUS_TCP";
                string latestModbusHost = modbusAdapterLoop?.Host ?? "127.0.0.1";
                int latestModbusPort = modbusAdapterLoop?.Port ?? 502;
                bool isModbusEnabled = modbusAdapterLoop?.IsEnabled ?? false;
                string latestModbusConfigJson = modbusAdapterLoop?.ConfigJson ?? string.Empty;

                if (modbusAdapterLoop != null && (
                    latestModbusProtocol != _activeModbusProtocol || 
                    latestModbusHost != _activeModbusHost || 
                    latestModbusPort != _activeModbusPort || 
                    isModbusEnabled != _activeModbusIsEnabled ||
                    latestModbusConfigJson != _activeModbusConfigJson))
                {
                    _logger.LogWarning("[Modbus Link] Configuration change detected in SQLite! Reconnecting driver...");
                    try
                    {
                        _modbusDriver.Disconnect();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error disconnecting Modbus client");
                    }

                    _activeModbusProtocol = latestModbusProtocol;
                    _activeModbusHost = latestModbusHost;
                    _activeModbusPort = latestModbusPort;
                    _activeModbusIsEnabled = isModbusEnabled;
                    _activeModbusConfigJson = latestModbusConfigJson;

                    if (isModbusEnabled)
                    {
                        try
                        {
                            await ConnectModbusDriverAsync(modbusAdapterLoop, stoppingToken);
                            modbusAdapterLoop.Status = "Connected";
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Error reconnecting Modbus {Protocol} client to {Host}:{Port}", _activeModbusProtocol, _activeModbusHost, _activeModbusPort);
                            modbusAdapterLoop.Status = "Error";
                        }
                    }
                    else
                    {
                        modbusAdapterLoop.Status = "Disconnected";
                    }

                    dbLoop.DriverAdapters.Update(modbusAdapterLoop);
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 2.6 Check for LibPlcTag Adapter configuration changes
                var libPlcTagAdapterLoop = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "Ethernet/IP", stoppingToken);
                _libPlcTagAdapterId = libPlcTagAdapterLoop?.Id ?? "adp-libplctag-1";
                string latestLibPlcTagHost = libPlcTagAdapterLoop?.Host ?? "";
                bool isLibPlcTagEnabled = libPlcTagAdapterLoop?.IsEnabled ?? false;
                var (lPlcType, lProtocol, lPath, lTimeoutMs) = libPlcTagAdapterLoop != null
                    ? ParseLibPlcTagConfig(libPlcTagAdapterLoop)
                    : ("ControlLogix", "ab_eip", "1,0", 5000);

                bool libPlcTagConfigChanged = libPlcTagAdapterLoop != null && (
                    latestLibPlcTagHost != _activeLibPlcTagHost ||
                    isLibPlcTagEnabled != _activeLibPlcTagIsEnabled ||
                    lPlcType != _activeLibPlcTagPlcType ||
                    lProtocol != _activeLibPlcTagProtocol ||
                    lPath != _activeLibPlcTagPath ||
                    lTimeoutMs != _activeLibPlcTagTimeoutMs
                );

                if (libPlcTagConfigChanged && libPlcTagAdapterLoop != null)
                {
                    _logger.LogWarning("[LibPlcTag Link] Configuration change detected in SQLite! Reconnecting driver...");
                    try
                    {
                        _libPlcTagDriver.Disconnect();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error disconnecting LibPlcTag client");
                    }

                    _activeLibPlcTagHost = latestLibPlcTagHost;
                    _activeLibPlcTagIsEnabled = isLibPlcTagEnabled;
                    _activeLibPlcTagPlcType = lPlcType;
                    _activeLibPlcTagProtocol = lProtocol;
                    _activeLibPlcTagPath = lPath;
                    _activeLibPlcTagTimeoutMs = lTimeoutMs;

                    if (isLibPlcTagEnabled)
                    {
                        try
                        {
                            _libPlcTagDriver.Connect(_activeLibPlcTagHost, _activeLibPlcTagPlcType, _activeLibPlcTagProtocol, _activeLibPlcTagPath, _activeLibPlcTagTimeoutMs);
                            libPlcTagAdapterLoop.Status = "Connected";
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Error reconnecting LibPlcTag client to {Host}", _activeLibPlcTagHost);
                            libPlcTagAdapterLoop.Status = "Error";
                        }
                    }
                    else
                    {
                        libPlcTagAdapterLoop.Status = "Disconnected";
                    }

                    dbLoop.DriverAdapters.Update(libPlcTagAdapterLoop);
                    await dbLoop.SaveChangesAsync(stoppingToken);
                }

                // 2.5 Automatic OPC UA Reconnection Loop
                if (_activeOpcUaIsEnabled && !_opcUaDriver.IsConnected)
                {
                    _logger.LogWarning("[OPC UA Link] Driver is disconnected. Attempting automatic reconnection to {Endpoint}...", _activeOpcUaEndpoint);
                    try
                    {
                        await _opcUaDriver.ConnectAsync(_activeOpcUaEndpoint);
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

                // 3. Automatic Modbus Reconnection Loop
                if (_activeModbusIsEnabled && !_modbusDriver.IsConnected)
                {
                    _logger.LogWarning("[Modbus Link] Driver is disconnected. Attempting automatic reconnection to {Host}:{Port}...", _activeModbusHost, _activeModbusPort);
                    try
                    {
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Id == _modbusAdapterId, stoppingToken);
                        if (adapterUpdate != null)
                        {
                            await ConnectModbusDriverAsync(adapterUpdate, stoppingToken);
                            if (adapterUpdate.Status != "Connected")
                            {
                                adapterUpdate.Status = "Connected";
                                dbLoop.DriverAdapters.Update(adapterUpdate);
                                await dbLoop.SaveChangesAsync(stoppingToken);
                            }
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

                // 3.5 Automatic LibPlcTag Reconnection Loop
                if (_activeLibPlcTagIsEnabled && !_libPlcTagDriver.IsConnected)
                {
                    _logger.LogWarning("[LibPlcTag Link] Driver is disconnected. Attempting automatic reconnection to {Host}...", _activeLibPlcTagHost);
                    try
                    {
                        _libPlcTagDriver.Connect(_activeLibPlcTagHost, _activeLibPlcTagPlcType, _activeLibPlcTagProtocol, _activeLibPlcTagPath, _activeLibPlcTagTimeoutMs);
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "Ethernet/IP", stoppingToken);
                        if (adapterUpdate != null && adapterUpdate.Status != "Connected")
                        {
                            adapterUpdate.Status = "Connected";
                            dbLoop.DriverAdapters.Update(adapterUpdate);
                            await dbLoop.SaveChangesAsync(stoppingToken);
                        }
                        _logger.LogInformation("[LibPlcTag Link] Automatic reconnection successful!");
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError("[LibPlcTag Link] Reconnection attempt failed: {Message}", ex.Message);
                        var adapterUpdate = await dbLoop.DriverAdapters.FirstOrDefaultAsync(x => x.Protocol == "Ethernet/IP", stoppingToken);
                        if (adapterUpdate != null && adapterUpdate.Status != "Error")
                        {
                            adapterUpdate.Status = "Error";
                            dbLoop.DriverAdapters.Update(adapterUpdate);
                            await dbLoop.SaveChangesAsync(stoppingToken);
                        }
                    }
                }

                var customAdapters = await dbLoop.DriverAdapters
                    .Where(x => x.Id != _opcUaAdapterId && x.Id != _mqttAdapterId && x.Id != _modbusAdapterId && x.Protocol != "Ethernet/IP")
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
                if (adapter.Protocol == "MQTT" || adapter.Protocol == "WEBHOOK") return; // Event-driven

                // ── SIMULATOR: generate simulated data ──────────────────────────
                if (adapter.Protocol == "SIMULATOR")
                {
                    await PollSimulatorGroupAsync(group, now, dirtyDps, stoppingToken);
                    return;
                }

                // ── Modbus TCP/RTU: use block-read optimized path ─────────────────────
                if ((adapter.Protocol == "MODBUS_TCP" || adapter.Protocol == "MODBUS_RTU") && _activeModbusIsEnabled && _modbusDriver.IsConnected)
                {
                    byte unitId = GetModbusUnitId(adapter);
                    await PollModbusGroupAsync(group, unitId, now, dirtyDps, stoppingToken);
                    return;
                }

                // ── Ethernet/IP (LibPlcTag): query each due tag individually ───────────
                if (adapter.Protocol == "Ethernet/IP" && _activeLibPlcTagIsEnabled && _libPlcTagDriver.IsConnected)
                {
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
                        foreach (var dp in dueDps)
                        {
                            try
                            {
                                double rawVal = await _libPlcTagDriver.ReadTagAsync(dp.Address, dp.DataType, stoppingToken);
                                double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;
                                _logger.LogInformation("[Ethernet/IP Read] Address: {Address} | Raw: {Raw} | Processed: {Value}", dp.Address, rawVal, processedVal);
                                
                                dp.LastValue = processedVal.ToString("F2");
                                dp.LastError = null;
                                dp.ConsecutiveFailures = 0;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal, "Good");
                                        _logger.LogInformation("[Queue Buffer] Enqueued Ethernet/IP telemetry | Stream: {Source} Metric: {Metric}", dp.DataSourceId, dp.Metric);
                                    }
                                }
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "Ethernet/IP read failed for tag {Address} on adapter {AdapterId}", dp.Address, adapter.Id);
                                dp.LastError = ex.Message;
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                                    }
                                }
                            }
                        }
                    }
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
                            batchResult = await _opcUaDriver.ReadMetricsBatchAsync(nodeIds, stoppingToken);
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

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                                    }
                                }
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

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                                    }
                                }
                                continue;
                            }

                            if (!readRes.Success)
                            {
                                dp.LastError = readRes.ErrorMessage ?? "Unknown OPC UA read error";
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = now;
                                AddDirtyIfNeeded(dp, now, dirtyDps);

                                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                                {
                                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                    {
                                        string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                                    }
                                }
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
                                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal, "Good");
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

                    if (adapter.Id != _opcUaAdapterId && adapter.Id != _mqttAdapterId && adapter.Id != _modbusAdapterId && adapter.Protocol != "Ethernet/IP")
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
                                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal, "Good");
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Failed to simulate custom adapter");
                            dp.LastError = ex.Message;
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = now;
                            updated = true;

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                                }
                            }
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
    // Simulator Polling
    // ════════════════════════════════════════════════════════════════════════════

    private async Task PollSimulatorGroupAsync(
        IGrouping<string, DataPoint> group,
        DateTime now,
        System.Collections.Concurrent.ConcurrentBag<DataPoint> dirtyDps,
        CancellationToken ct)
    {
        var adapterId = group.Key;
        var adapter = _cachedAdapters.FirstOrDefault(a => a.Id == adapterId);
        if (adapter == null || !adapter.IsEnabled) return;

        string template = "energy";
        try
        {
            if (!string.IsNullOrEmpty(adapter.ConfigJson))
            {
                using var jsonDoc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                if (jsonDoc.RootElement.TryGetProperty("Template", out var templateProp))
                {
                    template = templateProp.GetString()?.ToLowerInvariant() ?? "energy";
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to parse ConfigJson for simulator adapter {AdapterId}", adapterId);
        }

        using var db = new QueueDbContext();
        _simulatorDriver.UpdateState(adapterId, template, now, db);

        var dueDps = group.Where(dp =>
        {
            int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
            int effectiveInterval = dp.ConsecutiveFailures > 0
                ? baseInterval * (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6))
                : baseInterval;
            return dp.LastUpdated == null || (now - dp.LastUpdated.Value).TotalMilliseconds >= effectiveInterval;
        }).ToList();

        if (dueDps.Count == 0) return;

        foreach (var dp in dueDps)
        {
            try
            {
                double rawVal = _simulatorDriver.ReadValue(adapterId, dp.Address);
                double processedVal = (rawVal * dp.ScaleFactor) + dp.Offset;

                _logger.LogInformation("[Simulator Read] Adapter: {AdapterName} | Address: {Address} | Raw: {Raw} | Processed: {Value}", adapter.Name, dp.Address, rawVal, processedVal);

                if (dp.DataType.Equals("Boolean", StringComparison.OrdinalIgnoreCase))
                {
                    dp.LastValue = (processedVal > 0.5) ? "True" : "False";
                }
                else if (dp.DataType.Equals("Int16", StringComparison.OrdinalIgnoreCase) || 
                         dp.DataType.Equals("Int32", StringComparison.OrdinalIgnoreCase) ||
                         dp.DataType.Equals("UInt16", StringComparison.OrdinalIgnoreCase) ||
                         dp.DataType.Equals("UInt32", StringComparison.OrdinalIgnoreCase))
                {
                    dp.LastValue = ((int)Math.Round(processedVal)).ToString();
                }
                else
                {
                    dp.LastValue = processedVal.ToString("F2");
                }

                dp.LastError = null;
                dp.ConsecutiveFailures = 0;
                dp.LastUpdated = now;
                AddDirtyIfNeeded(dp, now, dirtyDps);

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                    {
                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal, "Good");
                        _logger.LogInformation("[Queue Buffer] Enqueued Simulator telemetry | Stream: {Source} Metric: {Metric} Val: {Val}", dp.DataSourceId, dp.Metric, processedVal);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Simulator read failed for address {Address} on adapter {AdapterId}", dp.Address, adapterId);
                dp.LastError = ex.Message;
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                AddDirtyIfNeeded(dp, now, dirtyDps);

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                    {
                        string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                    }
                }
            }
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
                        ? await _modbusDriver.ReadBlockHoldingAsync(blockStart, blockWords, unitId, ct)
                        : await _modbusDriver.ReadBlockInputAsync(blockStart, blockWords, unitId, ct);
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
                                rawVal = await _modbusDriver.ReadRegisterAsync(dp.Address, dp.DataType, unitId, dp.ByteOrder, ct);
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
                                            dp.DataSourceId, now, dp.Metric, processedVal, "Good");
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

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                    await _storageService.EnqueueTelemetryAsync(
                                        dp.DataSourceId, now, dp.Metric, null, quality);
                                }
                            }
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
                                    meta.Dp.DataSourceId, now, meta.Dp.Metric, processedVal, "Good");
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

                        if (!string.IsNullOrEmpty(meta.Dp.DataSourceId) && !string.IsNullOrEmpty(meta.Dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(meta.Dp.DataSourceId))
                            {
                                await _storageService.EnqueueTelemetryAsync(
                                    meta.Dp.DataSourceId, now, meta.Dp.Metric, null, "DriverError");
                            }
                        }
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
        int maxRetries = 3;
        double rawVal = 0;
        bool readSuccess = false;
        string lastOpError = "";

        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                rawVal = await _modbusDriver.ReadRegisterAsync(dp.Address, dp.DataType, unitId, dp.ByteOrder, ct);
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
                dp.LastValue = processedVal.ToString("F2");
                dp.LastError = null;
                dp.ConsecutiveFailures = 0;
                dp.LastUpdated = now;

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal, "Good");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Modbus] Error enqueuing telemetry for {Addr}", dp.Address);
                dp.LastError = ex.Message;
            }
        }
        else
        {
            _logger.LogError("[Modbus] Single read failed for {Addr} after {Retries} retries. Last error: {Error}", dp.Address, maxRetries, lastOpError);
            dp.LastError = lastOpError;
            dp.ConsecutiveFailures++;
            dp.LastUpdated = now;

            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
            {
                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                {
                    string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, quality);
                }
            }
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

    private static (string PlcType, string Protocol, string Path, int TimeoutMs) ParseLibPlcTagConfig(DriverAdapter adapter)
    {
        string plcType = "ControlLogix";
        string protocol = "ab_eip";
        string path = "1,0";
        int timeoutMs = 5000;
        
        try
        {
            if (!string.IsNullOrEmpty(adapter.ConfigJson))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("PlcType", out var ptProp)) plcType = ptProp.GetString() ?? plcType;
                if (root.TryGetProperty("Protocol", out var protoProp)) protocol = protoProp.GetString() ?? protocol;
                if (root.TryGetProperty("Path", out var pathProp)) path = pathProp.GetString() ?? path;
                if (root.TryGetProperty("TimeoutMs", out var toProp)) timeoutMs = toProp.GetInt32();
            }
        }
        catch { /* fallback to defaults */ }
        
        return (plcType, protocol, path, timeoutMs);
    }

    private async Task ConnectModbusDriverAsync(DriverAdapter adapter, CancellationToken cancellationToken = default)
    {
        if (adapter.Protocol == "MODBUS_RTU")
        {
            var portName = adapter.Host;
            var baudRate = adapter.Port;
            
            var parity = System.IO.Ports.Parity.None;
            var dataBits = 8;
            var stopBits = System.IO.Ports.StopBits.One;
            var handshake = System.IO.Ports.Handshake.None;

            try
            {
                if (!string.IsNullOrEmpty(adapter.ConfigJson))
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("Parity", out var parityProp))
                    {
                        Enum.TryParse(parityProp.GetString(), true, out parity);
                    }
                    if (root.TryGetProperty("DataBits", out var dbProp))
                    {
                        dataBits = dbProp.GetInt32();
                    }
                    if (root.TryGetProperty("StopBits", out var sbProp))
                    {
                        Enum.TryParse(sbProp.GetString(), true, out stopBits);
                    }
                    if (root.TryGetProperty("Handshake", out var hsProp))
                    {
                        Enum.TryParse(hsProp.GetString(), true, out handshake);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse Modbus RTU serial configurations from ConfigJson. Using defaults.");
            }

            _modbusDriver.ConnectRtu(portName, baudRate, parity, dataBits, stopBits, handshake);
        }
        else
        {
            await _modbusDriver.ConnectAsync(adapter.Host, adapter.Port, cancellationToken);
        }
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

    private async Task<string> CalculateDataSourcesHashAsync()
    {
        try
        {
            using var db = new QueueDbContext();
            var dataSources = await db.DataSources.OrderBy(x => x.Id).ToListAsync();
            var dataPoints = await db.DataPoints.OrderBy(x => x.Id).ToListAsync();
            var adapters = await db.DriverAdapters.OrderBy(x => x.Id).ToListAsync();
            var adaptersById = adapters.ToDictionary(a => a.Id, StringComparer.Ordinal);

            var canonical = DataSourceDeclarationBuilder.ComputeDeclarationHash(dataSources, dataPoints, adaptersById);

            using var sha256 = System.Security.Cryptography.SHA256.Create();
            var bytes = System.Text.Encoding.UTF8.GetBytes(canonical);
            var hashBytes = sha256.ComputeHash(bytes);
            return Convert.ToHexString(hashBytes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error while calculating data sources hash");
            return string.Empty;
        }
    }

    private async Task<bool> PushDataSourcesToCloudAsync(string baseUrl, string apiKey)
    {
        try
        {
            using var db = new QueueDbContext();
            var dataSources = await db.DataSources.ToListAsync();
            var dataPoints = await db.DataPoints.ToListAsync();
            var adapters = await db.DriverAdapters.ToListAsync();
            var adaptersById = adapters.ToDictionary(a => a.Id, StringComparer.Ordinal);

            var dtoList = new List<CloudClient.DeclareDataSourceRequest>();
            foreach (var ds in dataSources)
            {
                var metrics = DataSourceDeclarationBuilder.BuildMetricsForDataSource(ds.Id, dataPoints, adaptersById);
                dtoList.Add(new CloudClient.DeclareDataSourceRequest(ds.Id, ds.Name, metrics.ToArray()));
            }

            if (dtoList.Any() && !string.IsNullOrEmpty(apiKey))
            {
                _logger.LogInformation("Declaring/updating {Count} data sources with PULSE Cloud...", dtoList.Count);
                bool success = await _cloudClient.UpsertDataSourcesAsync(baseUrl, apiKey, dtoList);
                if (success)
                {
                    _logger.LogInformation("Successfully declared data sources to cloud.");
                    return true;
                }
                else
                {
                    _logger.LogWarning("Failed to declare data sources to cloud.");
                    return false;
                }
            }
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error while pushing data sources to cloud");
            return false;
        }
    }

    private async Task StartCloudProvisioningLoopAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PULSE Cloud Provisioning Loop started.");
        
        int claimPollSeconds = 20;
        if (int.TryParse(_configuration["Cloud:ClaimPollSeconds"], out int parsedSeconds))
        {
            claimPollSeconds = parsedSeconds;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            int loopDelayMs = claimPollSeconds * 1000;
            try
            {
                // Reload config from database in case it was updated by user via UI settings
                var dbConfig = await _storageService.GetDeviceConfigAsync();
                if (dbConfig != null)
                {
                    _deviceConfig = dbConfig;
                }

                if (_deviceConfig == null)
                {
                    await Task.Delay(3000, stoppingToken);
                    continue;
                }

                // Generate PairingToken if not present
                if (string.IsNullOrEmpty(_deviceConfig.PairingToken))
                {
                    var tokenBytes = new byte[24];
                    using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
                    {
                        rng.GetBytes(tokenBytes);
                    }
                    _deviceConfig.PairingToken = Convert.ToHexString(tokenBytes).ToLowerInvariant();
                    await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                }

                string currentBaseUrl = _deviceConfig.CloudEndpoint;

                if (string.IsNullOrEmpty(_deviceConfig.ApiKey))
                {
                    // Pairing & Claiming Phase
                    bool needsRegister = string.IsNullOrEmpty(_deviceConfig.PairingShortCode) ||
                                         !_deviceConfig.PairingExpiresAt.HasValue ||
                                         _deviceConfig.PairingExpiresAt.Value <= DateTime.UtcNow.AddMinutes(1);

                    bool registerSuccess = true;
                    if (needsRegister)
                    {
                        _logger.LogInformation("[Cloud Provisioning] Registering device with Cloud...");
                        var regResult = await _cloudClient.RegisterDeviceAsync(
                            currentBaseUrl,
                            _deviceConfig.Id,
                            _deviceConfig.SerialNumber,
                            _deviceConfig.Version,
                            _deviceConfig.ClaimSecret,
                            _deviceConfig.PairingToken
                        );

                        if (regResult != null)
                        {
                            _deviceConfig.CloudEdgeId = regResult.EdgeId;
                            _deviceConfig.PairingShortCode = regResult.ShortCode ?? "";
                            _deviceConfig.PairingExpiresAt = regResult.PairingExpiresAt;
                            _deviceConfig.PairingBaseUrl = regResult.PairingBaseUrl ?? "";
                            _deviceConfig.CloudStatus = "PendingApproval";
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            _logger.LogInformation("[Cloud Provisioning] Registered. Code: {Code}, Expiry: {Expiry}", regResult.ShortCode, regResult.PairingExpiresAt);
                        }
                        else
                        {
                            registerSuccess = false;
                            _logger.LogWarning("[Cloud Provisioning] Registration failed. Will retry registration.");
                        }
                    }

                    if (registerSuccess)
                    {
                        // We are registered, now poll claim endpoint (every 5 seconds during pairing phase)
                        loopDelayMs = 5000;

                        _logger.LogInformation("[Cloud Provisioning] Polling claim endpoint...");
                        var claimResult = await _cloudClient.ClaimKeyAsync(currentBaseUrl, _deviceConfig.Id, _deviceConfig.ClaimSecret);

                        if (claimResult.Status == "active" && !string.IsNullOrEmpty(claimResult.ApiKey))
                        {
                            _logger.LogInformation("[Cloud Provisioning] API Key successfully claimed!");
                            _deviceConfig.ApiKey = claimResult.ApiKey;
                            _deviceConfig.OrganizationId = claimResult.OrgId ?? "";
                            _deviceConfig.OrganizationName = claimResult.OrgName ?? "";
                            _deviceConfig.SiteId = claimResult.SiteId ?? "";
                            _deviceConfig.SiteName = claimResult.SiteName ?? "";
                            _deviceConfig.CloudStatus = "Connected";
                            _deviceConfig.PairingShortCode = "";
                            _deviceConfig.PairingExpiresAt = null;
                            _deviceConfig.PairingBaseUrl = "";
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);

                            // Immediately pull config & push data sources
                            var configResult = await _cloudClient.GetConfigAsync(currentBaseUrl, claimResult.ApiKey);
                            if (configResult.Success)
                            {
                                _deviceConfig.OrganizationId = configResult.OrgId;
                                _deviceConfig.OrganizationName = configResult.OrgName;
                                _deviceConfig.SiteId = configResult.SiteId;
                                _deviceConfig.SiteName = configResult.SiteName;
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }

                            bool success = await PushDataSourcesToCloudAsync(currentBaseUrl, claimResult.ApiKey);
                            if (success)
                            {
                                _lastDataSourcesHash = await CalculateDataSourcesHashAsync();
                            }
                            // Reset loop delay to default config
                            loopDelayMs = claimPollSeconds * 1000;
                        }
                        else if (claimResult.Status == "revoked")
                        {
                            _logger.LogError("[Cloud Provisioning] Device has been revoked. Operator re-approval required.");
                            if (_deviceConfig.CloudStatus != "Revoked")
                            {
                                _deviceConfig.CloudStatus = "Revoked";
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }
                        }
                        else if (claimResult.Status == "unauthorized")
                        {
                            _logger.LogWarning("[Cloud Provisioning] Claim unauthorized. Device unknown or wrong secret.");
                            if (_deviceConfig.CloudStatus != "PendingApproval")
                            {
                                _deviceConfig.CloudStatus = "PendingApproval";
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }
                        }
                        else
                        {
                            // Status is "pending" or other.
                            if (_deviceConfig.CloudStatus != "PendingApproval" && _deviceConfig.CloudStatus != "Revoked")
                            {
                                _deviceConfig.CloudStatus = "PendingApproval";
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }
                        }
                    }
                    else
                    {
                        loopDelayMs = 10000; // Registration failed, retry in 10s
                    }
                }
                else
                {
                    // ApiKey is present. If we are in "PendingApproval" or "Revoked" or "Disconnected", we should fetch config.
                    // Or if we haven't fetched config yet, fetch it.
                    if (!_hasInitialConfigSyncRun || _deviceConfig.CloudStatus != "Connected")
                    {
                        _logger.LogInformation("[Cloud Provisioning] API Key is present. Fetching configuration...");
                        var configResult = await _cloudClient.GetConfigAsync(currentBaseUrl, _deviceConfig.ApiKey);
                        if (configResult.Success)
                        {
                            _logger.LogInformation("[Cloud Provisioning] Successfully retrieved config. Site: {SiteName}", configResult.SiteName);
                            _deviceConfig.OrganizationId = configResult.OrgId;
                            _deviceConfig.OrganizationName = configResult.OrgName;
                            _deviceConfig.SiteId = configResult.SiteId;
                            _deviceConfig.SiteName = configResult.SiteName;
                            _deviceConfig.CloudStatus = "Connected";
                            _hasInitialConfigSyncRun = true;
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);

                            bool success = await PushDataSourcesToCloudAsync(currentBaseUrl, _deviceConfig.ApiKey);
                            if (success)
                            {
                                _lastDataSourcesHash = await CalculateDataSourcesHashAsync();
                            }
                        }
                        else if (configResult.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                        {
                            _logger.LogError("[Cloud Provisioning] API Key is invalid or has been revoked (401 Unauthorized). Resetting API Key for re-onboarding.");
                            _deviceConfig.ApiKey = "";
                            _deviceConfig.OrganizationId = "";
                            _deviceConfig.OrganizationName = "";
                            _deviceConfig.SiteId = "";
                            _deviceConfig.SiteName = "";
                            _deviceConfig.PairingShortCode = "";
                            _deviceConfig.PairingExpiresAt = null;
                            _deviceConfig.PairingBaseUrl = "";
                            _deviceConfig.CloudStatus = "PendingApproval"; // Return to claim/polling phase
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                        }
                        else
                        {
                            _logger.LogWarning("[Cloud Provisioning] Failed to fetch configuration (Status: {StatusCode}). Will retry.", configResult.StatusCode);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in Cloud Provisioning loop.");
            }

            // Wait before next check/poll
            await Task.Delay(loopDelayMs, stoppingToken);
        }
    }

    private async Task ProcessDataPointValueAsync(QueueDbContext dbLookup, DataPoint dp, string? extractedValue, DateTime receivedAt)
    {
        bool isOfflineSignal = false;
        if (extractedValue == null)
        {
            isOfflineSignal = true;
        }
        else
        {
            var trimmed = extractedValue.Trim();
            if (string.Equals(trimmed, "null", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(trimmed, "offline", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(trimmed, "timeout", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(trimmed, "none", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(trimmed, "", StringComparison.OrdinalIgnoreCase))
            {
                isOfflineSignal = true;
            }
        }

        if (isOfflineSignal)
        {
            dp.LastError = "Device reported offline / timeout via MQTT payload";
            dp.ConsecutiveFailures++;
            dp.LastUpdated = receivedAt;
            dbLookup.DataPoints.Update(dp);

            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
            {
                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                {
                    string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, quality);
                    _logger.LogWarning("[MQTT Link] Enqueued offline status for Stream {Source} | Metric: {Metric} | Quality: {Quality}", dp.DataSourceId, dp.Metric, quality);

                    // Propagate LWT offline status to all other MQTT tags of the same DataSource (legacy fallback)
                    if (string.IsNullOrEmpty(dp.MqttDeviceId))
                    {
                        var otherMqttDps = await dbLookup.DataPoints
                            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && x.DataSourceId == dp.DataSourceId && x.Id != dp.Id && (x.MqttDeviceId == null || x.MqttDeviceId == ""))
                            .ToListAsync();

                        foreach (var otherDp in otherMqttDps)
                        {
                            if (string.IsNullOrEmpty(otherDp.DataSourceId) || string.IsNullOrEmpty(otherDp.Metric))
                                continue;

                            otherDp.LastError = $"Device reported offline via LWT heartbeat on topic '{dp.Address}'";
                            otherDp.ConsecutiveFailures = dp.ConsecutiveFailures;
                            otherDp.LastUpdated = receivedAt;
                            dbLookup.DataPoints.Update(otherDp);

                            await _storageService.EnqueueTelemetryAsync(otherDp.DataSourceId, receivedAt, otherDp.Metric, null, quality);
                            _logger.LogWarning("[MQTT Link] Propagated LWT offline status to legacy tag | Stream: {Source} | Metric: {Metric} | Quality: {Quality}", otherDp.DataSourceId, otherDp.Metric, quality);
                        }
                    }
                }
            }
            return;
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
            dbLookup.DataPoints.Update(dp);

            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
            {
                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                {
                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, processedVal, "Good");
                    _logger.LogInformation("[Queue Buffer] Enqueued MQTT telemetry for Stream {Source} | Metric: {Metric} | Val: {Val}", dp.DataSourceId, dp.Metric, processedVal);

                    // If this is a heartbeat/status tag, restore sibling MQTT tags on the same DataSource back to online (legacy fallback)
                    bool isStatusTag = string.Equals(dp.Metric, "heartbeat", StringComparison.OrdinalIgnoreCase) ||
                                       string.Equals(dp.Metric, "status", StringComparison.OrdinalIgnoreCase);

                    if (isStatusTag && string.IsNullOrEmpty(dp.MqttDeviceId))
                    {
                        var otherMqttDps = await dbLookup.DataPoints
                            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && x.DataSourceId == dp.DataSourceId && x.Id != dp.Id && (x.MqttDeviceId == null || x.MqttDeviceId == ""))
                            .ToListAsync();

                        foreach (var otherDp in otherMqttDps)
                        {
                            if (string.IsNullOrEmpty(otherDp.DataSourceId) || string.IsNullOrEmpty(otherDp.Metric))
                                continue;

                            if (otherDp.ConsecutiveFailures > 0)
                            {
                                otherDp.LastError = null;
                                otherDp.ConsecutiveFailures = 0;
                                otherDp.LastUpdated = receivedAt;
                                dbLookup.DataPoints.Update(otherDp);

                                double? lastValNode = null;
                                if (double.TryParse(otherDp.LastValue, out double parsedLast))
                                {
                                    lastValNode = parsedLast;
                                }

                                await _storageService.EnqueueTelemetryAsync(otherDp.DataSourceId, receivedAt, otherDp.Metric, lastValNode, "Stale");
                                _logger.LogInformation("[MQTT Link] Restored other MQTT tag to online | Stream: {Source} | Metric: {Metric} | LastVal: {LastVal}", otherDp.DataSourceId, otherDp.Metric, lastValNode);
                            }
                        }
                    }
                }
            }
        }
        else
        {
            dp.LastError = $"Failed to parse extracted value '{extractedValue}' as double or boolean";
            dp.ConsecutiveFailures++;
            dp.LastUpdated = receivedAt;
            dbLookup.DataPoints.Update(dp);

            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
            {
                if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                {
                    await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                }
            }
        }
    }

    public static bool MqttTopicMatches(string filter, string topic)
    {
        if (string.Equals(filter, topic)) return true;
        if (filter == "#") return true;

        var filterParts = filter.Split('/');
        var topicParts = topic.Split('/');

        for (int i = 0; i < filterParts.Length; i++)
        {
            if (filterParts[i] == "#")
                return true;

            if (filterParts[i] == "+")
            {
                if (i >= topicParts.Length)
                    return false;
                continue;
            }

            if (i >= topicParts.Length || !string.Equals(filterParts[i], topicParts[i]))
                return false;
        }

        return topicParts.Length == filterParts.Length;
    }

    private async Task<List<string>> GetActiveMqttTopicsAsync(QueueDbContext db)
    {
        var topics = new List<string>();

        // 1. Load active MQTT devices
        var activeDevices = await db.MqttDevices
            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled)
            .ToListAsync();

        foreach (var dev in activeDevices)
        {
            if (!string.IsNullOrWhiteSpace(dev.TopicSubscription))
                topics.Add(dev.TopicSubscription);
            if (!string.IsNullOrWhiteSpace(dev.LwtTopic))
                topics.Add(dev.LwtTopic);
        }

        // 2. Load active legacy MQTT data points (no MqttDeviceId)
        var legacyDps = await db.DataPoints
            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && (x.MqttDeviceId == null || x.MqttDeviceId == ""))
            .ToListAsync();

        foreach (var dp in legacyDps)
        {
            if (!string.IsNullOrWhiteSpace(dp.Address))
                topics.Add(dp.Address);
        }

        return topics.Distinct().OrderBy(x => x).ToList();
    }
}


