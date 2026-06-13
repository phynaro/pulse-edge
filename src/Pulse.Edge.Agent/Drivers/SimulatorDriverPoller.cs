using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class SimulatorDriverPoller : IProtocolDriver
{
    private readonly ILogger<SimulatorDriverPoller> _logger;
    private readonly SimulatorDriver _simulatorDriver;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();

    public string ProtocolName => "SIMULATOR";
    public bool IsConnected => true; // Simulator is always connected

    public SimulatorDriverPoller(
        ILogger<SimulatorDriverPoller> logger,
        SimulatorDriver simulatorDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _simulatorDriver = simulatorDriver;
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
        string adapterId = adapter.Id;
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
