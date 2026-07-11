using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Agent.Drivers;
using Pulse.Edge.Agent.Services;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent;

public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly QueueStorageService _storageService;
    private readonly CloudClient _cloudClient;
    private readonly SyncService _syncService;
    private readonly DriverPollerRegistry _pollerRegistry;
    private readonly EdgeConfigMonitor _configMonitor;
    private readonly CloudProvisioningService _provisioningService;

    private DateTime _lastHeartbeat = DateTime.MinValue;
    private readonly Dictionary<string, (DateTime LastAttempt, int FailureCount)> _adapterConnectionStates = new();

    public Worker(
        ILogger<Worker> logger,
        QueueStorageService storageService,
        CloudClient cloudClient,
        SyncService syncService,
        DriverPollerRegistry pollerRegistry,
        EdgeConfigMonitor configMonitor,
        CloudProvisioningService provisioningService)
    {
        _logger = logger;
        _storageService = storageService;
        _cloudClient = cloudClient;
        _syncService = syncService;
        _pollerRegistry = pollerRegistry;
        _configMonitor = configMonitor;
        _provisioningService = provisioningService;

        _configMonitor.OnAdapterChanged += HandleAdapterChanged;
    }

    public void WakeUpProvisioning()
    {
        _provisioningService.WakeUpProvisioning();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PULSE Edge Agent starting up...");

        // 1. Initialize SQLite Database
        _logger.LogInformation("Initializing local SQLite storage...");
        await _storageService.InitializeAsync();
        _logger.LogInformation("SQLite database initialized successfully.");

        // Wait until configuration is available
        var deviceConfig = await _storageService.GetDeviceConfigAsync();
        if (deviceConfig == null)
        {
            _logger.LogWarning("No local device configuration found. Agent is pausing and waiting for user onboarding via the Web UI...");
            while (deviceConfig == null && !stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(3000, stoppingToken);
                deviceConfig = await _storageService.GetDeviceConfigAsync();
            }
            
            if (stoppingToken.IsCancellationRequested)
                return;
        }

        // Start Cloud Sync Loop in the background (Non-blocking Task)
        _ = Task.Run(() => _syncService.StartSyncLoopAsync(deviceConfig!.Id, deviceConfig!.ApiKey, stoppingToken), stoppingToken);

        // 3. Connect to Protocols (loaded dynamically from SQLite DB configs)
        using var db = new QueueDbContext();
        var allAdapters = await db.DriverAdapters.ToListAsync(stoppingToken);

        var connectTasks = allAdapters.Select(async adapter =>
        {
            var poller = _pollerRegistry.GetPoller(adapter.Id, adapter.Protocol);
            if (adapter.IsEnabled && poller != null)
            {
                try
                {
                    using (var dbContext = new QueueDbContext())
                    {
                        var dbAdapter = await dbContext.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                        if (dbAdapter != null)
                        {
                            dbAdapter.Status = "Connecting";
                            dbContext.DriverAdapters.Update(dbAdapter);
                            await dbContext.SaveChangesAsync();
                        }
                    }
                    
                    await poller.ConnectAsync(adapter, stoppingToken);

                    using (var dbCtx = new QueueDbContext())
                    {
                        var adp = await dbCtx.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                        if (adp != null)
                        {
                            adp.Status = "Connected";
                            dbCtx.DriverAdapters.Update(adp);
                            await dbCtx.SaveChangesAsync();
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to connect adapter {AdapterName} ({Protocol}) on startup", adapter.Name, adapter.Protocol);
                    using var dbContext = new QueueDbContext();
                    var dbAdapter = await dbContext.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                    if (dbAdapter != null)
                    {
                        dbAdapter.Status = "Error";
                        dbContext.DriverAdapters.Update(dbAdapter);
                        await dbContext.SaveChangesAsync();
                    }
                }
            }
            else
            {
                using var dbContext = new QueueDbContext();
                var dbAdapter = await dbContext.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                if (dbAdapter != null)
                {
                    dbAdapter.Status = "Disconnected";
                    dbContext.DriverAdapters.Update(dbAdapter);
                    await dbContext.SaveChangesAsync();
                }
            }
        });
        await Task.WhenAll(connectTasks);

        _logger.LogInformation("PULSE Edge loops active. Running telemetry simulation...");

        int loopCount = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            var currentConfig = _configMonitor.CurrentConfig;
            if (currentConfig == null)
            {
                _logger.LogWarning("No active configuration. Agent is waiting for user onboarding...");
                while (currentConfig == null && !stoppingToken.IsCancellationRequested)
                {
                    await Task.Delay(2000, stoppingToken);
                    currentConfig = _configMonitor.CurrentConfig;
                }

                if (stoppingToken.IsCancellationRequested)
                    return;

                _logger.LogInformation("Configuration loaded! Resuming agent loops...");
                continue;
            }

            loopCount++;
            var now = DateTime.UtcNow;

            // 1. Periodically monitor and heal driver connections if adapters are enabled
            if (loopCount % 3 == 0) // every 300ms
            {
                var activeAdapters = _configMonitor.CurrentAdapters;
                foreach (var adapter in activeAdapters)
                {
                    if (adapter.IsEnabled)
                    {
                        var poller = _pollerRegistry.GetPoller(adapter.Id, adapter.Protocol);
                        if (poller != null && !poller.IsConnected && adapter.Protocol != "MQTT") // MQTT connects asynchronously in ConnectAsync task
                        {
                            (DateTime LastAttempt, int FailureCount) state;
                            lock (_adapterConnectionStates)
                            {
                                _adapterConnectionStates.TryGetValue(adapter.Id, out state);

                                // Calculate retry delay: 5s, 10s, 20s, 40s, max 60s
                                int failureCount = state.FailureCount;
                                double delaySeconds = Math.Min(5 * Math.Pow(2, Math.Min(failureCount, 4)), 60);

                                if (state.LastAttempt != default && (now - state.LastAttempt).TotalSeconds < delaySeconds)
                                {
                                    continue; // Skip this attempt (backoff active)
                                }

                                // Update last attempt time
                                _adapterConnectionStates[adapter.Id] = (now, failureCount);
                            }

                            _ = Task.Run(async () =>
                            {
                                try
                                {
                                    _logger.LogInformation("Attempting reconnection to adapter {AdapterName} ({Protocol}). Attempt #{Count}...", adapter.Name, adapter.Protocol, state.FailureCount + 1);
                                    await poller.ConnectAsync(adapter, stoppingToken);
                                    using var dbH = new QueueDbContext();
                                    var adp = await dbH.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id, stoppingToken);
                                    if (adp != null && adp.Status != "Connected")
                                    {
                                        adp.Status = "Connected";
                                        dbH.DriverAdapters.Update(adp);
                                        await dbH.SaveChangesAsync(stoppingToken);
                                    }

                                    // Reset backoff state on success
                                    lock (_adapterConnectionStates)
                                    {
                                        _adapterConnectionStates[adapter.Id] = (DateTime.UtcNow, 0);
                                    }
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogError(ex, "Reconnection attempt failed for adapter {AdapterId}", adapter.Id);

                                    // Increment failure count on exception
                                    lock (_adapterConnectionStates)
                                    {
                                        _adapterConnectionStates.TryGetValue(adapter.Id, out var curState);
                                        _adapterConnectionStates[adapter.Id] = (DateTime.UtcNow, curState.FailureCount + 1);
                                    }
                                }
                            });
                        }
                    }
                }
            }

            // 2. Poll due metrics from all active adapters concurrently
            using var dbPoll = new QueueDbContext();
            var datapoints = await dbPoll.DataPoints.Where(x => x.IsEnabled).ToListAsync(stoppingToken);
            var datapointsGroupedByAdapter = datapoints.GroupBy(dp => dp.AdapterId).ToList();
            var dirtyDps = new List<DataPoint>();

            var activeAdaptersForPolling = _configMonitor.CurrentAdapters;
            var pollTasks = activeAdaptersForPolling.Select(async adapter =>
            {
                var group = datapointsGroupedByAdapter.FirstOrDefault(g => g.Key == adapter.Id);
                if (group == null) return;

                var poller = _pollerRegistry.GetPoller(adapter.Id, adapter.Protocol);
                if (poller != null && poller.IsConnected)
                {
                    try
                    {
                        // Add a safety timeout of 5 seconds to prevent a hung driver from blocking the entire agent
                        await poller.PollGroupAsync(group.ToList(), adapter, now, dirtyDps, stoppingToken)
                                     .WaitAsync(TimeSpan.FromSeconds(5), stoppingToken);
                    }
                    catch (TimeoutException)
                    {
                        _logger.LogWarning("Polling timed out for adapter {AdapterName} ({Protocol})", adapter.Name, adapter.Protocol);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error polling adapter {AdapterName} ({Protocol})", adapter.Name, adapter.Protocol);
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
                            dbEntry.LastLatencyMs = dirty.LastLatencyMs;
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

            // 4. Every 15 seconds, send heartbeat to Cloud
            if ((now - _lastHeartbeat).TotalSeconds >= 15)
            {
                _lastHeartbeat = now;
                
                if (!string.IsNullOrEmpty(currentConfig.ApiKey))
                {
                    _logger.LogInformation("Sending keepalive heartbeat to cloud...");
                    var heartbeatResult = await _cloudClient.SendHeartbeatAsync(
                        currentConfig.CloudEndpoint, 
                        currentConfig.ApiKey, 
                        currentConfig.Version);

                    if (!heartbeatResult.Success)
                    {
                        _logger.LogWarning("Heartbeat transmission failed. Cloud may be offline.");
                    }
                }
            }

            // Loop sleep: 100ms
            await Task.Delay(100, stoppingToken);
        }
    }

    private async void HandleAdapterChanged(DriverAdapter adapter, bool isDeletedOrDisabled)
    {
        _logger.LogInformation("[Config Monitor] Configuration change detected for adapter {AdapterName} ({Protocol})", adapter.Name, adapter.Protocol);
        
        var poller = _pollerRegistry.GetPoller(adapter.Id, adapter.Protocol);
        if (poller == null) return;

        try
        {
            await poller.DisconnectAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error disconnecting adapter {AdapterId}", adapter.Id);
        }

        if (adapter.IsEnabled && !isDeletedOrDisabled)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    using var db = new QueueDbContext();
                    var adp = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                    if (adp != null)
                    {
                        adp.Status = "Connecting";
                        db.DriverAdapters.Update(adp);
                        await db.SaveChangesAsync();
                    }

                    await poller.ConnectAsync(adapter, CancellationToken.None);

                    using var dbCtx = new QueueDbContext();
                    var adp2 = await dbCtx.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                    if (adp2 != null)
                    {
                        adp2.Status = "Connected";
                        dbCtx.DriverAdapters.Update(adp2);
                        await dbCtx.SaveChangesAsync();
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to reconnect adapter {AdapterId}", adapter.Id);
                    using var dbCtx = new QueueDbContext();
                    var adp = await dbCtx.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                    if (adp != null)
                    {
                        adp.Status = "Error";
                        dbCtx.DriverAdapters.Update(adp);
                        await dbCtx.SaveChangesAsync();
                    }
                }
            });
        }
        else
        {
            try
            {
                using var db = new QueueDbContext();
                var adp = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapter.Id);
                if (adp != null)
                {
                    adp.Status = "Disconnected";
                    db.DriverAdapters.Update(adp);
                    await db.SaveChangesAsync();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating adapter status to Disconnected for {AdapterId}", adapter.Id);
            }
        }
    }
}
