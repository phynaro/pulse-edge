using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Cloud.Services;

public class SyncService
{
    private readonly ILogger<SyncService> _logger;
    private readonly QueueStorageService _storageService;
    private readonly CloudClient _cloudClient;

    public SyncService(
        ILogger<SyncService> logger,
        QueueStorageService storageService,
        CloudClient cloudClient)
    {
        _logger = logger;
        _storageService = storageService;
        _cloudClient = cloudClient;
    }

    // Runs indefinitely in the background to sync SQLite records to PULSE Cloud
    public async Task StartSyncLoopAsync(string deviceId, string apiKey, CancellationToken stoppingToken)
    {
        _logger.LogInformation("PULSE Cloud Sync loop started.");

        bool isSyncCurrentlyPaused = false;

        while (!stoppingToken.IsCancellationRequested)
        {
            bool processedAnyData = false;

            try
            {
                // Check if Cloud Sync is enabled in the database configuration
                var config = await _storageService.GetDeviceConfigAsync();
                bool syncEnabled = config?.IsSyncEnabled ?? true;
                string currentApiKey = config?.ApiKey ?? apiKey;
                string currentDeviceId = config?.Id ?? deviceId;

                if (syncEnabled)
                {
                    if (isSyncCurrentlyPaused)
                    {
                        _logger.LogInformation("[Sync] Cloud sync has been resumed. Draining queues...");
                        isSyncCurrentlyPaused = false;
                    }

                    // 1. Process Telemetry batch
                    var telemetryBatch = await _storageService.GetPendingTelemetryBatchAsync(batchSize: 100);
                    if (telemetryBatch.Any())
                    {
                        processedAnyData = true;
                        
                        // Attempt cloud transmission
                        bool success = await _cloudClient.SendTelemetryBatchAsync(currentDeviceId, currentApiKey, telemetryBatch);
                        var ids = telemetryBatch.Select(x => x.Id).ToList();

                        if (success)
                        {
                            // Delete from local queue database
                            await _storageService.CompleteTelemetryBatchAsync(ids);
                            _logger.LogInformation("[Sync] Successfully synced and cleared {Count} telemetry records.", telemetryBatch.Count);
                        }
                        else
                        {
                            // Unlock records and increment retry counts
                            await _storageService.FailTelemetryBatchAsync(ids);
                            _logger.LogWarning("[Sync] Telemetry upload failed. Re-queued items for retry.");
                            
                            // Back off slightly on failure
                            await Task.Delay(3000, stoppingToken);
                        }
                    }

                    // 2. Process Alert Events batch
                    var eventBatch = await _storageService.GetPendingEventsBatchAsync(batchSize: 100);
                    if (eventBatch.Any())
                    {
                        processedAnyData = true;

                        bool success = await _cloudClient.SendEventsBatchAsync(currentDeviceId, currentApiKey, eventBatch);
                        var ids = eventBatch.Select(x => x.Id).ToList();

                        if (success)
                        {
                            await _storageService.CompleteEventsBatchAsync(ids);
                            _logger.LogInformation("[Sync] Successfully synced and cleared {Count} event records.", eventBatch.Count);
                        }
                        else
                        {
                            await _storageService.FailEventsBatchAsync(ids);
                            _logger.LogWarning("[Sync] Events upload failed. Re-queued items.");
                            await Task.Delay(3000, stoppingToken);
                        }
                    }
                }
                else
                {
                    if (!isSyncCurrentlyPaused)
                    {
                        _logger.LogWarning("[Sync] Cloud sync has been paused by the user. Telemetry is buffering inside SQLite.");
                        isSyncCurrentlyPaused = true;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error in Sync Service worker loop.");
            }

            // If no data was present in the queues, sleep for 2 seconds before polling SQLite again
            if (!processedAnyData)
            {
                await Task.Delay(2000, stoppingToken);
            }
        }
    }
}
