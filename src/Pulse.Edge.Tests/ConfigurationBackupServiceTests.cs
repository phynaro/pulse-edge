using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Tests;

public sealed class ConfigurationBackupServiceTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), $"pulse-edge-backup-tests-{Guid.NewGuid():N}");
    private string DatabasePath => Path.Combine(_directory, "edge.db");

    [Fact]
    public async Task CreateAndRestore_RoundTripsPortableConfiguration_AndPreservesNodeState()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));

        var backup = await service.CreateAsync();
        var inspection = service.Inspect(backup);

        Assert.True(inspection.IsValid, string.Join(Environment.NewLine, inspection.Errors));
        Assert.Equal(1, inspection.Counts.Adapters);
        Assert.Equal(1, inspection.Counts.DataSources);
        Assert.Equal(1, inspection.Counts.DataPoints);
        Assert.Equal(1, inspection.Counts.MqttDevices);
        Assert.Equal(1, inspection.Counts.StreamTemplates);
        Assert.Contains("secret", backup.Configuration.Adapters.Single().ConfigJson);
        Assert.Equal("Disconnected", backup.Configuration.Adapters.Single().Status);

        await using (var changed = new QueueDbContext(DatabasePath))
        {
            await changed.DataPoints.ExecuteDeleteAsync();
            await changed.MqttDevices.ExecuteDeleteAsync();
            await changed.DataSources.ExecuteDeleteAsync();
            await changed.DriverAdapters.ExecuteDeleteAsync();
            await changed.StreamTemplates.ExecuteDeleteAsync();
            changed.DriverAdapters.Add(new DriverAdapter { Id = "replacement", Name = "Replacement", Protocol = "SIMULATOR" });

            var identity = await changed.DeviceConfigs.SingleAsync();
            identity.ApiKey = "preserved-after-export";
            await changed.SaveChangesAsync();
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join(Environment.NewLine, restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        Assert.Equal("adapter-1", (await verified.DriverAdapters.SingleAsync()).Id);
        Assert.Equal("source-1", (await verified.DataSources.SingleAsync()).Id);
        Assert.Equal("point-1", (await verified.DataPoints.SingleAsync()).Id);
        Assert.Equal("mqtt-1", (await verified.MqttDevices.SingleAsync()).Id);
        Assert.Equal("template-1", (await verified.StreamTemplates.SingleAsync()).Id);
        Assert.Equal("preserved-after-export", (await verified.DeviceConfigs.SingleAsync()).ApiKey);
        Assert.Equal("admin", (await verified.LocalUsers.SingleAsync()).Username);
        Assert.Equal(1, await verified.QueueTelemetry.CountAsync());
        Assert.Equal(1, await verified.QueueEvents.CountAsync());
    }

    [Fact]
    public async Task Inspect_RejectsModifiedBackupChecksum()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync();

        var inspection = service.Inspect(backup with { ChecksumSha256 = new string('0', 64) });

        Assert.False(inspection.IsValid);
        Assert.Contains(inspection.Errors, error => error.Contains("checksum", StringComparison.OrdinalIgnoreCase));
    }

    private async Task InitializeDatabase()
    {
        Directory.CreateDirectory(_directory);
        await using var db = new QueueDbContext(DatabasePath);
        await db.Database.EnsureCreatedAsync();

        db.DeviceConfigs.Add(new DeviceConfig
        {
            Id = "device-1",
            SerialNumber = "PULSE-TEST-1",
            ApiKey = "identity-secret",
            Version = "0.9.0"
        });
        db.DriverAdapters.Add(new DriverAdapter
        {
            Id = "adapter-1",
            Name = "Test MQTT",
            Protocol = "MQTT",
            Host = "127.0.0.1",
            Port = 1883,
            ConfigJson = "{\"username\":\"pilot\",\"password\":\"secret\"}",
            Status = "Connected"
        });
        db.DataSources.Add(new DataSource { Id = "source-1", Name = "Energy", Type = "Electricity" });
        db.MqttDevices.Add(new MqttDevice
        {
            Id = "mqtt-1",
            AdapterId = "adapter-1",
            Name = "Meter",
            TopicSubscription = "pilot/meter/#",
            Status = "Connected"
        });
        db.DataPoints.Add(new DataPoint
        {
            Id = "point-1",
            AdapterId = "adapter-1",
            DataSourceId = "source-1",
            MqttDeviceId = "mqtt-1",
            Metric = "power_kw",
            Address = "pilot/meter/power",
            DataType = "Float",
            LastValue = "42.5",
            LastError = "transient diagnostic"
        });
        db.StreamTemplates.Add(new StreamTemplate
        {
            Id = "template-1",
            Description = "Test template",
            ParametersJson = "[\"power_kw\"]"
        });
        db.LocalUsers.Add(new LocalUser
        {
            Id = "user-1",
            Username = "admin",
            NormalizedUsername = "ADMIN",
            PasswordHash = "not-a-real-password",
            Role = "Admin"
        });
        db.QueueTelemetry.Add(new QueueTelemetry
        {
            DataSourceId = "source-1",
            Timestamp = DateTime.UtcNow,
            MetricsJson = "{\"power_kw\":42.5}"
        });
        db.QueueEvents.Add(new QueueEvent
        {
            EventType = "PilotEvent",
            Timestamp = DateTime.UtcNow,
            PayloadJson = "{}"
        });
        await db.SaveChangesAsync();
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
