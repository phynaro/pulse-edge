using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Services;

public class CloudProvisioningService : BackgroundService
{
    private readonly ILogger<CloudProvisioningService> _logger;
    private readonly IConfiguration _configuration;
    private readonly QueueStorageService _storageService;
    private readonly CloudClient _cloudClient;
    private readonly EdgeConfigMonitor _configMonitor;

    private DeviceConfig? _deviceConfig;
    private bool _hasInitialConfigSyncRun = false;
    private readonly SemaphoreSlim _provisioningSemaphore = new(0, 1);

    public CloudProvisioningService(
        ILogger<CloudProvisioningService> logger,
        IConfiguration configuration,
        QueueStorageService storageService,
        CloudClient cloudClient,
        EdgeConfigMonitor configMonitor)
    {
        _logger = logger;
        _configuration = configuration;
        _storageService = storageService;
        _cloudClient = cloudClient;
        _configMonitor = configMonitor;

        _configMonitor.OnDeviceConfigChanged += HandleDeviceConfigChanged;
        _configMonitor.OnDataSourcesChanged += HandleDataSourcesChanged;
    }

    public void WakeUpProvisioning()
    {
        try
        {
            if (_provisioningSemaphore.CurrentCount == 0)
            {
                _provisioningSemaphore.Release();
            }
        }
        catch (ObjectDisposedException) {}
    }

    private void HandleDeviceConfigChanged(DeviceConfig? oldConfig, DeviceConfig? newConfig)
    {
        if (newConfig == null)
        {
            _deviceConfig = null;
            _hasInitialConfigSyncRun = false;
            WakeUpProvisioning();
            return;
        }

        bool endpointChanged = oldConfig == null || newConfig.CloudEndpoint != oldConfig.CloudEndpoint;
        bool apiKeyChanged = oldConfig == null || newConfig.ApiKey != oldConfig.ApiKey;

        if (endpointChanged || apiKeyChanged)
        {
            _logger.LogInformation("[Provisioning] Settings update detected! Updating runtime. Endpoint: {Endpoint}", newConfig.CloudEndpoint);
            _deviceConfig = newConfig;
            _hasInitialConfigSyncRun = false;
            WakeUpProvisioning();

            if (!string.IsNullOrEmpty(newConfig.ApiKey) && (apiKeyChanged || endpointChanged))
            {
                _logger.LogInformation("[Provisioning] API key present/updated. Fetching config dynamically...");
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var configResult = await _cloudClient.GetConfigAsync(newConfig.CloudEndpoint, newConfig.ApiKey);
                        if (configResult.Success)
                        {
                            _logger.LogInformation("[Provisioning] Dynamic config retrieved. Site: {SiteName}", configResult.SiteName);
                            newConfig.SiteId = configResult.SiteId;
                            newConfig.SiteName = configResult.SiteName;
                            newConfig.CloudStatus = "Connected";
                            await _storageService.SaveDeviceConfigAsync(newConfig);
                            
                            await PushDataSourcesToCloudAsync(newConfig.CloudEndpoint, newConfig.ApiKey);
                        }
                        else if (configResult.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                        {
                            _logger.LogError("[Provisioning] API Key rejected/revoked by cloud.");
                            newConfig.ApiKey = "";
                            newConfig.SiteId = "";
                            newConfig.SiteName = "";
                            newConfig.CloudStatus = "Revoked";
                            await _storageService.SaveDeviceConfigAsync(newConfig);
                        }
                        else
                        {
                            _logger.LogWarning("[Provisioning] Failed to retrieve dynamic config (Status Code: {StatusCode}).", configResult.StatusCode);
                            newConfig.CloudStatus = "Disconnected";
                            await _storageService.SaveDeviceConfigAsync(newConfig);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to pull config on settings update");
                    }
                });
            }
        }
        else
        {
            _deviceConfig = newConfig;
        }
    }

    private void HandleDataSourcesChanged()
    {
        if (_deviceConfig != null && !string.IsNullOrEmpty(_deviceConfig.ApiKey) && _deviceConfig.CloudStatus == "Connected")
        {
            _logger.LogInformation("[Provisioning] Logical data sources change detected! Syncing with PULSE Cloud...");
            _ = PushDataSourcesToCloudAsync(_deviceConfig.CloudEndpoint, _deviceConfig.ApiKey);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("PULSE Cloud Provisioning Loop started.");
        
        int claimPollSeconds = 20;
        if (int.TryParse(_configuration["Cloud:ClaimPollSeconds"], out int parsedSeconds))
        {
            claimPollSeconds = parsedSeconds;
        }

        // Wait until EdgeConfigMonitor is initialized and we have a DeviceConfig
        while (_deviceConfig == null && !stoppingToken.IsCancellationRequested)
        {
            _deviceConfig = _configMonitor.CurrentConfig;
            if (_deviceConfig == null)
            {
                await Task.Delay(1000, stoppingToken);
            }
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            int loopDelayMs = claimPollSeconds * 1000;
            try
            {
                // Reload from config monitor state
                _deviceConfig = _configMonitor.CurrentConfig;

                if (_deviceConfig == null)
                {
                    try
                    {
                        await _provisioningSemaphore.WaitAsync(3000, stoppingToken);
                    }
                    catch (OperationCanceledException) {}
                    continue;
                }

                if (string.IsNullOrEmpty(_deviceConfig.PairingToken))
                {
                    var tokenBytes = new byte[24];
                    using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
                    {
                        rng.GetBytes(tokenBytes);
                    }
                    _deviceConfig.PairingToken = Convert.ToHexString(tokenBytes).ToLowerInvariant();
                    await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                }

                string currentBaseUrl = _deviceConfig.CloudEndpoint;

                if (string.IsNullOrEmpty(_deviceConfig.ApiKey))
                {
                    bool needsRegister = string.IsNullOrEmpty(_deviceConfig.PairingShortCode) ||
                                         !_deviceConfig.PairingExpiresAt.HasValue ||
                                         _deviceConfig.PairingExpiresAt.Value <= DateTime.UtcNow.AddMinutes(1);

                    bool registerSuccess = true;
                    if (needsRegister)
                    {
                        _logger.LogInformation("[Cloud Provisioning] Registering device with Cloud...");
                        var regResult = await _cloudClient.RegisterDeviceAsync(
                            currentBaseUrl,
                            _deviceConfig.Id,
                            _deviceConfig.SerialNumber,
                            _deviceConfig.Version,
                            _deviceConfig.ClaimSecret,
                            _deviceConfig.PairingToken
                        );

                        if (regResult != null)
                        {
                            _deviceConfig.CloudEdgeId = regResult.EdgeId;
                            _deviceConfig.PairingShortCode = regResult.ShortCode ?? "";
                            _deviceConfig.PairingExpiresAt = regResult.PairingExpiresAt;
                            _deviceConfig.PairingBaseUrl = regResult.PairingBaseUrl ?? "";
                            _deviceConfig.CloudStatus = "PendingApproval";
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            _logger.LogInformation("[Cloud Provisioning] Registered. Code: {Code}, Expiry: {Expiry}", regResult.ShortCode, regResult.PairingExpiresAt);
                        }
                        else
                        {
                            registerSuccess = false;
                            _logger.LogWarning("[Cloud Provisioning] Registration failed. Will retry registration.");
                        }
                    }

                    if (registerSuccess)
                    {
                        loopDelayMs = 5000;

                        _logger.LogInformation("[Cloud Provisioning] Polling claim endpoint...");
                        var claimResult = await _cloudClient.ClaimKeyAsync(currentBaseUrl, _deviceConfig.Id, _deviceConfig.ClaimSecret);

                        if (claimResult.Status == "active" && !string.IsNullOrEmpty(claimResult.ApiKey))
                        {
                            _logger.LogInformation("[Cloud Provisioning] API Key successfully claimed!");
                            _deviceConfig.ApiKey = claimResult.ApiKey;
                            _deviceConfig.OrganizationId = claimResult.OrgId ?? "";
                            _deviceConfig.OrganizationName = claimResult.OrgName ?? "";
                            _deviceConfig.SiteId = claimResult.SiteId ?? "";
                            _deviceConfig.SiteName = claimResult.SiteName ?? "";
                            _deviceConfig.CloudStatus = "Connected";
                            _deviceConfig.PairingShortCode = "";
                            _deviceConfig.PairingExpiresAt = null;
                            _deviceConfig.PairingBaseUrl = "";
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);

                            var configResult = await _cloudClient.GetConfigAsync(currentBaseUrl, claimResult.ApiKey);
                            if (configResult.Success)
                            {
                                _deviceConfig.OrganizationId = configResult.OrgId;
                                _deviceConfig.OrganizationName = configResult.OrgName;
                                _deviceConfig.SiteId = configResult.SiteId;
                                _deviceConfig.SiteName = configResult.SiteName;
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }

                            await PushDataSourcesToCloudAsync(currentBaseUrl, claimResult.ApiKey);
                            loopDelayMs = claimPollSeconds * 1000;
                        }
                        else if (claimResult.Status == "revoked")
                        {
                            _logger.LogError("[Cloud Provisioning] Device has been revoked. Operator re-approval required.");
                            if (_deviceConfig.CloudStatus != "Revoked")
                            {
                                _deviceConfig.CloudStatus = "Revoked";
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }
                        }
                        else if (claimResult.Status == "unauthorized")
                        {
                            _logger.LogWarning("[Cloud Provisioning] Claim unauthorized. Device unknown or wrong secret.");
                            if (_deviceConfig.CloudStatus != "PendingApproval")
                            {
                                _deviceConfig.CloudStatus = "PendingApproval";
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }
                        }
                        else
                        {
                            if (_deviceConfig.CloudStatus != "PendingApproval" && _deviceConfig.CloudStatus != "Revoked")
                            {
                                _deviceConfig.CloudStatus = "PendingApproval";
                                await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                            }
                        }
                    }
                    else
                    {
                        loopDelayMs = 10000;
                    }
                }
                else
                {
                    if (!_hasInitialConfigSyncRun || _deviceConfig.CloudStatus != "Connected")
                    {
                        _logger.LogInformation("[Cloud Provisioning] API Key is present. Fetching configuration...");
                        var configResult = await _cloudClient.GetConfigAsync(currentBaseUrl, _deviceConfig.ApiKey);
                        if (configResult.Success)
                        {
                            _logger.LogInformation("[Cloud Provisioning] Successfully retrieved config. Site: {SiteName}", configResult.SiteName);
                            _deviceConfig.OrganizationId = configResult.OrgId;
                            _deviceConfig.OrganizationName = configResult.OrgName;
                            _deviceConfig.SiteId = configResult.SiteId;
                            _deviceConfig.SiteName = configResult.SiteName;
                            _deviceConfig.CloudStatus = "Connected";
                            _hasInitialConfigSyncRun = true;
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);

                            await PushDataSourcesToCloudAsync(currentBaseUrl, _deviceConfig.ApiKey);
                        }
                        else if (configResult.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                        {
                            _logger.LogError("[Cloud Provisioning] API Key is invalid or has been revoked (401 Unauthorized). Resetting API Key for re-onboarding.");
                            _deviceConfig.ApiKey = "";
                            _deviceConfig.OrganizationId = "";
                            _deviceConfig.OrganizationName = "";
                            _deviceConfig.SiteId = "";
                            _deviceConfig.SiteName = "";
                            _deviceConfig.PairingShortCode = "";
                            _deviceConfig.PairingExpiresAt = null;
                            _deviceConfig.PairingBaseUrl = "";
                            _deviceConfig.CloudStatus = "PendingApproval";
                            await _storageService.SaveDeviceConfigAsync(_deviceConfig);
                        }
                        else
                        {
                            _logger.LogWarning("[Cloud Provisioning] Failed to fetch configuration (Status: {StatusCode}). Will retry.", configResult.StatusCode);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception in cloud registration loop");
            }

            try
            {
                await _provisioningSemaphore.WaitAsync(loopDelayMs, stoppingToken);
            }
            catch (OperationCanceledException) {}
        }
    }

    private async Task<bool> PushDataSourcesToCloudAsync(string baseUrl, string apiKey)
    {
        try
        {
            using var db = new QueueDbContext();
            var dataSources = await db.DataSources.ToListAsync();
            var dataPoints = await db.DataPoints.ToListAsync();
            var adapters = await db.DriverAdapters.ToListAsync();
            var adaptersById = adapters.ToDictionary(a => a.Id, StringComparer.Ordinal);

            var dtoList = new List<CloudClient.DeclareDataSourceRequest>();
            foreach (var ds in dataSources)
            {
                var metrics = DataSourceDeclarationBuilder.BuildMetricsForDataSource(ds.Id, dataPoints, adaptersById);
                dtoList.Add(new CloudClient.DeclareDataSourceRequest(ds.Id, ds.Name, metrics.ToArray()));
            }

            if (dtoList.Any() && !string.IsNullOrEmpty(apiKey))
            {
                _logger.LogInformation("Declaring/updating {Count} data sources with PULSE Cloud...", dtoList.Count);
                bool success = await _cloudClient.UpsertDataSourcesAsync(baseUrl, apiKey, dtoList);
                if (success)
                {
                    _logger.LogInformation("Successfully declared data sources to cloud.");
                    return true;
                }
                else
                {
                    _logger.LogWarning("Failed to declare data sources to cloud.");
                    return false;
                }
            }
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error while pushing data sources to cloud");
            return false;
        }
    }
}
