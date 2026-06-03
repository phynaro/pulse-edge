using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Pulse.Edge.Cloud.Services;

public class CloudClient
{
    private readonly ILogger<CloudClient> _logger;

    public CloudClient(ILogger<CloudClient> logger)
    {
        _logger = logger;
    }

    // Simulates calling POST /api/register to get credentials
    public async Task<(string ApiKey, string SiteId)> RegisterDeviceAsync(string serialNumber)
    {
        _logger.LogInformation("Sending device registration request to PULSE Cloud for Serial: {SerialNumber}...", serialNumber);
        
        // Simulating internet delay
        await Task.Delay(1500);

        string mockApiKey = $"pe_key_{Guid.NewGuid().ToString("N")[..12]}";
        string mockSiteId = Guid.NewGuid().ToString();

        _logger.LogInformation("Registration approved. Received SiteId: {SiteId}", mockSiteId);
        
        return (mockApiKey, mockSiteId);
    }

    // Simulates reporting heartbeats to Cloud
    public async Task<bool> SendHeartbeatAsync(string deviceId, string apiKey, string version)
    {
        _logger.LogInformation("POST /api/heartbeat: Device {DeviceId} is active (v{Version})", deviceId, version);
        
        await Task.Delay(200);
        return true;
    }

    // Simulates POST /api/telemetry with a batch of telemetry records
    public async Task<bool> SendTelemetryBatchAsync(string deviceId, string apiKey, System.Collections.Generic.List<Pulse.Edge.Storage.Models.QueueTelemetry> batch)
    {
        _logger.LogInformation("Syncing {Count} telemetry points to PULSE Cloud (POST /api/telemetry)...", batch.Count);
        
        // Output each point detail for simulation transparency
        foreach (var t in batch)
        {
            _logger.LogInformation("  -> Telemetry: Stream {Source} | Payload: {Payload} | Time: {Time}", 
                t.DataSourceId, t.PayloadJson, t.Timestamp.ToString("HH:mm:ss"));
        }

        // Simulate network delay
        await Task.Delay(1000);
        return true; // Successfully uploaded
    }

    // Simulates POST /api/events with a batch of event records
    public async Task<bool> SendEventsBatchAsync(string deviceId, string apiKey, System.Collections.Generic.List<Pulse.Edge.Storage.Models.QueueEvent> batch)
    {
        _logger.LogInformation("Syncing {Count} alert events to PULSE Cloud (POST /api/events)...", batch.Count);
        
        foreach (var e in batch)
        {
            _logger.LogInformation("  -> Event: Type {Type} | Payload: {Payload} | Time: {Time}", 
                e.EventType, e.PayloadJson, e.Timestamp.ToString("HH:mm:ss"));
        }

        await Task.Delay(800);
        return true;
    }
}
