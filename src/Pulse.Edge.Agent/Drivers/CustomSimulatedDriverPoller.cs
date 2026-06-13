using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class CustomSimulatedDriverPoller : IProtocolDriver
{
    private readonly ILogger<CustomSimulatedDriverPoller> _logger;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();

    public string ProtocolName => "CUSTOM_SIMULATED";
    public bool IsConnected => true; // Custom simulated adapters are always connected

    public CustomSimulatedDriverPoller(
        ILogger<CustomSimulatedDriverPoller> logger,
        QueueStorageService storageService)
    {
        _logger = logger;
        _storageService = storageService;
    }

    public Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        return Task.CompletedTask;
    }

    public Task DisconnectAsync(CancellationToken ct)
    {
        return Task.CompletedTask;
    }

    public async Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
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

            if (updated)
            {
                bool shouldWrite = dp.LastError != prevError
                    || !_lastDbWriteTimes.TryGetValue(dp.Id, out var lastWrite)
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
    }
}
