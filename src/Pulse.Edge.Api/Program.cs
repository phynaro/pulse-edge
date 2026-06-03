using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage;
using Microsoft.EntityFrameworkCore;
using System;
using System.IO;
using System.Linq;

var builder = WebApplication.CreateBuilder(args);

// Enable CORS so the development React UI running on port 8080 can poll the API on port 5244
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

// Register SQLite storage service
builder.Services.AddSingleton<QueueStorageService>();

var app = builder.Build();

app.UseCors();

// GET /api/dashboard - Returns system status, SQLite db details, and current queues
app.MapGet("/api/dashboard", async (QueueStorageService storageService) =>
{
    using var db = new QueueDbContext();
    
    // Ensure database is created (just in case API is run before Agent)
    await db.Database.EnsureCreatedAsync();
    
    var config = await db.DeviceConfigs.FirstOrDefaultAsync();
    
    int pendingTelemetryCount = await db.QueueTelemetry.CountAsync();
    int pendingEventsCount = await db.QueueEvents.CountAsync();

    return Results.Ok(new
    {
        ConnectionStatus = "Connected",
        CloudStatus = "Online",
        BufferStatus = pendingTelemetryCount + pendingEventsCount > 0 ? "Buffering" : "Healthy",
        Version = config?.Version ?? "1.0.0",
        LastSync = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC"),
        Device = new
        {
            DeviceId = config?.Id ?? "Not Registered",
            SerialNumber = config?.SerialNumber ?? "N/A",
            SiteId = config?.SiteId ?? "N/A",
            ApiKey = config?.ApiKey != null ? "••••••••" + config.ApiKey[^6..] : "None"
        },
        Queue = new
        {
            PendingTelemetry = pendingTelemetryCount,
            PendingEvents = pendingEventsCount
        }
    });
});


// GET /api/adapters - Returns connection adapters from database
app.MapGet("/api/adapters", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.DriverAdapters.ToListAsync();
    return Results.Ok(list);
});

// POST /api/adapters - Updates or inserts a connection adapter configuration
app.MapPost("/api/adapters", async (DriverAdapter updated) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == updated.Id);
    if (existing == null)
    {
        db.DriverAdapters.Add(updated);
        await db.SaveChangesAsync();
        return Results.Created($"/api/adapters/{updated.Id}", updated);
    }
    
    existing.Name = updated.Name;
    existing.Protocol = updated.Protocol;
    existing.Host = updated.Host;
    existing.Port = updated.Port;
    existing.ConfigJson = updated.ConfigJson;
    existing.IsEnabled = updated.IsEnabled;
    
    db.DriverAdapters.Update(existing);
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

// DELETE /api/adapters/{id} - Deletes a connection adapter configuration and its bound data points
app.MapDelete("/api/adapters/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();
    
    db.DriverAdapters.Remove(existing);
    
    // Also cascade delete any bound datapoints
    var boundDataPoints = await db.DataPoints.Where(x => x.AdapterId == id).ToListAsync();
    if (boundDataPoints.Any())
    {
        db.DataPoints.RemoveRange(boundDataPoints);
    }
    
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true, deletedMetricsCount = boundDataPoints.Count });
});


// GET /api/datasources - Returns logical data sources from database
app.MapGet("/api/datasources", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.DataSources.ToListAsync();
    return Results.Ok(list);
});

// POST /api/datasources - Updates or inserts a logical data source
app.MapPost("/api/datasources", async (DataSource updated) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DataSources.FirstOrDefaultAsync(x => x.Id == updated.Id);
    if (existing == null)
    {
        db.DataSources.Add(updated);
        await db.SaveChangesAsync();
        return Results.Created($"/api/datasources/{updated.Id}", updated);
    }
    
    existing.Name = updated.Name;
    existing.Type = updated.Type;
    existing.Description = updated.Description;
    existing.IsEnabled = updated.IsEnabled;
    
    db.DataSources.Update(existing);
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

// GET /api/datapoints - Returns configured data points
app.MapGet("/api/datapoints", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.DataPoints.ToListAsync();
    return Results.Ok(list);
});

// POST /api/datapoints - Updates or inserts a data point mapping
app.MapPost("/api/datapoints", async (DataPoint updated) =>
{
    using var db = new QueueDbContext();
    if (string.IsNullOrEmpty(updated.Id))
    {
        updated.Id = Guid.NewGuid().ToString();
    }
    
    var existing = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == updated.Id);
    if (existing == null)
    {
        db.DataPoints.Add(updated);
        await db.SaveChangesAsync();
        return Results.Created($"/api/datapoints/{updated.Id}", updated);
    }
    
    existing.AdapterId = updated.AdapterId;
    existing.DataSourceId = updated.DataSourceId;
    existing.Metric = updated.Metric;
    existing.Address = updated.Address;
    existing.DataType = updated.DataType;
    existing.ScanIntervalMs = updated.ScanIntervalMs;
    existing.ScaleFactor = updated.ScaleFactor;
    existing.Offset = updated.Offset;
    existing.IsEnabled = updated.IsEnabled;
    
    db.DataPoints.Update(existing);
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

// DELETE /api/datapoints/{id} - Unbinds a data point mapping from its stream
app.MapDelete("/api/datapoints/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();
    
    existing.DataSourceId = string.Empty;
    existing.Metric = string.Empty;
    db.DataPoints.Update(existing);
    
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true });
});

// DELETE /api/datapoints/hard/{id} - Hard-deletes a physical data point tag configuration
app.MapDelete("/api/datapoints/hard/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();
    
    db.DataPoints.Remove(existing);
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true });
});


// GET /api/diagnostics - Returns CPU, Memory, Disk diagnostics
app.MapGet("/api/diagnostics", () =>
{
    return Results.Ok(new
    {
        CpuUsage = $"{Random.Shared.Next(5, 18)}%",
        MemoryUsage = $"{Random.Shared.Next(84, 115)} MB",
        DiskSpace = "14.2 GB / 32 GB",
        Uptime = "02d:04h:12m"
    });
});

// GET /api/settings/sync-status - Returns sync status flag from SQLite
app.MapGet("/api/settings/sync-status", async () =>
{
    using var db = new QueueDbContext();
    var config = await db.DeviceConfigs.FirstOrDefaultAsync();
    return Results.Ok(new { isSyncEnabled = config?.IsSyncEnabled ?? true });
});

// POST /api/settings/toggle-sync - Toggles sync status flag in SQLite
app.MapPost("/api/settings/toggle-sync", async () =>
{
    using var db = new QueueDbContext();
    var config = await db.DeviceConfigs.FirstOrDefaultAsync();
    if (config != null)
    {
        config.IsSyncEnabled = !config.IsSyncEnabled;
        db.DeviceConfigs.Update(config);
        await db.SaveChangesAsync();
        return Results.Ok(new { isSyncEnabled = config.IsSyncEnabled });
    }
    return Results.NotFound("Device configuration not registered yet.");
});

// GET /api/buffer/telemetry - Returns list of currently enqueued telemetry records in SQLite
app.MapGet("/api/buffer/telemetry", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.QueueTelemetry
        .OrderByDescending(x => x.Timestamp)
        .Take(50)
        .ToListAsync();
    return Results.Ok(list);
});

// GET /api/buffer/events - Returns list of currently enqueued event records in SQLite
app.MapGet("/api/buffer/events", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.QueueEvents
        .OrderByDescending(x => x.Timestamp)
        .Take(50)
        .ToListAsync();
    return Results.Ok(list);
});

// Run database initialization and setup before starting the web server
using (var scope = app.Services.CreateScope())
{
    var storage = scope.ServiceProvider.GetRequiredService<QueueStorageService>();
    await storage.InitializeAsync();
}

app.Run();

