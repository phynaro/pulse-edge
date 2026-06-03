using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Storage.Services;

public class QueueStorageService
{
    // Initializes the SQLite database, creating it and its tables if they do not exist
    public async Task InitializeAsync()
    {
        using var db = new QueueDbContext();
        await db.Database.EnsureCreatedAsync();
        
        // Auto-migrate schema: add IsSyncEnabled column to existing databases if it's missing
        try
        {
            await db.Database.ExecuteSqlRawAsync("ALTER TABLE DeviceConfigs ADD COLUMN IsSyncEnabled INTEGER NOT NULL DEFAULT 1;");
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
                    LastValue TEXT NULL,
                    LastError TEXT NULL,
                    LastUpdated TEXT NULL
                );
            ");
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
        
        // Safety check: reset sending status for any items stuck in-flight due to an abrupt shutdown/crash
        await ResetSendingStatusAsync();

        // Seed default driver adapters if not present in database
        if (!await db.DriverAdapters.AnyAsync())
        {
            db.DriverAdapters.AddRange(new List<DriverAdapter>
            {
                new() { Id = "adp-opcua-1", Name = "OPC UA PLC 1", Protocol = "OPC_UA", Host = "opc.tcp://192.168.1.50:4840", Port = 4840, IsEnabled = true, Status = "Disconnected", ConfigJson = "{}" },
                new() { Id = "adp-mqtt-1", Name = "HiveMQ Broker", Protocol = "MQTT", Host = "broker.hivemq.com", Port = 1883, IsEnabled = true, Status = "Disconnected", ConfigJson = "{}" },
                new() { Id = "adp-modbus-1", Name = "Modbus Simulator", Protocol = "MODBUS_TCP", Host = "192.168.1.51:502", Port = 502, IsEnabled = true, Status = "Disconnected", ConfigJson = "{}" }
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
                new() { Id = "dp-01", AdapterId = "adp-opcua-1", DataSourceId = "DS001", Metric = "temperature", Address = "ns=2;s=Machine_Temperature", DataType = "Float", ScanIntervalMs = 1000, ScaleFactor = 1.0, Offset = 0.0, IsEnabled = true },
                new() { Id = "dp-02", AdapterId = "adp-mqtt-1", DataSourceId = "DS001", Metric = "good_count", Address = "pulse/factory/casepacker/temp", DataType = "Int32", ScanIntervalMs = 0, ScaleFactor = 1.0, Offset = 0.0, IsEnabled = true },
                new() { Id = "dp-03", AdapterId = "adp-modbus-1", DataSourceId = "DS002", Metric = "voltage", Address = "40001", DataType = "Float", ScanIntervalMs = 5000, ScaleFactor = 0.1, Offset = 0.0, IsEnabled = true },
                new() { Id = "dp-04", AdapterId = "adp-modbus-1", DataSourceId = "DS002", Metric = "power", Address = "40002", DataType = "Float", ScanIntervalMs = 5000, ScaleFactor = 1.0, Offset = 0.0, IsEnabled = true }
            });
            await db.SaveChangesAsync();
        }
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
            existing.ApiKey = config.ApiKey;
            existing.Version = config.Version;
            existing.IsSyncEnabled = config.IsSyncEnabled;
            db.DeviceConfigs.Update(existing);
        }
        else
        {
            db.DeviceConfigs.Add(config);
        }
        await db.SaveChangesAsync();
    }

    // --- STORE AND FORWARD TELEMETRY QUEUE ---

    // Add telemetry data to local SQLite database queue
    public async Task EnqueueTelemetryAsync(string dataSourceId, string payloadJson)
    {
        using var db = new QueueDbContext();
        var item = new QueueTelemetry
        {
            DataSourceId = dataSourceId,
            PayloadJson = payloadJson,
            Timestamp = DateTime.UtcNow,
            RetryCount = 0,
            IsSending = false
        };
        db.QueueTelemetry.Add(item);
        await db.SaveChangesAsync();
    }

    // Extract a batch of telemetry for synchronization
    public async Task<List<QueueTelemetry>> GetPendingTelemetryBatchAsync(int batchSize)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueTelemetry
            .Where(x => !x.IsSending)
            .OrderBy(x => x.Timestamp)
            .Take(batchSize)
            .ToListAsync();

        if (items.Any())
        {
            // Mark items as in-flight so concurrent processes don't select them
            foreach (var item in items)
            {
                item.IsSending = true;
            }
            await db.SaveChangesAsync();
        }

        return items;
    }

    // Deletes items after successful transmission to PULSE Cloud
    public async Task CompleteTelemetryBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueTelemetry.Where(x => ids.Contains(x.Id)).ToListAsync();
        db.QueueTelemetry.RemoveRange(items);
        await db.SaveChangesAsync();
    }

    // Handles transmission failure: increments retry and unlocks the items
    public async Task FailTelemetryBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueTelemetry.Where(x => ids.Contains(x.Id)).ToListAsync();
        foreach (var item in items)
        {
            item.RetryCount++;
            item.IsSending = false;
        }
        await db.SaveChangesAsync();
    }

    // --- STORE AND FORWARD EVENTS QUEUE ---

    // Add events (alarms, states) to local SQLite database queue
    public async Task EnqueueEventAsync(string eventType, string payloadJson)
    {
        using var db = new QueueDbContext();
        var item = new QueueEvent
        {
            EventType = eventType,
            PayloadJson = payloadJson,
            Timestamp = DateTime.UtcNow,
            RetryCount = 0,
            IsSending = false
        };
        db.QueueEvents.Add(item);
        await db.SaveChangesAsync();
    }

    // Extract a batch of events for synchronization
    public async Task<List<QueueEvent>> GetPendingEventsBatchAsync(int batchSize)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueEvents
            .Where(x => !x.IsSending)
            .OrderBy(x => x.Timestamp)
            .Take(batchSize)
            .ToListAsync();

        if (items.Any())
        {
            // Mark items as in-flight
            foreach (var item in items)
            {
                item.IsSending = true;
            }
            await db.SaveChangesAsync();
        }

        return items;
    }

    // Deletes events after successful transmission
    public async Task CompleteEventsBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueEvents.Where(x => ids.Contains(x.Id)).ToListAsync();
        db.QueueEvents.RemoveRange(items);
        await db.SaveChangesAsync();
    }

    // Handles event transmission failure
    public async Task FailEventsBatchAsync(IEnumerable<int> ids)
    {
        using var db = new QueueDbContext();
        var items = await db.QueueEvents.Where(x => ids.Contains(x.Id)).ToListAsync();
        foreach (var item in items)
        {
            item.RetryCount++;
            item.IsSending = false;
        }
        await db.SaveChangesAsync();
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
