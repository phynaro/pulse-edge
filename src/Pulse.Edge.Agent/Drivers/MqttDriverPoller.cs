using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class MqttDriverPoller : IProtocolDriver
{
    private readonly ILogger<MqttDriverPoller> _logger;
    private readonly MqttDriver _mqttDriver;
    private readonly QueueStorageService _storageService;
    private string _mqttAdapterId = "adp-mqtt-1";

    public string ProtocolName => "MQTT";
    public bool IsConnected => _mqttDriver.IsConnected;

    public MqttDriverPoller(
        ILogger<MqttDriverPoller> logger,
        MqttDriver mqttDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _mqttDriver = mqttDriver;
        _storageService = storageService;

        // Register message listener
        _mqttDriver.MessageReceivedAsync += OnMessageReceivedAsync;
    }

    public async Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        _mqttAdapterId = adapter.Id;
        using var db = new QueueDbContext();
        var topics = await GetActiveMqttTopicsAsync(db);
        await _mqttDriver.ConnectAndSubscribeAsync(adapter.Host, adapter.Port, topics);
    }

    public async Task DisconnectAsync(CancellationToken ct)
    {
        await _mqttDriver.DisconnectAsync();
    }

    public Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
        // MQTT is event-driven; no periodic polling is required, but we can verify status here.
        return Task.CompletedTask;
    }

    private async Task OnMessageReceivedAsync(string topic, string payload)
    {
        var messageTimer = Stopwatch.StartNew();
        var safePayload = payload ?? string.Empty;
        _logger.LogInformation("[MQTT Link] Telemetry packet intercepted on topic '{Topic}'. Resolving mapping...", topic);

        var receivedAt = DateTime.UtcNow;
        using var dbLookup = new QueueDbContext();

        // Cache the seen topic and payload for browsing support
        try
        {
            await dbLookup.Database.ExecuteSqlRawAsync(
                "INSERT INTO MqttSeenTopics (Topic, Payload, LastSeen) VALUES ({0}, {1}, {2}) ON CONFLICT(Topic) DO UPDATE SET Payload = {1}, LastSeen = {2};",
                topic, safePayload, receivedAt.ToString("o"));
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
            bool isOffline = string.Equals(safePayload, dev.LwtOfflinePayload, StringComparison.OrdinalIgnoreCase);
            bool isOnline = string.Equals(safePayload, dev.LwtOnlinePayload, StringComparison.OrdinalIgnoreCase);

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
                    jsonDoc = System.Text.Json.JsonDocument.Parse(safePayload);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[MQTT Device Link] Failed to parse payload as JSON on topic '{Topic}': {Payload}", topic, safePayload);
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
                        string? extractedValue = GetJsonValueByPath(safePayload, jsonPath ?? string.Empty);

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
                        extractedValue = GetJsonValueByPath(safePayload, dp.MqttJsonPath ?? string.Empty);
                    }
                    else
                    {
                        extractedValue = safePayload;
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
                    jsonDoc = System.Text.Json.JsonDocument.Parse(safePayload);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[MQTT Legacy Link] Failed to parse payload as JSON on topic '{Topic}': {Payload}", topic, safePayload);
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
                            extractedValue = GetJsonValueByPath(safePayload, dp.MqttJsonPath ?? string.Empty);
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
                        extractedValue = safePayload;
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

        messageTimer.Stop();
        var processingLatencyMs = Math.Round(messageTimer.Elapsed.TotalMilliseconds, 1);
        foreach (var entry in dbLookup.ChangeTracker.Entries<DataPoint>()
                     .Where(entry => entry.State == EntityState.Modified))
        {
            entry.Entity.LastLatencyMs = processingLatencyMs;
        }

        await dbLookup.SaveChangesAsync();
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
        var lwtTopics = await db.MqttDevices
            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && !string.IsNullOrEmpty(x.LwtTopic))
            .Select(x => x.LwtTopic!)
            .ToListAsync();
        topics.AddRange(lwtTopics);

        var subTopics = await db.MqttDevices
            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && !string.IsNullOrEmpty(x.TopicSubscription))
            .Select(x => x.TopicSubscription!)
            .ToListAsync();
        topics.AddRange(subTopics);

        var legacyTopics = await db.DataPoints
            .Where(x => x.AdapterId == _mqttAdapterId && x.IsEnabled && (x.MqttDeviceId == null || x.MqttDeviceId == "") && !string.IsNullOrEmpty(x.Address))
            .Select(x => x.Address!)
            .ToListAsync();
        topics.AddRange(legacyTopics);

        return topics.Distinct().ToList();
    }

    public static string? GetJsonValueByPath(string json, string path) =>
        Pulse.Edge.Storage.Helpers.JsonPathHelper.GetJsonValueByPath(json, path);
}
