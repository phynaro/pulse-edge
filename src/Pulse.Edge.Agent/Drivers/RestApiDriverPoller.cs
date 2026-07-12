using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Protocols.RestApi;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class RestApiDriverPoller : IProtocolDriver
{
    private readonly ILogger<RestApiDriverPoller> _logger;
    private readonly RestApiDriver _restApiDriver;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();
    private readonly ConcurrentDictionary<string, DateTime> _lastFetchTimes = new();

    public string ProtocolName => "REST_API";
    public bool IsConnected => _restApiDriver.IsConnected;

    public RestApiDriverPoller(
        ILogger<RestApiDriverPoller> logger,
        RestApiDriver restApiDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _restApiDriver = restApiDriver;
        _storageService = storageService;
    }

    public async Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        await _restApiDriver.ConnectAsync(adapter.Host, adapter.Port, adapter.ConfigJson ?? "{}", ct);
    }

    public Task DisconnectAsync(CancellationToken ct)
    {
        _restApiDriver.Disconnect();
        return Task.CompletedTask;
    }

    public async Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
        if (!_restApiDriver.IsConnected)
        {
            return;
        }

        if (group.Count == 0) return;

        // Parse PollIntervalMs from adapter ConfigJson (default 10000ms)
        int pollIntervalMs = 10000;
        if (!string.IsNullOrEmpty(adapter.ConfigJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(adapter.ConfigJson);
                if (doc.RootElement.TryGetProperty("PollIntervalMs", out var prop))
                {
                    pollIntervalMs = prop.GetInt32();
                }
            }
            catch {}
        }
        pollIntervalMs = Math.Max(pollIntervalMs, 500); // 500ms safety floor

        // Enforce adapter-wide poll interval check
        _lastFetchTimes.TryGetValue(adapter.Id, out var lastFetch);
        if (lastFetch != default && (now - lastFetch).TotalMilliseconds < pollIntervalMs)
        {
            return;
        }

        // Group readings by DataSourceId to batch enqueue them at the end
        var readingsByDataSource = new Dictionary<string, Dictionary<string, (double? Value, string Quality)>>();

        var fetchTimer = Stopwatch.StartNew();
        try
        {
            // Fetch the payload once for the group (since they all query the same REST endpoint)
            string payload = await _restApiDriver.FetchPayloadAsync(ct);
            fetchTimer.Stop();
            var fetchLatencyMs = Math.Round(fetchTimer.Elapsed.TotalMilliseconds, 1);
            _lastFetchTimes[adapter.Id] = now;
            
            // Parse payload as JSON
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;

            foreach (var dp in group)
            {
                dp.LastLatencyMs = fetchLatencyMs;
                double? processedVal = null;
                string quality = "Good";

                try
                {
                    string? jsonPath = !string.IsNullOrEmpty(dp.MqttJsonPath) ? dp.MqttJsonPath : dp.Address;
                    string? extractedValue = GetJsonValueByElement(root, jsonPath ?? string.Empty);

                    if (extractedValue == null)
                    {
                        dp.LastError = $"JSON path '{jsonPath}' not found";
                        dp.ConsecutiveFailures++;
                        dp.LastUpdated = now;
                        quality = "DriverError";
                    }
                    else
                    {
                        // Process value
                        bool isOfflineSignal = false;
                        var trimmed = extractedValue.Trim();
                        if (string.Equals(trimmed, "null", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "offline", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "timeout", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "none", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "", StringComparison.OrdinalIgnoreCase))
                        {
                            isOfflineSignal = true;
                        }

                        if (isOfflineSignal)
                        {
                            dp.LastError = "Device reported offline / timeout via REST API payload";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = now;
                            quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                        }
                        else
                        {
                            bool isString = string.Equals(dp.DataType, "String", StringComparison.OrdinalIgnoreCase);

                            if (isString)
                            {
                                dp.LastValue = extractedValue;
                                dp.LastError = null;
                                dp.ConsecutiveFailures = 0;
                                dp.LastUpdated = now;
                                // For string metrics, the database stores null value but Quality="Good", while the text goes to LastValue
                                processedVal = null;
                            }
                            else
                            {
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
                                    double pVal = (val * dp.ScaleFactor) + dp.Offset;
                                    dp.LastValue = pVal.ToString("F2");
                                    dp.LastError = null;
                                    dp.ConsecutiveFailures = 0;
                                    dp.LastUpdated = now;
                                    processedVal = pVal;
                                }
                                else
                                {
                                    dp.LastError = $"Failed to parse extracted value '{extractedValue}' as double or boolean";
                                    dp.ConsecutiveFailures++;
                                    dp.LastUpdated = now;
                                    quality = "DriverError";
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing tag {Address} for REST API adapter", dp.Address);
                    dp.LastError = ex.Message;
                    dp.ConsecutiveFailures++;
                    dp.LastUpdated = now;
                    quality = "DriverError";
                }

                AddDirtyIfNeeded(dp, now, dirtyDps);

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (!readingsByDataSource.TryGetValue(dp.DataSourceId, out var dict))
                    {
                        dict = new Dictionary<string, (double? Value, string Quality)>();
                        readingsByDataSource[dp.DataSourceId] = dict;
                    }
                    dict[dp.Metric] = (processedVal, quality);
                }
            }
        }
        catch (Exception ex)
        {
            fetchTimer.Stop();
            var failedFetchLatencyMs = Math.Round(fetchTimer.Elapsed.TotalMilliseconds, 1);
            _logger.LogError(ex, "REST API fetch failed for adapter {AdapterId}", adapter.Id);
            foreach (var dp in group)
            {
                dp.LastLatencyMs = failedFetchLatencyMs;
                dp.LastError = $"Fetch failed: {ex.Message}";
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                AddDirtyIfNeeded(dp, now, dirtyDps);

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (!readingsByDataSource.TryGetValue(dp.DataSourceId, out var dict))
                    {
                        dict = new Dictionary<string, (double? Value, string Quality)>();
                        readingsByDataSource[dp.DataSourceId] = dict;
                    }
                    dict[dp.Metric] = (null, "DriverError");
                }
            }
        }

        // Enqueue readings in batch per DataSourceId
        foreach (var kvp in readingsByDataSource)
        {
            var dataSourceId = kvp.Key;
            var metrics = kvp.Value;

            if (await _storageService.IsDataSourceEnabledAsync(dataSourceId))
            {
                await _storageService.EnqueueTelemetryBatchAsync(dataSourceId, now, metrics);
                foreach (var metricKvp in metrics)
                {
                    _logger.LogDebug("[Queue Buffer] Enqueued REST API telemetry | Stream: {Source} Metric: {Metric}", dataSourceId, metricKvp.Key);
                }
            }
        }
    }

    private void AddDirtyIfNeeded(DataPoint dp, DateTime now, List<DataPoint> dirtyDps)
    {
        bool shouldWrite = !_lastDbWriteTimes.TryGetValue(dp.Id, out var lastWrite)
                          || (now - lastWrite).TotalSeconds >= 1;
        if (shouldWrite)
        {
            _lastDbWriteTimes[dp.Id] = now;
            lock (dirtyDps)
            {
                dirtyDps.Add(dp);
            }
        }
    }

    private static string? GetJsonValueByElement(JsonElement element, string path) =>
        Pulse.Edge.Storage.Helpers.JsonPathHelper.GetJsonValueByElement(element, path);
}
