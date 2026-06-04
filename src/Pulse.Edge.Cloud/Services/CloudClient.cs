using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Pulse.Edge.Cloud.Services;

public class CloudClient
{
    private readonly ILogger<CloudClient> _logger;
    private readonly HttpClient _httpClient;

    public record RegisterRequest(string DeviceId, string Hostname, string AgentVersion);
    public record RegisterResponse(string EdgeId, string Status);
    
    public record HeartbeatRequest(string AgentVersion);
    public record HeartbeatResponse(bool Ok, string Status);

    public record SiteDto(string Id, string Name);
    public record CloudDataSourceDto(string Id, string ExternalId, string Name, string[] Metrics, string? Protocol);
    public record ConfigResponse(string EdgeId, string Status, SiteDto? Site, List<CloudDataSourceDto>? DataSources);

    public record DeclareDataSourceRequest(string ExternalId, string Name, string[] Metrics, string? Protocol);

    public record ConfigResult(bool Success, HttpStatusCode StatusCode, string SiteId, string SiteName, List<CloudDataSourceDto> DataSources);

    public CloudClient(ILogger<CloudClient> logger)
    {
        _logger = logger;
        _httpClient = new HttpClient();
    }

    private Uri GetUri(string baseUrl, string path)
    {
        // Ensure baseUrl is parsed correctly, fallback if empty
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            baseUrl = "http://localhost:3000";
        }
        if (!baseUrl.StartsWith("http://") && !baseUrl.StartsWith("https://"))
        {
            baseUrl = "http://" + baseUrl;
        }
        return new Uri(new Uri(baseUrl), path);
    }

    // Real call: POST /edge/register
    public async Task<(string EdgeId, string Status)> RegisterDeviceAsync(string baseUrl, string deviceId, string hostname, string agentVersion)
    {
        _logger.LogInformation("Sending device registration request to PULSE Cloud ({BaseUrl})...", baseUrl);
        
        try
        {
            var req = new RegisterRequest(deviceId, hostname, agentVersion);
            var response = await _httpClient.PostAsJsonAsync(GetUri(baseUrl, "/edge/register"), req);
            
            if (response.IsSuccessStatusCode)
            {
                var res = await response.Content.ReadFromJsonAsync<RegisterResponse>();
                if (res != null)
                {
                    _logger.LogInformation("Registration request acknowledged. Cloud EdgeId: {EdgeId}, Status: {Status}", res.EdgeId, res.Status);
                    return (res.EdgeId, res.Status);
                }
            }
            
            var err = await response.Content.ReadAsStringAsync();
            _logger.LogError("Failed to register device: {StatusCode} - {Error}", response.StatusCode, err);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during device registration to {BaseUrl}", baseUrl);
        }
        
        return (string.Empty, "pending");
    }

    // Real call: GET /edge/config
    public async Task<ConfigResult> GetConfigAsync(string baseUrl, string apiKey)
    {
        _logger.LogInformation("Pulling device configuration from PULSE Cloud ({BaseUrl})...", baseUrl);
        
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get, GetUri(baseUrl, "/edge/config"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            
            var response = await _httpClient.SendAsync(request);
            
            if (response.IsSuccessStatusCode)
            {
                var res = await response.Content.ReadFromJsonAsync<ConfigResponse>();
                if (res != null)
                {
                    _logger.LogInformation("Successfully retrieved configuration. Site: {SiteName}", res.Site?.Name ?? "None");
                    return new ConfigResult(
                        Success: true,
                        StatusCode: response.StatusCode,
                        SiteId: res.Site?.Id ?? "",
                        SiteName: res.Site?.Name ?? "",
                        DataSources: res.DataSources ?? new List<CloudDataSourceDto>()
                    );
                }
            }
            else
            {
                var err = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Failed to fetch configuration: {StatusCode} - {Error}", response.StatusCode, err);
            }
            
            return new ConfigResult(false, response.StatusCode, "", "", new List<CloudDataSourceDto>());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during config pull from {BaseUrl}", baseUrl);
            return new ConfigResult(false, HttpStatusCode.InternalServerError, "", "", new List<CloudDataSourceDto>());
        }
    }

    // Real call: POST /edge/data-sources
    public async Task<bool> UpsertDataSourcesAsync(string baseUrl, string apiKey, List<DeclareDataSourceRequest> dataSources)
    {
        _logger.LogInformation("Upserting {Count} data sources with PULSE Cloud ({BaseUrl})...", dataSources.Count, baseUrl);
        
        try
        {
            var options = new System.Text.Json.JsonSerializerOptions
            {
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase
            };
            var request = new HttpRequestMessage(HttpMethod.Post, GetUri(baseUrl, "/edge/data-sources"))
            {
                Content = JsonContent.Create(dataSources, options: options)
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            
            var response = await _httpClient.SendAsync(request);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("Successfully declared data sources with cloud.");
                return true;
            }
            
            var err = await response.Content.ReadAsStringAsync();
            _logger.LogError("Failed to declare data sources: {StatusCode} - {Error}", response.StatusCode, err);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during data source declaration to {BaseUrl}", baseUrl);
        }
        
        return false;
    }

    // Real call: POST /edge/heartbeat
    public async Task<(bool Success, string Status)> SendHeartbeatAsync(string baseUrl, string apiKey, string version)
    {
        _logger.LogInformation("Reporting heartbeat to PULSE Cloud ({BaseUrl})...", baseUrl);
        
        try
        {
            var req = new HeartbeatRequest(version);
            var request = new HttpRequestMessage(HttpMethod.Post, GetUri(baseUrl, "/edge/heartbeat"))
            {
                Content = JsonContent.Create(req)
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            
            var response = await _httpClient.SendAsync(request);
            
            if (response.IsSuccessStatusCode)
            {
                var res = await response.Content.ReadFromJsonAsync<HeartbeatResponse>();
                if (res != null)
                {
                    _logger.LogDebug("Heartbeat successful. Status: {Status}", res.Status);
                    return (true, res.Status);
                }
            }
            else
            {
                var err = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Heartbeat rejected: {StatusCode} - {Error}", response.StatusCode, err);
                if (response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    return (false, "revoked");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during heartbeat send to {BaseUrl}", baseUrl);
        }
        
        return (false, "unknown");
    }

    /// <summary>
    /// Simulates POST /api/telemetry with a batch of merged-metrics telemetry frames.
    /// Ingestion is not yet built on the cloud side, so we keep it mocked.
    /// </summary>
    public async Task<bool> SendTelemetryBatchAsync(string deviceId, string apiKey, System.Collections.Generic.List<Pulse.Edge.Storage.Models.QueueTelemetry> batch)
    {
        _logger.LogInformation("[Cloud Sync] Uploading {Count} telemetry frame(s) to PULSE Cloud (POST /api/telemetry - Simulated)...", batch.Count);
        
        foreach (var t in batch)
        {
            _logger.LogInformation(
                "  -> Stream: {Stream} | Ts: {Ts} | Metrics: {Metrics}",
                t.DataSourceId,
                t.Timestamp.ToString("HH:mm:ss.fff"),
                t.MetricsJson);
        }

        await Task.Delay(1000);
        return true;
    }

    /// <summary>
    /// Simulates POST /api/events with a batch of event records.
    /// Ingestion is not yet built on the cloud side, so we keep it mocked.
    /// </summary>
    public async Task<bool> SendEventsBatchAsync(string deviceId, string apiKey, System.Collections.Generic.List<Pulse.Edge.Storage.Models.QueueEvent> batch)
    {
        _logger.LogInformation("Syncing {Count} alert events to PULSE Cloud (POST /api/events - Simulated)...", batch.Count);
        
        foreach (var e in batch)
        {
            _logger.LogInformation("  -> Event: Type {Type} | Payload: {Payload} | Time: {Time}", 
                e.EventType, e.PayloadJson, e.Timestamp.ToString("HH:mm:ss"));
        }

        await Task.Delay(800);
        return true;
    }
}
