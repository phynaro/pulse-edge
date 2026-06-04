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
    public DbSet<StreamTemplate> StreamTemplates => Set<StreamTemplate>();

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        // Save database under a centralized user folder (~/.pulse/edge.db) so Agent and API share the same DB
        var userFolder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var pulseFolder = Path.Combine(userFolder, ".pulse");
        Directory.CreateDirectory(pulseFolder); // Ensure the folder exists
        var dbPath = Path.Combine(pulseFolder, "edge.db");
        
        optionsBuilder.UseSqlite($"Data Source={dbPath}");
    }
}
