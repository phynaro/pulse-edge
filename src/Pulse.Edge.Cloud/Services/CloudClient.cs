using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Pulse.Edge.Cloud.Services;

public enum TelemetrySyncResult
{
    Success,
    TransientError,
    ClientError,
    Unauthorized
}

public class CloudClient
{
    private readonly ILogger<CloudClient> _logger;
    private readonly HttpClient _httpClient;

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public record RegisterRequest(string DeviceId, string Hostname, string AgentVersion, string ClaimSecretHash);
    public record RegisterResponse(string EdgeId, string Status);
    
    public record ClaimRequest(string DeviceId, string ClaimSecret);
    public class ClaimResponse
    {
        public string Status { get; set; } = string.Empty;
        public string? ApiKey { get; set; }
        public string? Error { get; set; }
    }

    public record HeartbeatRequest(string AgentVersion);
    public record HeartbeatResponse(bool Ok, string Status);

    public record SiteDto(string Id, string Name);

    public record CloudMetricMetadataDto(
        string AdapterId,
        string? MqttDeviceId,
        string Address,
        string DataType,
        int ScanIntervalMs,
        double ScaleFactor,
        double Offset,
        string ByteOrder,
        string MqttParseMode,
        string? MqttJsonPath);

    public record CloudMetricDto(string Name, string Protocol, CloudMetricMetadataDto Metadata);

    public record CloudDataSourceDto(string Id, string ExternalId, string Name, CloudMetricDto[] Metrics);
    public record ConfigResponse(string EdgeId, string Status, SiteDto? Site, List<CloudDataSourceDto>? DataSources);

    public record DeclareDataSourceRequest(string ExternalId, string Name, CloudMetricDto[] Metrics);

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
    public async Task<(string EdgeId, string Status)> RegisterDeviceAsync(string baseUrl, string deviceId, string hostname, string agentVersion, string claimSecret)
    {
        _logger.LogInformation("Sending device registration request to PULSE Cloud ({BaseUrl})...", baseUrl);
        
        try
        {
            string claimSecretHash = "";
            using (var sha256 = System.Security.Cryptography.SHA256.Create())
            {
                var bytes = sha256.ComputeHash(System.Text.Encoding.UTF8.GetBytes(claimSecret));
                claimSecretHash = Convert.ToHexString(bytes).ToLowerInvariant();
            }

            var req = new RegisterRequest(deviceId, hostname, agentVersion, claimSecretHash);
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

    // Real call: POST /edge/claim
    public async Task<(string Status, string? ApiKey)> ClaimKeyAsync(string baseUrl, string deviceId, string claimSecret)
    {
        _logger.LogInformation("Claiming API Key from PULSE Cloud ({BaseUrl}) for device {DeviceId}...", baseUrl, deviceId);
        
        try
        {
            var req = new ClaimRequest(deviceId, claimSecret);
            var response = await _httpClient.PostAsJsonAsync(GetUri(baseUrl, "/edge/claim"), req);
            
            if (response.IsSuccessStatusCode)
            {
                var res = await response.Content.ReadFromJsonAsync<ClaimResponse>();
                if (res != null)
                {
                    _logger.LogInformation("Claim request successful. Status: {Status}", res.Status);
                    return (res.Status, res.ApiKey);
                }
            }
            else
            {
                if (response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    _logger.LogWarning("Claim request failed: 401 Unauthorized (invalid device or secret)");
                    return ("unauthorized", null);
                }
                if (response.StatusCode == HttpStatusCode.Forbidden)
                {
                    _logger.LogWarning("Claim request failed: 403 Forbidden (device revoked)");
                    return ("revoked", null);
                }
                if (response.StatusCode == HttpStatusCode.Conflict)
                {
                    _logger.LogWarning("Claim request failed: 409 Conflict (already claimed)");
                    return ("conflict", null);
                }

                var err = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("Claim request failed with status {StatusCode}: {Error}", response.StatusCode, err);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during claim request to {BaseUrl}", baseUrl);
        }
        
        return ("pending", null);
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
            var options = JsonOptions;
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

    public class TelemetryFrame
    {
        public string DataSource { get; set; } = string.Empty;
        public string? Ts { get; set; }
        public JsonObject? Metrics { get; set; }
        public JsonObject? Qualities { get; set; }
    }

    public class TelemetryResponseError
    {
        public int Index { get; set; }
        public string Reason { get; set; } = string.Empty;
    }

    public class TelemetryResponse
    {
        public int Accepted { get; set; }
        public int Rejected { get; set; }
        public List<TelemetryResponseError>? Errors { get; set; }
    }

    /// <summary>
    /// Sends a batch of telemetry frames to the cloud (POST /edge/telemetry).
    /// </summary>
    public async Task<TelemetrySyncResult> SendTelemetryBatchAsync(string baseUrl, string deviceId, string apiKey, System.Collections.Generic.List<Pulse.Edge.Storage.Models.QueueTelemetry> batch)
    {
        _logger.LogInformation("[Cloud Sync] Uploading {Count} telemetry frame(s) to PULSE Cloud (POST /edge/telemetry)...", batch.Count);

        var payload = new List<TelemetryFrame>();
        foreach (var t in batch)
        {
            JsonObject? metricsObj = null;
            if (!string.IsNullOrEmpty(t.MetricsJson))
            {
                try
                 {
                     metricsObj = JsonNode.Parse(t.MetricsJson)?.AsObject();
                 }
                 catch (Exception ex)
                 {
                     _logger.LogWarning(ex, "Failed to parse MetricsJson for frame. ID: {Id}, Data Source: {DataSourceId}", t.Id, t.DataSourceId);
                 }
            }

            JsonObject? qualitiesObj = null;
            if (!string.IsNullOrEmpty(t.QualitiesJson))
            {
                try
                {
                    qualitiesObj = JsonNode.Parse(t.QualitiesJson)?.AsObject();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to parse QualitiesJson for frame. ID: {Id}, Data Source: {DataSourceId}", t.Id, t.DataSourceId);
                }
            }

            var tsUtc = DateTime.SpecifyKind(t.Timestamp, DateTimeKind.Utc);
            var tsStr = tsUtc.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);

            payload.Add(new TelemetryFrame
            {
                DataSource = t.DataSourceId,
                Ts = tsStr,
                Metrics = metricsObj,
                Qualities = qualitiesObj
            });
        }

        try
        {
            var options = JsonOptions;

            var request = new HttpRequestMessage(HttpMethod.Post, GetUri(baseUrl, "/edge/telemetry"))
            {
                Content = JsonContent.Create(payload, options: options)
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var response = await _httpClient.SendAsync(request);

            if (response.StatusCode == HttpStatusCode.Accepted) // 202 Accepted
            {
                var res = await response.Content.ReadFromJsonAsync<TelemetryResponse>(options);
                if (res != null)
                {
                    _logger.LogInformation("[Cloud Sync] Telemetry batch processed. Accepted: {Accepted}, Rejected: {Rejected}", res.Accepted, res.Rejected);
                    if (res.Rejected > 0 && res.Errors != null)
                    {
                        foreach (var err in res.Errors)
                        {
                            string dsId = "Unknown";
                            if (err.Index >= 0 && err.Index < batch.Count)
                            {
                                dsId = batch[err.Index].DataSourceId;
                            }
                            _logger.LogWarning("[Cloud Sync] Frame rejected at index {Index} (DataSource: {DataSource}): {Reason}", 
                                err.Index, dsId, err.Reason);
                        }
                    }
                }
                return TelemetrySyncResult.Success;
            }
            else if (response.StatusCode == HttpStatusCode.BadRequest) // 400 Bad Request
            {
                var err = await response.Content.ReadAsStringAsync();
                _logger.LogError("[Cloud Sync] Telemetry batch rejected with 400 Bad Request. Error: {Error}", err);
                return TelemetrySyncResult.ClientError;
            }
            else if (response.StatusCode == HttpStatusCode.Unauthorized) // 401 Unauthorized
            {
                _logger.LogError("[Cloud Sync] Telemetry batch rejected with 401 Unauthorized. API Key may be invalid/revoked.");
                return TelemetrySyncResult.Unauthorized;
            }
            else
            {
                var err = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("[Cloud Sync] Telemetry batch failed with status {StatusCode}. Error: {Error}", response.StatusCode, err);
                return TelemetrySyncResult.TransientError;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Exception during telemetry transmission to {BaseUrl}", baseUrl);
            return TelemetrySyncResult.TransientError;
        }
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
