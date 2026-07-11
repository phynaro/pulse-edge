using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Storage;

public class QueueDbContext : DbContext
{
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

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        string pulseFolder;
        if (OperatingSystem.IsWindows())
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
}
