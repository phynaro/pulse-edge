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
        Assert.Equal(1, await verified.OeeChannels.CountAsync());
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

    [Fact]
    public async Task Create_ProducesV2_WithSanitizedChannels()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));

        var backup = await service.CreateAsync();

        Assert.Equal(2, backup.FormatVersion);
        var channel = Assert.Single(backup.Configuration.OeeChannels!);
        Assert.Equal("line1.filler", channel.ExternalId);
        Assert.Equal(42, channel.NextSeq);
        Assert.Equal(3, channel.DebounceSeconds);
        Assert.Null(channel.LastState);          // runtime state sanitized out
        Assert.Null(channel.LastCode);
        Assert.Null(channel.LastStateChangedAt);
    }

    [Fact]
    public async Task Serialize_OmitsNullOeeChannels_ForChecksumStability()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync();

        var v1Style = backup with { Configuration = backup.Configuration with { OeeChannels = null } };
        var json = System.Text.Encoding.UTF8.GetString(service.Serialize(v1Style));

        Assert.DoesNotContain("oeeChannels", json); // null member must vanish, or every v1 checksum breaks
        Assert.Contains("oeeChannels", System.Text.Encoding.UTF8.GetString(service.Serialize(backup)));
    }

    [Fact]
    public async Task Inspect_AcceptsV1Document_AndRejectsV1CarryingChannels()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var v2 = await service.CreateAsync();

        // A faithful v1 fixture: channel-less payload, checksum recomputed the way the
        // service does it (Web defaults + indented). The JsonIgnore annotation makes this
        // serialization byte-identical to what a real v1 build produced.
        var v1Payload = v2.Configuration with { OeeChannels = null };
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true };
        var checksum = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(v1Payload, options))).ToLowerInvariant();
        var v1Doc = v2 with { FormatVersion = 1, Configuration = v1Payload, ChecksumSha256 = checksum };

        Assert.True(service.Inspect(v1Doc).IsValid, string.Join("; ", service.Inspect(v1Doc).Errors));

        // v1 must not carry channels.
        var tampered = v1Doc with { Configuration = v2.Configuration, ChecksumSha256 = v2.ChecksumSha256 };
        var inspection = service.Inspect(tampered);
        Assert.False(inspection.IsValid);
        Assert.Contains(inspection.Errors, e => e.Contains("v1", StringComparison.OrdinalIgnoreCase));

        // Unknown version still rejected.
        Assert.False(service.Inspect(v2 with { FormatVersion = 3 }).IsValid);
    }

    [Fact]
    public async Task Restore_ExistingChannel_KeepsLocalSeqIdAndOutbox_ButAppliesBackupConfig()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync(); // carries line1.filler with NextSeq 42, Name "Line 1 — Filler"

        int localId;
        await using (var db = new QueueDbContext(DatabasePath))
        {
            var local = await db.OeeChannels.SingleAsync();
            localId = local.Id;
            local.NextSeq = 500;                  // device kept producing after the backup
            local.Name = "Renamed Since Backup";  // config drift the restore must undo
            db.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = localId, Seq = 499, Type = "sync", Ts = DateTime.UtcNow,
                State = "running", CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        var channel = await verified.OeeChannels.SingleAsync();
        Assert.Equal(localId, channel.Id);                     // row identity kept
        Assert.Equal(500, channel.NextSeq);                    // local counter wins — never rewound to 42
        Assert.Equal("Line 1 — Filler", channel.Name);         // config restored from backup
        Assert.Equal(1, await verified.OeeOutboxMessages.CountAsync(m => m.ChannelId == localId)); // in-flight data kept
    }

    [Fact]
    public async Task Restore_MissingChannel_InsertsWithJumpedSeq()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync(); // NextSeq 42 in the backup

        await using (var db = new QueueDbContext(DatabasePath))
        {
            await db.OeeOutboxMessages.ExecuteDeleteAsync();
            await db.OeeChannels.ExecuteDeleteAsync();          // channel deleted since the backup
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        var channel = await verified.OeeChannels.SingleAsync();
        Assert.Equal("line1.filler", channel.ExternalId);
        Assert.Equal(42 + ConfigurationBackupService.SeqRestoreJump, channel.NextSeq); // leap over unknown cloud history
    }

    [Fact]
    public async Task Restore_ChannelAbsentFromBackup_IsDeletedWithOutboxPurged()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync(); // contains only line1.filler

        int strayId;
        await using (var db = new QueueDbContext(DatabasePath))
        {
            var stray = new OeeChannel
            {
                ExternalId = "commissioned.after.backup", Name = "Stray",
                RunDataPointId = "point-1", UpdatedAt = DateTime.UtcNow,
            };
            db.OeeChannels.Add(stray);
            await db.SaveChangesAsync();
            strayId = stray.Id;
            db.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = strayId, Seq = 0, Type = "sync", Ts = DateTime.UtcNow,
                State = "stopped", CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        Assert.Equal("line1.filler", (await verified.OeeChannels.SingleAsync()).ExternalId);
        Assert.Equal(0, await verified.OeeOutboxMessages.CountAsync(m => m.ChannelId == strayId));
    }

    [Fact]
    public async Task Restore_AdvancesUpdatedAt_SoChannelsAreRedeclared()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync();
        var before = DateTime.UtcNow;

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        Assert.True((await verified.OeeChannels.SingleAsync()).UpdatedAt >= before); // watermark moved → OeeSyncService re-declares
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
        db.OeeChannels.Add(new OeeChannel
        {
            ExternalId = "line1.filler",
            Name = "Line 1 — Filler",
            Enabled = true,
            RunDataPointId = "point-1",
            GoodDataPointId = "point-1",
            DebounceSeconds = 3,
            NextSeq = 42,
            LastState = "running",           // runtime state — must NOT appear in the backup
            LastCode = "E0",
            LastStateChangedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
