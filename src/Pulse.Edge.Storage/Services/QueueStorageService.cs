using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Linq;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Storage.Services;

public class QueueStorageService
{
    // ─────────────────────────────────────────────────────────────────────────
    // Buffer limits
    // ─────────────────────────────────────────────────────────────────────────
    private const int MaxBufferRows = 10_000;
    private static readonly TimeSpan MaxBufferAge = TimeSpan.FromDays(7);

    // Initializes the SQLite database, creating it and its tables if they do not exist
    public async Task InitializeAsync()
    {
        using var db = new QueueDbContext();
        await db.Database.EnsureCreatedAsync();

        // Enable Write-Ahead Logging (WAL) for better concurrent read/write throughput
        try
        {
            await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
        }
        catch {}
        
        // Auto-migrate schema: add IsSyncEnabled column to existing databases if it's missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DeviceConfigs ADD COLUMN IsSyncEnabled INTEGER NOT NULL DEFAULT 1;");
        }
        catch
        {
            // Column already exists, ignore exception
        }

        // Auto-migrate schema: add CloudEdgeId column to existing databases if it's missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DeviceConfigs ADD COLUMN CloudEdgeId TEXT NOT NULL DEFAULT '';");
        }
        catch
        {
            // Column already exists, ignore exception
        }

        // Auto-migrate schema: add CloudEndpoint column to existing databases if it's missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DeviceConfigs ADD COLUMN CloudEndpoint TEXT NOT NULL DEFAULT 'http://localhost:3000';");
        }
        catch
        {
            // Column already exists, ignore exception
        }

        // Auto-migrate schema: add CloudStatus column to existing databases if it's missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DeviceConfigs ADD COLUMN CloudStatus TEXT NOT NULL DEFAULT 'PendingApproval';");
        }
        catch
        {
            // Column already exists, ignore exception
        }

        // Auto-migrate schema: add SiteName column to existing databases if it's missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DeviceConfigs ADD COLUMN SiteName TEXT NOT NULL DEFAULT '';");
        }
        catch
        {
            // Column already exists, ignore exception
        }

        // Create DriverAdapters table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS DriverAdapters (
                    Id TEXT PRIMARY KEY,
                    Name TEXT NOT NULL,
                    Protocol TEXT NOT NULL,
                    Host TEXT NOT NULL,
                    Port INTEGER NOT NULL,
                    ConfigJson TEXT NOT NULL,
                    IsEnabled INTEGER NOT NULL,
                    Status TEXT NOT NULL
                );
            ");
        }
        catch {}

        // Create DataSources table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS DataSources (
                    Id TEXT PRIMARY KEY,
                    Name TEXT NOT NULL,
                    Type TEXT NOT NULL,
                    Description TEXT NOT NULL,
                    IsEnabled INTEGER NOT NULL DEFAULT 1
                );
            ");
        }
        catch {}

        // Add Type and IsEnabled columns to existing DataSources table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataSources ADD COLUMN Type TEXT NOT NULL DEFAULT 'General';");
        }
        catch {}
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataSources ADD COLUMN IsEnabled INTEGER NOT NULL DEFAULT 1;");
        }
        catch {}

        // Create StreamTemplates table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS StreamTemplates (
                    Id TEXT PRIMARY KEY,
                    Description TEXT NOT NULL,
                    ParametersJson TEXT NOT NULL,
                    Icon TEXT NOT NULL DEFAULT 'Database'
                );
            ");
        }
        catch {}

        // Create DataPoints table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE IF NOT EXISTS DataPoints (
                    Id TEXT PRIMARY KEY,
                    AdapterId TEXT NOT NULL,
                    DataSourceId TEXT NOT NULL,
                    Metric TEXT NOT NULL,
                    Address TEXT NOT NULL,
                    DataType TEXT NOT NULL,
                    ScanIntervalMs INTEGER NOT NULL,
                    ScaleFactor REAL NOT NULL,
                    Offset REAL NOT NULL,
                    IsEnabled INTEGER NOT NULL,
                    ByteOrder TEXT NOT NULL DEFAULT 'ABCD',
                    Description TEXT NULL,
                    MqttParseMode TEXT NOT NULL DEFAULT 'Plaintext',
                    MqttJsonPath TEXT NULL,
                    LastValue TEXT NULL,
                    LastError TEXT NULL,
                    LastUpdated TEXT NULL,
                    ConsecutiveFailures INTEGER NOT NULL DEFAULT 0
                );
            ");
        }
        catch {}

        // Add Description column to existing DataPoints table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN Description TEXT NULL;");
        }
        catch {}

        // Add MqttParseMode column to existing DataPoints table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN MqttParseMode TEXT NOT NULL DEFAULT 'Plaintext';");
        }
        catch {}

        // Add MqttJsonPath column to existing DataPoints table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN MqttJsonPath TEXT NULL;");
        }
        catch {}

        // Add ByteOrder column to existing DataPoints table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN ByteOrder TEXT NOT NULL DEFAULT 'ABCD';");
        }
        catch {}

        // Add diagnostic columns to existing DataPoints table if missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN LastValue TEXT NULL;");
        }
        catch {}
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN LastError TEXT NULL;");
        }
        catch {}
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN LastUpdated TEXT NULL;");
        }
        catch {}
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DataPoints ADD COLUMN ConsecutiveFailures INTEGER NOT NULL DEFAULT 0;");
        }
        catch {}

        // ── Telemetry Queue Migration ─────────────────────────────────────────
        // Drop old single-metric schema and create the new merged-metrics schema.
        // Old schema: (Id, DataSourceId, PayloadJson, Timestamp, RetryCount, IsSending)
        // New schema: (Id, DataSourceId, Timestamp, MetricsJson, RetryCount, IsSending)
        //             with UNIQUE (DataSourceId, Timestamp) for upsert merging.
        await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS QueueTelemetry;");

        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE IF NOT EXISTS QueueTelemetry (
                Id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                DataSourceId TEXT    NOT NULL,
                Timestamp    TEXT    NOT NULL,
                MetricsJson  TEXT    NOT NULL DEFAULT '{{}}',
                RetryCount   INTEGER NOT NULL DEFAULT 0,
                IsSending    INTEGER NOT NULL DEFAULT 0,
                UNIQUE (DataSourceId, Timestamp)
            );
        ");

        // Fast index for the sync read path: WHERE IsSending=0 ORDER BY Timestamp
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE INDEX IF NOT EXISTS idx_queue_pending
                ON QueueTelemetry (IsSending, Timestamp);
        ");

        // Safety check: reset sending status for any items stuck in-flight due to an abrupt shutdown/crash
        await ResetSendingStatusAsync();

        // Seed default driver adapters if not present in database
        if (!await db.DriverAdapters.AnyAsync())
        {
            db.DriverAdapters.AddRange(new List<DriverAdapter>
            {
                new() { Id = "adp-opcua-1", Name = "OPC UA PLC 1", Protocol = "OPC_UA", Host = "opc.tcp://192.168.1.50:4840", Port = 4840, IsEnabled = true, Status = "Disconnected", ConfigJson = "{}" },
                new() { Id = "adp-mqtt-1", Name = "HiveMQ Broker", Protocol = "MQTT", Host = "broker.hivemq.com", Port = 1883, IsEnabled = true, Status = "Disconnected", ConfigJson = "{}" },
                new() { Id = "adp-modbus-1", Name = "Modbus Simulator", Protocol = "MODBUS_TCP", Host = "192.168.1.51", Port = 502, IsEnabled = true, Status = "Disconnected", ConfigJson = "{}" }
            });
            await db.SaveChangesAsync();
        }

        // Seed default stream templates if not present
        if (!await db.StreamTemplates.AnyAsync())
        {
            db.StreamTemplates.AddRange(new List<StreamTemplate>
            {
                new() { Id = "Production", Description = "OEE & Production Counts", ParametersJson = "[\"RunStatus\",\"GoodCount\",\"RejectCount\"]", Icon = "BarChart3" },
                new() { Id = "Energy", Description = "Power and energy meters", ParametersJson = "[\"Voltage\",\"Current\",\"Power\",\"Energy\"]", Icon = "Zap" }
            });
            await db.SaveChangesAsync();
        }

        // Seed default data sources if not present
        if (!await db.DataSources.AnyAsync())
        {
            db.DataSources.AddRange(new List<DataSource>
            {
                new() { Id = "DS001", Name = "CasePacker Production", Type = "Production", Description = "Main telemetry signals for the line packer" },
                new() { Id = "DS002", Name = "Packaging Line Energy", Type = "Energy", Description = "Substation power meter telemetry" }
            });
            await db.SaveChangesAsync();
        }

        // Seed default data points if not present
        if (!await db.DataPoints.AnyAsync())
        {
            db.DataPoints.AddRange(new List<DataPoint>
            {
                new() { Id = "dp-01", AdapterId = "adp-opcua-1", DataSourceId = "DS001", Metric = "temperature", Address = "ns=2;s=Machine_Temperature", DataType = "Float", ScanIntervalMs = 1000, ScaleFactor = 1.0, Offset = 0.0, IsEnabled = true, Description = "OPC UA machine block temperature sensor" },
                new() { Id = "dp-02", AdapterId = "adp-mqtt-1", DataSourceId = "DS001", Metric = "good_count", Address = "pulse/factory/casepacker/temp", DataType = "Int32", ScanIntervalMs = 0, ScaleFactor = 1.0, Offset = 0.0, IsEnabled = true, Description = "MQTT MQTT CasePacker packer counter broker topic" },
                new() { Id = "dp-03", AdapterId = "adp-modbus-1", DataSourceId = "DS002", Metric = "voltage", Address = "40001", DataType = "Int16", ScanIntervalMs = 5000, ScaleFactor = 0.1, Offset = 0.0, IsEnabled = true, Description = "Substation incoming busbar voltage register" },
                new() { Id = "dp-04", AdapterId = "adp-modbus-1", DataSourceId = "DS002", Metric = "power", Address = "40002", DataType = "Int16", ScanIntervalMs = 5000, ScaleFactor = 1.0, Offset = 0.0, IsEnabled = true, Description = "Substation energy meter active power register" }
            });
            await db.SaveChangesAsync();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CACHING UTILITIES
    // ─────────────────────────────────────────────────────────────────────────
    private readonly ConcurrentDictionary<string, bool> _enabledDataSourceCache = new();
    private DateTime _lastCacheRefresh = DateTime.MinValue;
    private readonly SemaphoreSlim _cacheLock = new(1, 1);

    /// <summary>
    /// Checks if a data source is enabled, utilizing a thread-safe in-memory cache refreshed every 10 seconds.
    /// This avoids repetitive SQLite disk read queries during high-frequency telemetry loops.
    /// </summary>
    public async Task<bool> IsDataSourceEnabledAsync(string dataSourceId)
    {
        if (string.IsNullOrEmpty(dataSourceId)) return false;

        if (DateTime.UtcNow - _lastCacheRefresh > TimeSpan.FromSeconds(10))
        {
            await _cacheLock.WaitAsync();
            try
            {
                if (DateTime.UtcNow - _lastCacheRefresh > TimeSpan.FromSeconds(10))
                {
                    using var db = new QueueDbContext();
                    var list = await db.DataSources.Select(x => new { x.Id, x.IsEnabled }).ToListAsync();
                    _enabledDataSourceCache.Clear();
                    foreach (var item in list)
                    {
                        _enabledDataSourceCache[item.Id] = item.IsEnabled;
                    }
                    _lastCacheRefresh = DateTime.UtcNow;
                }
            }
            catch
            {
                // Ignore errors to allow fallback to cache/default
            }
            finally
            {
                _cacheLock.Release();
            }
        }

        return _enabledDataSourceCache.TryGetValue(dataSourceId, out bool enabled) ? enabled : true;
    }

    // Fetches the saved configuration, if any
    public async Task<DeviceConfig?> GetDeviceConfigAsync()
    {
        using var db = new QueueDbContext();
        return await db.DeviceConfigs.FirstOrDefaultAsync();
    }

    // Saves the configuration, replacing any older one
    public async Task SaveDeviceConfigAsync(DeviceConfig config)
    {
        using var db = new QueueDbContext();
        var existing = await db.DeviceConfigs.FirstOrDefaultAsync();
        if (existing != null)
        {
            existing.SerialNumber = config.SerialNumber;
            existing.SiteId = config.SiteId;
            existing.SiteName = config.SiteName;
            existing.ApiKey = config.ApiKey;
            existing.Version = config.Version;
            existing.IsSyncEnabled = config.IsSyncEnabled;
            existing.CloudEndpoint = config.CloudEndpoint;
            existing.CloudEdgeId = config.CloudEdgeId;
            existing.CloudStatus = config.CloudStatus;
            db.DeviceConfigs.Update(existing);
        }
        else
        {
            db.DeviceConfigs.Add(config);
        }
        await db.SaveChangesAsync();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STORE AND FORWARD TELEMETRY QUEUE (merged-metrics design)
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Enqueues a single metric reading into the merged-metrics telemetry buffer.
    ///
    /// Grouping key: (DataSourceId, Timestamp truncated to ms)
    ///   - Uses SQLite-native INSERT OR IGNORE + UPDATE json_set so that the
    ///     UNIQUE (DataSourceId, Timestamp) constraint itself drives the upsert.
    ///     This avoids EF Core DateTime text-format comparison mismatches that
    ///     would otherwise cause spurious UNIQUE constraint violations.
    ///   - All tags polled in the same tick for the same stream produce ONE row.
    /// </summary>
    public async Task EnqueueTelemetryAsync(string dataSourceId, DateTime timestamp, string metricName, double value)
    {
        using var db = new QueueDbContext();

        // Truncate to millisecond precision — stable, consistent UNIQUE key
        var ts = new DateTime(
            timestamp.Year, timestamp.Month, timestamp.Day,
            timestamp.Hour, timestamp.Minute, timestamp.Second,
            timestamp.Millisecond, DateTimeKind.Utc);

        // Initial JSON for a brand-new row
        var initialJson = JsonSerializer.Serialize(new Dictionary<string, double> { [metricName] = value });

        // The JSON path for json_set, e.g. "$.temperature"
        var jsonPath = "$." + metricName;

        // Step 1: Insert a new row only if no row exists for this (stream, tick).
        //         INSERT OR IGNORE silently skips if the UNIQUE constraint fires.
        await db.Database.ExecuteSqlInterpolatedAsync($@"
            INSERT OR IGNORE INTO QueueTelemetry (DataSourceId, Timestamp, MetricsJson, RetryCount, IsSending)
            VALUES ({dataSourceId}, {ts}, {initialJson}, 0, 0)
        ");

        // Step 2: Merge the metric into the row's MetricsJson using SQLite json_set.
        //         Runs whether we just inserted or the row already existed.
        //         json_set adds the key if missing or overwrites it if present.
        await db.Database.ExecuteSqlInterpolatedAsync($@"
            UPDATE QueueTelemetry
            SET MetricsJson = json_set(MetricsJson, {jsonPath}, {value})
            WHERE DataSourceId = {dataSourceId} AND Timestamp = {ts} AND IsSending = 0
        ");

        // Enforce buffer limits after every write
        await EnforceBufferCapAsync(db);
    }

    /// <summary>
    /// Enforces the row count cap (MaxBufferRows) and the age TTL (MaxBufferAge).
    /// Oldest rows are pruned first to preserve recent data.
    /// </summary>
    private static async Task EnforceBufferCapAsync(QueueDbContext db)
    {
        // 1. Row count cap
        var count = await db.QueueTelemetry.CountAsync();
        if (count > MaxBufferRows)
        {
            int excess = count - MaxBufferRows;
            var toDelete = await db.QueueTelemetry
                .Where(x => !x.IsSending)
                .OrderBy(x => x.Timestamp)
                .Take(excess)
                .ToListAsync();
            if (toDelete.Any())
            {
                db.QueueTelemetry.RemoveRange(toDelete);
                await db.SaveChangesAsync();
            }
        }

        // 2. Age TTL
        var cutoff = DateTime.UtcNow - MaxBufferAge;
        var stale = await db.QueueTelemetry
            .Where(x => x.Timestamp < cutoff && !x.IsSending)
            .ToListAsync();
        if (stale.Any())
        {
            db.QueueTelemetry.RemoveRange(stale);
            await db.SaveChangesAsync();
        }
    }

    /// <summary>
    /// Reads up to batchSize pending rows and marks them IsSending=true (in-flight lock).
    /// Rows are returned oldest-first to preserve delivery order.
    /// Batch size is larger (50) because each row now carries multiple metrics.
    /// </summary>
    public async Task<List<QueueTelemetry>> GetPendingTelemetryBatchAsync(int batchSize = 50)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueTelemetry
            .AsNoTracking()
            .Where(x => !x.IsSending)
            .OrderBy(x => x.Timestamp)
            .Take(batchSize)
            .ToListAsync();

        if (items.Any())
        {
            var ids = items.Select(x => x.Id).ToList();
            // Flag items in database as in-flight in a single query
            await db.QueueTelemetry
                .Where(x => ids.Contains(x.Id))
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsSending, true));

            foreach (var item in items)
            {
                item.IsSending = true;
            }
        }

        return items;
    }

    // Deletes items after successful transmission to PULSE Cloud
    public async Task CompleteTelemetryBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        await db.QueueTelemetry.Where(x => ids.Contains(x.Id)).ExecuteDeleteAsync();
    }

    // Handles transmission failure: increments retry and unlocks the items
    public async Task FailTelemetryBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        await db.QueueTelemetry
            .Where(x => ids.Contains(x.Id))
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.RetryCount, x => x.RetryCount + 1)
                .SetProperty(x => x.IsSending, false));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STORE AND FORWARD EVENTS QUEUE
    // ─────────────────────────────────────────────────────────────────────────

    // Add events (alarms, states) to local SQLite database queue
    public async Task EnqueueEventAsync(string eventType, string payloadJson)
    {
        using var db = new QueueDbContext();
        var item = new QueueEvent
        {
            EventType   = eventType,
            PayloadJson = payloadJson,
            Timestamp   = DateTime.UtcNow,
            RetryCount  = 0,
            IsSending   = false
        };
        db.QueueEvents.Add(item);
        await db.SaveChangesAsync();
    }

    // Extract a batch of events for synchronization
    public async Task<List<QueueEvent>> GetPendingEventsBatchAsync(int batchSize)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueEvents
            .AsNoTracking()
            .Where(x => !x.IsSending)
            .OrderBy(x => x.Timestamp)
            .Take(batchSize)
            .ToListAsync();

        if (items.Any())
        {
            var ids = items.Select(x => x.Id).ToList();
            await db.QueueEvents
                .Where(x => ids.Contains(x.Id))
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsSending, true));

            foreach (var item in items)
            {
                item.IsSending = true;
            }
        }

        return items;
    }

    // Deletes events after successful transmission
    public async Task CompleteEventsBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        await db.QueueEvents.Where(x => ids.Contains(x.Id)).ExecuteDeleteAsync();
    }

    // Handles event transmission failure
    public async Task FailEventsBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        await db.QueueEvents
            .Where(x => ids.Contains(x.Id))
            .ExecuteUpdateAsync(s => s
                .SetProperty(x => x.RetryCount, x => x.RetryCount + 1)
                .SetProperty(x => x.IsSending, false));
    }

    // Reset status on startup
    private async Task ResetSendingStatusAsync()
    {
        using var db = new QueueDbContext();
        
        var stuckTelemetry = await db.QueueTelemetry.Where(x => x.IsSending).ToListAsync();
        foreach (var t in stuckTelemetry)
        {
            t.IsSending = false;
        }

        var stuckEvents = await db.QueueEvents.Where(x => x.IsSending).ToListAsync();
        foreach (var e in stuckEvents)
        {
            e.IsSending = false;
        }

        if (stuckTelemetry.Any() || stuckEvents.Any())
        {
            await db.SaveChangesAsync();
        }
    }
}
