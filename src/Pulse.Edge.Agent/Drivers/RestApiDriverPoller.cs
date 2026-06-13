using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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

        var dueDps = group.Where(dp =>
        {
            int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
            int effectiveInterval = dp.ConsecutiveFailures > 0
                ? baseInterval * (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6))
                : baseInterval;
            return dp.LastUpdated == null || (now - dp.LastUpdated.Value).TotalMilliseconds >= effectiveInterval;
        }).ToList();

        if (dueDps.Count == 0) return;

        try
        {
            // Fetch the payload once for the group (since they all query the same REST endpoint)
            string payload = await _restApiDriver.FetchPayloadAsync(ct);
            
            // Parse payload as JSON
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;

            foreach (var dp in dueDps)
            {
                try
                {
                    string? jsonPath = !string.IsNullOrEmpty(dp.MqttJsonPath) ? dp.MqttJsonPath : dp.Address;
                    string? extractedValue = GetJsonValueByElement(root, jsonPath ?? string.Empty);

                    if (extractedValue == null)
                    {
                        dp.LastError = $"JSON path '{jsonPath}' not found";
                        dp.ConsecutiveFailures++;
                        dp.LastUpdated = now;
                        AddDirtyIfNeeded(dp, now, dirtyDps);
                        
                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                            {
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, "DriverError");
                            }
                        }
                        continue;
                    }

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
                        dp.LastUpdated = now;

                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                            {
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, processedVal, "Good");
                                _logger.LogInformation("[Queue Buffer] Enqueued REST API telemetry | Stream: {Source} Metric: {Metric} Val: {Val}", dp.DataSourceId, dp.Metric, processedVal);
                            }
                        }
                    }
                    else
                    {
                        dp.LastError = $"Failed to parse extracted value '{extractedValue}' as double or boolean";
                        dp.ConsecutiveFailures++;
                        dp.LastUpdated = now;

                        if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                        {
                            if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                            {
                                await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, "DriverError");
                            }
                        }
                    }

                    AddDirtyIfNeeded(dp, now, dirtyDps);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing tag {Address} for REST API adapter", dp.Address);
                    dp.LastError = ex.Message;
                    dp.ConsecutiveFailures++;
                    dp.LastUpdated = now;
                    AddDirtyIfNeeded(dp, now, dirtyDps);

                    if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                    {
                        if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                        {
                            await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, "DriverError");
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "REST API fetch failed for adapter {AdapterId}", adapter.Id);
            foreach (var dp in dueDps)
            {
                dp.LastError = $"Fetch failed: {ex.Message}";
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                AddDirtyIfNeeded(dp, now, dirtyDps);

                if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                {
                    if (await _storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                    {
                        await _storageService.EnqueueTelemetryAsync(dp.DataSourceId, now, dp.Metric, null, "DriverError");
                    }
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

    private static string? GetJsonValueByElement(JsonElement element, string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        try
        {
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

                if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(cleanPart, out var child))
                {
                    element = child;
                }
                else
                {
                    return null;
                }

                if (arrayIndex >= 0)
                {
                    if (element.ValueKind == JsonValueKind.Array && arrayIndex < element.GetArrayLength())
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
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Null => null,
                _ => element.GetRawText()
            };
        }
        catch
        {
            return null;
        }
    }
}
