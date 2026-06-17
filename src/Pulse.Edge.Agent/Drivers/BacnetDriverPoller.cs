using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Protocols.Bacnet;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class BacnetDriverPoller : IProtocolDriver
{
    private readonly ILogger<BacnetDriverPoller> _logger;
    private readonly BacnetDriver _bacnetDriver;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();

    public string ProtocolName => "BACnet";
    public bool IsConnected => _bacnetDriver.IsConnected;

    public BacnetDriverPoller(
        ILogger<BacnetDriverPoller> logger,
        BacnetDriver bacnetDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _bacnetDriver = bacnetDriver;
        _storageService = storageService;
    }

    public async Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        int deviceId = 123;
        try
        {
            if (!string.IsNullOrEmpty(adapter.ConfigJson))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("DeviceId", out var devProp))
                {
                    deviceId = devProp.GetInt32();
                }
            }
        }
        catch { /* fallback */ }

        int port = adapter.Port > 0 ? adapter.Port : 47808;
        await _bacnetDriver.ConnectAsync(adapter.Host, deviceId, port, ct);
    }

    public Task DisconnectAsync(CancellationToken ct)
    {
        _bacnetDriver.Disconnect();
        return Task.CompletedTask;
    }

    public async Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
        if (!_bacnetDriver.IsConnected)
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

        // Group readings by DataSourceId to batch enqueue them at the end
        var readingsByDataSource = new Dictionary<string, Dictionary<string, (double? Value, string Quality)>>();

        foreach (var dp in dueDps)
        {
            double? processedVal = null;
            string quality = "Good";

            try
            {
                double rawVal = await _bacnetDriver.ReadTagAsync(dp.Address, dp.DataType, ct);
                double val = (rawVal * dp.ScaleFactor) + dp.Offset;
                _logger.LogInformation("[BACnet Read] Address: {Address} | Raw: {Raw} | Processed: {Value}", dp.Address, rawVal, val);
                
                dp.LastValue = val.ToString("F2");
                dp.LastError = null;
                dp.ConsecutiveFailures = 0;
                dp.LastUpdated = now;
                processedVal = val;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "BACnet read failed for address {Address} on adapter {AdapterId}", dp.Address, adapter.Id);
                dp.LastError = ex.Message;
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
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
                    _logger.LogInformation("[Queue Buffer] Enqueued BACnet telemetry | Stream: {Source} Metric: {Metric}", dataSourceId, metricKvp.Key);
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
}
