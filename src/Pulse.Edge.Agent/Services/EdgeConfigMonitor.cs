using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Services;

public class EdgeConfigMonitor : BackgroundService
{
    private readonly ILogger<EdgeConfigMonitor> _logger;
    private readonly QueueStorageService _storageService;

    private DeviceConfig? _currentConfig;
    private List<DriverAdapter> _currentAdapters = new();
    private string _currentDataSourcesHash = string.Empty;
    private readonly Dictionary<string, List<string>> _activeMqttTopicsByAdapter = new();

    public DeviceConfig? CurrentConfig => _currentConfig;
    public List<DriverAdapter> CurrentAdapters => _currentAdapters;
    public string CurrentDataSourcesHash => _currentDataSourcesHash;

    public event Action<DeviceConfig?, DeviceConfig?>? OnDeviceConfigChanged;
    public event Action<DriverAdapter, bool>? OnAdapterChanged; // (adapter, isDeletedOrDisabled)
    public event Action? OnDataSourcesChanged;

    public EdgeConfigMonitor(ILogger<EdgeConfigMonitor> logger, QueueStorageService storageService)
    {
        _logger = logger;
        _storageService = storageService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Edge Configuration Monitor starting...");

        // Initial load
        try
        {
            _currentConfig = await _storageService.GetDeviceConfigAsync();
            
            using (var db = new QueueDbContext())
            {
                _currentAdapters = await db.DriverAdapters.ToListAsync(stoppingToken);
                foreach (var adapter in _currentAdapters.Where(x => x.Protocol == "MQTT"))
                {
                    _activeMqttTopicsByAdapter[adapter.Id] = await GetActiveMqttTopicsAsync(db, adapter.Id);
                }
            }
            _currentDataSourcesHash = await CalculateDataSourcesHashAsync(stoppingToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to perform initial configuration load in monitor startup");
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(2000, stoppingToken);

            try
            {
                await CheckDeviceConfigAsync(stoppingToken);
                await CheckAdaptersAsync(stoppingToken);
                await CheckDataSourcesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking configuration updates in monitor loop");
            }
        }
    }

    private async Task CheckDeviceConfigAsync(CancellationToken ct)
    {
        var latestConfig = await _storageService.GetDeviceConfigAsync();
        
        if (latestConfig == null && _currentConfig != null)
        {
            var oldConfig = _currentConfig;
            _currentConfig = null;
            OnDeviceConfigChanged?.Invoke(oldConfig, null);
        }
        else if (latestConfig != null && (_currentConfig == null 
            || latestConfig.CloudEndpoint != _currentConfig.CloudEndpoint 
            || latestConfig.ApiKey != _currentConfig.ApiKey
            || latestConfig.SerialNumber != _currentConfig.SerialNumber
            || latestConfig.ClaimSecret != _currentConfig.ClaimSecret
            || latestConfig.PairingToken != _currentConfig.PairingToken
            || latestConfig.CloudStatus != _currentConfig.CloudStatus))
        {
            var oldConfig = _currentConfig;
            _currentConfig = latestConfig;
            OnDeviceConfigChanged?.Invoke(oldConfig, latestConfig);
        }
    }

    private async Task CheckAdaptersAsync(CancellationToken ct)
    {
        using var db = new QueueDbContext();
        var latestAdapters = await db.DriverAdapters.ToListAsync(ct);

        foreach (var latest in latestAdapters)
        {
            var cached = _currentAdapters.FirstOrDefault(x => x.Id == latest.Id);
            bool hasChanged = cached == null 
                || cached.Host != latest.Host 
                || cached.Port != latest.Port 
                || cached.ConfigJson != latest.ConfigJson 
                || cached.IsEnabled != latest.IsEnabled;

            if (latest.Protocol == "MQTT" && !hasChanged && cached != null)
            {
                var latestTopics = await GetActiveMqttTopicsAsync(db, latest.Id);
                _activeMqttTopicsByAdapter.TryGetValue(latest.Id, out var cachedTopics);
                bool topicsChanged = cachedTopics == null || !latestTopics.SequenceEqual(cachedTopics);
                if (topicsChanged)
                {
                    hasChanged = true;
                    _activeMqttTopicsByAdapter[latest.Id] = latestTopics;
                }
            }

            if (hasChanged)
            {
                OnAdapterChanged?.Invoke(latest, false);
            }
        }

        // Check for deleted adapters
        foreach (var cached in _currentAdapters)
        {
            if (!latestAdapters.Any(x => x.Id == cached.Id))
            {
                OnAdapterChanged?.Invoke(cached, true); // isDeletedOrDisabled = true
            }
        }

        _currentAdapters = latestAdapters;
    }

    private async Task CheckDataSourcesAsync(CancellationToken ct)
    {
        string latestHash = await CalculateDataSourcesHashAsync(ct);
        if (latestHash != _currentDataSourcesHash)
        {
            _currentDataSourcesHash = latestHash;
            OnDataSourcesChanged?.Invoke();
        }
    }

    private async Task<string> CalculateDataSourcesHashAsync(CancellationToken ct)
    {
        try
        {
            using var db = new QueueDbContext();
            var dataSources = await db.DataSources.OrderBy(x => x.Id).ToListAsync(ct);
            var dataPoints = await db.DataPoints.OrderBy(x => x.Id).ToListAsync(ct);
            var adapters = await db.DriverAdapters.OrderBy(x => x.Id).ToListAsync(ct);
            var adaptersById = adapters.ToDictionary(a => a.Id, StringComparer.Ordinal);

            var canonical = DataSourceDeclarationBuilder.ComputeDeclarationHash(dataSources, dataPoints, adaptersById);

            using var sha256 = SHA256.Create();
            var bytes = Encoding.UTF8.GetBytes(canonical);
            var hashBytes = sha256.ComputeHash(bytes);
            return Convert.ToHexString(hashBytes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error while calculating data sources hash");
            return string.Empty;
        }
    }

    public async Task<List<string>> GetActiveMqttTopicsAsync(QueueDbContext db, string mqttAdapterId)
    {
        var topics = new List<string>();
        var lwtTopics = await db.MqttDevices
            .Where(x => x.AdapterId == mqttAdapterId && x.IsEnabled && !string.IsNullOrEmpty(x.LwtTopic))
            .Select(x => x.LwtTopic!)
            .ToListAsync();
        topics.AddRange(lwtTopics);

        var subTopics = await db.MqttDevices
            .Where(x => x.AdapterId == mqttAdapterId && x.IsEnabled && !string.IsNullOrEmpty(x.TopicSubscription))
            .Select(x => x.TopicSubscription!)
            .ToListAsync();
        topics.AddRange(subTopics);

        var legacyTopics = await db.DataPoints
            .Where(x => x.AdapterId == mqttAdapterId && x.IsEnabled && (x.MqttDeviceId == null || x.MqttDeviceId == "") && !string.IsNullOrEmpty(x.Address))
            .Select(x => x.Address!)
            .ToListAsync();
        topics.AddRange(legacyTopics);

        return topics.Distinct().ToList();
    }
}
