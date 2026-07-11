using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Protocols.S7Net;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class S7DriverPoller : IProtocolDriver
{
    private readonly ILogger<S7DriverPoller> _logger;
    private readonly S7NetDriver _s7NetDriver;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();

    public string ProtocolName => "Siemens S7";
    public bool IsConnected => _s7NetDriver.IsConnected;

    public S7DriverPoller(
        ILogger<S7DriverPoller> logger,
        S7NetDriver s7NetDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _s7NetDriver = s7NetDriver;
        _storageService = storageService;
    }

    public async Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        var (cpuType, rack, slot, timeoutMs) = ParseS7Config(adapter);
        await _s7NetDriver.ConnectAsync(adapter.Host, cpuType, rack, slot, timeoutMs, ct);
    }

    public Task DisconnectAsync(CancellationToken ct)
    {
        _s7NetDriver.Disconnect();
        return Task.CompletedTask;
    }

    public async Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
        if (!_s7NetDriver.IsConnected)
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
            var readTimer = Stopwatch.StartNew();
            double? processedVal = null;
            string quality = "Good";

            try
            {
                double rawVal = await _s7NetDriver.ReadTagAsync(dp.Address, dp.DataType, ct);
                double val = (rawVal * dp.ScaleFactor) + dp.Offset;
                _logger.LogDebug("[Siemens S7 Read] Address: {Address} | Raw: {Raw} | Processed: {Value}", dp.Address, rawVal, val);
                
                dp.LastValue = val.ToString("F2");
                dp.LastError = null;
                dp.ConsecutiveFailures = 0;
                dp.LastUpdated = now;
                processedVal = val;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Siemens S7 read failed for address {Address} on adapter {AdapterId}", dp.Address, adapter.Id);
                dp.LastError = ex.Message;
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
            }

            readTimer.Stop();
            dp.LastLatencyMs = Math.Round(readTimer.Elapsed.TotalMilliseconds, 1);

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
                    _logger.LogInformation("[Queue Buffer] Enqueued Siemens S7 telemetry | Stream: {Source} Metric: {Metric}", dataSourceId, metricKvp.Key);
                }
            }
        }
    }

    private static (string CpuType, short Rack, short Slot, int TimeoutMs) ParseS7Config(DriverAdapter adapter)
    {
        string cpuType = "S71200";
        short rack = 0;
        short slot = 1;
        int timeoutMs = 5000;
        
        try
        {
            if (!string.IsNullOrEmpty(adapter.ConfigJson))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("CpuType", out var cpuProp)) cpuType = cpuProp.GetString() ?? cpuType;
                if (root.TryGetProperty("Rack", out var rackProp)) rack = rackProp.GetInt16();
                if (root.TryGetProperty("Slot", out var slotProp)) slot = slotProp.GetInt16();
                if (root.TryGetProperty("TimeoutMs", out var toProp)) timeoutMs = toProp.GetInt32();
            }
        }
        catch { /* fallback to defaults */ }
        
        return (cpuType, rack, slot, timeoutMs);
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
