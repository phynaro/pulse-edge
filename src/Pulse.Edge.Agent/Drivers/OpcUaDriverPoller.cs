using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class OpcUaDriverPoller : IProtocolDriver
{
    private readonly ILogger<OpcUaDriverPoller> _logger;
    private readonly OpcUaDriver _opcUaDriver;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();

    public string ProtocolName => "OPC_UA";
    public bool IsConnected => _opcUaDriver.IsConnected;

    public OpcUaDriverPoller(
        ILogger<OpcUaDriverPoller> logger,
        OpcUaDriver opcUaDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _opcUaDriver = opcUaDriver;
        _storageService = storageService;
    }

    public async Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        string endpoint = adapter.Host ?? "opc.tcp://localhost:4840";
        if (!endpoint.StartsWith("opc.tcp://", StringComparison.OrdinalIgnoreCase))
        {
            if (endpoint.Contains(":"))
            {
                endpoint = $"opc.tcp://{endpoint}";
            }
            else
            {
                endpoint = $"opc.tcp://{endpoint}:{adapter.Port}";
            }
        }
        await _opcUaDriver.ConnectAsync(endpoint);
    }

    public Task DisconnectAsync(CancellationToken ct)
    {
        // OpcUaDriver is managed as a Singleton, we do not dispose it here,
        // but we can call a disconnect method if available. There's no disconnect
        // method in OpcUaDriver, it manages session recovery automatically.
        return Task.CompletedTask;
    }

    public async Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
        if (!_opcUaDriver.IsConnected)
        {
            return;
        }

        // Determine which data points are due for polling
        var dueDps = group.Where(dp =>
        {
            int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
            int effectiveInterval = dp.ConsecutiveFailures > 0
                ? baseInterval * (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6))
                : baseInterval;
            return dp.LastUpdated == null || (now - dp.LastUpdated.Value).TotalMilliseconds >= effectiveInterval;
        }).ToList();

        if (dueDps.Count == 0) return;

        var nodeIds = dueDps.Select(dp => dp.Address).ToList();

        // Group readings by DataSourceId to batch enqueue them at the end
        var readingsByDataSource = new Dictionary<string, Dictionary<string, (double? Value, string Quality)>>();

        Dictionary<string, OpcUaReadResult> batchResult;
        var readTimer = Stopwatch.StartNew();
        try
        {
            batchResult = await _opcUaDriver.ReadMetricsBatchAsync(nodeIds, ct);
            readTimer.Stop();
        }
        catch (Exception ex)
        {
            readTimer.Stop();
            var failedReadLatencyMs = Math.Round(readTimer.Elapsed.TotalMilliseconds, 1);
            _logger.LogError(ex, "OPC UA batch read failed for adapter {AdapterId}", adapter.Id);
            foreach (var dp in dueDps)
            {
                dp.LastLatencyMs = failedReadLatencyMs;
                dp.LastError = ex.Message;
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
                    string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                    dict[dp.Metric] = (null, quality);
                }
            }

            // Enqueue batch results on read failure
            foreach (var kvp in readingsByDataSource)
            {
                var dataSourceId = kvp.Key;
                var metrics = kvp.Value;
                if (await _storageService.IsDataSourceEnabledAsync(dataSourceId))
                {
                    await _storageService.EnqueueTelemetryBatchAsync(dataSourceId, now, metrics);
                }
            }

            if (!_opcUaDriver.IsConnected)
            {
                using var dbUpdate = new QueueDbContext();
                var adpUpdate = await dbUpdate.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id, ct);
                if (adpUpdate != null && adpUpdate.Status != "Error")
                {
                    adpUpdate.Status = "Error";
                    dbUpdate.DriverAdapters.Update(adpUpdate);
                    await dbUpdate.SaveChangesAsync(ct);
                }
            }
            return;
        }

        var readLatencyMs = Math.Round(readTimer.Elapsed.TotalMilliseconds, 1);

        foreach (var dp in dueDps)
        {
            // OPC UA reads are issued as one batch, so each tag shares the batch round-trip latency.
            dp.LastLatencyMs = readLatencyMs;
            double? processedVal = null;
            string quality = "Good";

            if (!batchResult.TryGetValue(dp.Address, out var readRes) || readRes == null)
            {
                dp.LastError = "Tag value was not returned in batch result";
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
            }
            else if (!readRes.Success)
            {
                dp.LastError = readRes.ErrorMessage ?? "Unknown OPC UA read error";
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
            }
            else
            {
                try
                {
                    double currentVal = readRes.Value;
                    double val = (currentVal * dp.ScaleFactor) + dp.Offset;
                    _logger.LogInformation("[Telemetry Read] Node: {Node} | Raw: {Raw} | Processed: {Value}", dp.Address, currentVal, val);
                    dp.LastValue = val.ToString("F2");
                    dp.LastError = null;
                    dp.ConsecutiveFailures = 0;
                    dp.LastUpdated = now;
                    processedVal = val;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to parse OPC UA telemetry for Node {Node}", dp.Address);
                    dp.LastError = ex.Message;
                    dp.ConsecutiveFailures++;
                    dp.LastUpdated = now;
                    quality = "DriverError";
                }
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
                    _logger.LogInformation("[Queue Buffer] Enqueued OPC UA telemetry | Stream: {Source} Metric: {Metric}", dataSourceId, metricKvp.Key);
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
