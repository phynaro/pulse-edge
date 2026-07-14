using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Security;

namespace Pulse.Edge.Storage;

public class QueueDbContext : DbContext
{
    private readonly string? _databasePath;

    public QueueDbContext()
    {
    }

    public QueueDbContext(string databasePath)
    {
        if (string.IsNullOrWhiteSpace(databasePath))
            throw new ArgumentException("A database path is required.", nameof(databasePath));

        _databasePath = Path.GetFullPath(databasePath);
    }

    public DbSet<DeviceConfig> DeviceConfigs => Set<DeviceConfig>();
    public DbSet<QueueEvent> QueueEvents => Set<QueueEvent>();
    public DbSet<QueueTelemetry> QueueTelemetry => Set<QueueTelemetry>();
    public DbSet<DriverAdapter> DriverAdapters => Set<DriverAdapter>();
    public DbSet<DataSource> DataSources => Set<DataSource>();
    public DbSet<DataPoint> DataPoints => Set<DataPoint>();
    public DbSet<MqttDevice> MqttDevices => Set<MqttDevice>();
    public DbSet<StreamTemplate> StreamTemplates => Set<StreamTemplate>();
    public DbSet<LocalUser> LocalUsers => Set<LocalUser>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<DiagnosticEvent> DiagnosticEvents => Set<DiagnosticEvent>();
    public DbSet<DiagnosticCaptureConfig> DiagnosticCaptureConfigs => Set<DiagnosticCaptureConfig>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (optionsBuilder.IsConfigured) return;

        if (_databasePath is not null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_databasePath)!);
            optionsBuilder.UseSqlite($"Data Source={_databasePath}");
            return;
        }

        // Default path resolution. An explicit PULSE_EDGE_DATA_DIR override wins (used by
        // integration tests and by operators who relocate the data directory).
        var overrideDir = Environment.GetEnvironmentVariable("PULSE_EDGE_DATA_DIR");
        string pulseFolder;
        if (!string.IsNullOrWhiteSpace(overrideDir))
        {
            pulseFolder = overrideDir;
        }
        else if (OperatingSystem.IsWindows())
        {
            var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            pulseFolder = Path.Combine(appDataFolder, "PULSE Edge");
        }
        else
        {
            var userFolder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            pulseFolder = Path.Combine(userFolder, ".pulse");
        }

        Directory.CreateDirectory(pulseFolder); // Ensure the folder exists
        var dbPath = Path.Combine(pulseFolder, "edge.db");

        optionsBuilder.UseSqlite($"Data Source={dbPath}");
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Encrypt the cloud credentials at rest (Slice 2C / B-07). The DB stores ciphertext;
        // every reader sees plaintext. The converter reads SecretProtection.Protector at call
        // time, so it works regardless of when the protector is configured. Device/protocol
        // credentials (DriverAdapter.ConfigJson) are intentionally NOT encrypted (R-008).
        var secretConverter = new Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<string, string>(
            plaintext => SecretProtection.Protector.Protect(plaintext),
            stored => SecretProtection.Protector.Unprotect(stored));

        modelBuilder.Entity<DeviceConfig>().Property(x => x.ApiKey).HasConversion(secretConverter);
        modelBuilder.Entity<DeviceConfig>().Property(x => x.ClaimSecret).HasConversion(secretConverter);
        modelBuilder.Entity<DeviceConfig>().Property(x => x.PairingToken).HasConversion(secretConverter);
    }
}
