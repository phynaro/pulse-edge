using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Api.Services;

public sealed class ConfigurationBackupService
{
    public const int CurrentFormatVersion = 1;
    private readonly Func<QueueDbContext> _createDbContext;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    public ConfigurationBackupService() : this(() => new QueueDbContext())
    {
    }

    public ConfigurationBackupService(Func<QueueDbContext> createDbContext)
    {
        _createDbContext = createDbContext ?? throw new ArgumentNullException(nameof(createDbContext));
    }

    public async Task<ConfigurationBackupDocument> CreateAsync(CancellationToken cancellationToken = default)
    {
        await using var db = _createDbContext();
        var payload = new ConfigurationBackupPayload(
            await db.DriverAdapters.AsNoTracking().OrderBy(x => x.Id).Select(x => new DriverAdapter
            {
                Id = x.Id, Name = x.Name, Protocol = x.Protocol, Host = x.Host, Port = x.Port,
                ConfigJson = x.ConfigJson, IsEnabled = x.IsEnabled, Status = "Disconnected"
            }).ToListAsync(cancellationToken),
            await db.DataSources.AsNoTracking().OrderBy(x => x.Id).ToListAsync(cancellationToken),
            await db.DataPoints.AsNoTracking().OrderBy(x => x.Id).Select(x => new DataPoint
            {
                Id = x.Id, AdapterId = x.AdapterId, DataSourceId = x.DataSourceId, Metric = x.Metric,
                Address = x.Address, DataType = x.DataType, ScanIntervalMs = x.ScanIntervalMs,
                ScaleFactor = x.ScaleFactor, Offset = x.Offset, IsEnabled = x.IsEnabled,
                ByteOrder = x.ByteOrder, Description = x.Description, MqttDeviceId = x.MqttDeviceId,
                MqttParseMode = x.MqttParseMode, MqttJsonPath = x.MqttJsonPath
            }).ToListAsync(cancellationToken),
            await db.MqttDevices.AsNoTracking().OrderBy(x => x.Id).Select(x => new MqttDevice
            {
                Id = x.Id, AdapterId = x.AdapterId, Name = x.Name,
                TopicSubscription = x.TopicSubscription, MqttParseMode = x.MqttParseMode,
                IsEnabled = x.IsEnabled, LwtTopic = x.LwtTopic,
                LwtOnlinePayload = x.LwtOnlinePayload, LwtOfflinePayload = x.LwtOfflinePayload,
                Status = "Disconnected"
            }).ToListAsync(cancellationToken),
            await db.StreamTemplates.AsNoTracking().OrderBy(x => x.Id).ToListAsync(cancellationToken));

        var config = await db.DeviceConfigs.AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        return new ConfigurationBackupDocument(
            "pulse-edge-configuration",
            CurrentFormatVersion,
            DateTime.UtcNow,
            config?.Version ?? "unknown",
            config?.SerialNumber ?? "",
            ComputeChecksum(payload),
            payload);
    }

    public ConfigurationBackupInspection Inspect(ConfigurationBackupDocument? document)
    {
        var errors = Validate(document);
        var payload = document?.Configuration;
        return new ConfigurationBackupInspection(
            errors.Count == 0,
            errors,
            document?.FormatVersion ?? 0,
            document?.CreatedAtUtc,
            document?.AgentVersion ?? "",
            document?.SourceSerialNumber ?? "",
            new ConfigurationBackupCounts(
                payload?.Adapters?.Count ?? 0,
                payload?.DataSources?.Count ?? 0,
                payload?.DataPoints?.Count ?? 0,
                payload?.MqttDevices?.Count ?? 0,
                payload?.StreamTemplates?.Count ?? 0));
    }

    public async Task<ConfigurationBackupInspection> RestoreAsync(ConfigurationBackupDocument document, CancellationToken cancellationToken = default)
    {
        var inspection = Inspect(document);
        if (!inspection.IsValid) return inspection;

        var payload = document.Configuration;
        await using var db = _createDbContext();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await db.DataPoints.ExecuteDeleteAsync(cancellationToken);
            await db.MqttDevices.ExecuteDeleteAsync(cancellationToken);
            await db.DataSources.ExecuteDeleteAsync(cancellationToken);
            await db.DriverAdapters.ExecuteDeleteAsync(cancellationToken);
            await db.StreamTemplates.ExecuteDeleteAsync(cancellationToken);

            db.DriverAdapters.AddRange(payload.Adapters);
            db.DataSources.AddRange(payload.DataSources);
            db.MqttDevices.AddRange(payload.MqttDevices);
            db.DataPoints.AddRange(payload.DataPoints);
            db.StreamTemplates.AddRange(payload.StreamTemplates);
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return inspection;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public byte[] Serialize(ConfigurationBackupDocument document) => JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions);

    private static List<string> Validate(ConfigurationBackupDocument? document)
    {
        var errors = new List<string>();
        if (document is null) return ["The backup file is empty or malformed."];
        if (document.Format != "pulse-edge-configuration") errors.Add("This is not a PULSE Edge configuration backup.");
        if (document.FormatVersion != CurrentFormatVersion) errors.Add($"Unsupported backup format version {document.FormatVersion}.");
        if (document.Configuration is null) return [.. errors, "The configuration payload is missing."];
        if (document.Configuration.Adapters is null || document.Configuration.DataSources is null ||
            document.Configuration.DataPoints is null || document.Configuration.MqttDevices is null ||
            document.Configuration.StreamTemplates is null)
            return [.. errors, "One or more required configuration collections are missing."];
        if (!FixedTimeEquals(document.ChecksumSha256 ?? "", ComputeChecksum(document.Configuration))) errors.Add("The backup checksum does not match. The file may be corrupt or modified.");

        CheckUnique(document.Configuration.Adapters.Select(x => x.Id), "adapter", errors);
        CheckUnique(document.Configuration.DataSources.Select(x => x.Id), "stream", errors);
        CheckUnique(document.Configuration.DataPoints.Select(x => x.Id), "tag", errors);
        CheckUnique(document.Configuration.MqttDevices.Select(x => x.Id), "MQTT device", errors);
        CheckUnique(document.Configuration.StreamTemplates.Select(x => x.Id), "stream template", errors);

        var adapterIds = document.Configuration.Adapters.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        var sourceIds = document.Configuration.DataSources.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        var mqttIds = document.Configuration.MqttDevices.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var device in document.Configuration.MqttDevices.Where(x => !adapterIds.Contains(x.AdapterId)))
            errors.Add($"MQTT device '{device.Name}' references missing adapter '{device.AdapterId}'.");
        foreach (var point in document.Configuration.DataPoints)
        {
            if (!adapterIds.Contains(point.AdapterId)) errors.Add($"Tag '{point.Id}' references missing adapter '{point.AdapterId}'.");
            if (!string.IsNullOrWhiteSpace(point.DataSourceId) && !sourceIds.Contains(point.DataSourceId)) errors.Add($"Tag '{point.Id}' references missing stream '{point.DataSourceId}'.");
            if (!string.IsNullOrWhiteSpace(point.MqttDeviceId) && !mqttIds.Contains(point.MqttDeviceId)) errors.Add($"Tag '{point.Id}' references missing MQTT device '{point.MqttDeviceId}'.");
        }
        return errors;
    }

    private static void CheckUnique(IEnumerable<string> ids, string label, ICollection<string> errors)
    {
        if (ids.Any(string.IsNullOrWhiteSpace)) errors.Add($"A {label} has an empty ID.");
        foreach (var id in ids.Where(x => !string.IsNullOrWhiteSpace(x)).GroupBy(x => x, StringComparer.Ordinal).Where(x => x.Count() > 1).Select(x => x.Key))
            errors.Add($"Duplicate {label} ID '{id}'.");
    }

    private static string ComputeChecksum(ConfigurationBackupPayload payload)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static bool FixedTimeEquals(string supplied, string expected)
    {
        if (supplied.Length != expected.Length) return false;
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(supplied), Encoding.ASCII.GetBytes(expected));
    }
}

public sealed record ConfigurationBackupDocument(
    string Format,
    int FormatVersion,
    DateTime CreatedAtUtc,
    string AgentVersion,
    string SourceSerialNumber,
    string ChecksumSha256,
    ConfigurationBackupPayload Configuration);

public sealed record ConfigurationBackupPayload(
    List<DriverAdapter> Adapters,
    List<DataSource> DataSources,
    List<DataPoint> DataPoints,
    List<MqttDevice> MqttDevices,
    List<StreamTemplate> StreamTemplates);

public sealed record ConfigurationBackupCounts(int Adapters, int DataSources, int DataPoints, int MqttDevices, int StreamTemplates);
public sealed record ConfigurationBackupInspection(bool IsValid, List<string> Errors, int FormatVersion, DateTime? CreatedAtUtc, string AgentVersion, string SourceSerialNumber, ConfigurationBackupCounts Counts);
