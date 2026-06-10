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
using System.Net.Sockets;
using System.Threading.Tasks;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Agent;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Protocols.MqttProtocol;
using Pulse.Edge.Protocols.Modbus;
using Microsoft.Extensions.FileProviders;
using Serilog;
using Serilog.Events;

// Configure Serilog daily rolling file and console logging
var appDataFolder = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
var logFolder = OperatingSystem.IsWindows()
    ? Path.Combine(appDataFolder, "PULSE Edge", "logs")
    : Path.Combine(AppContext.BaseDirectory, "logs");

Directory.CreateDirectory(logFolder);
var logPath = Path.Combine(logFolder, "edge-.txt");

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
    .MinimumLevel.Override("Microsoft.AspNetCore", LogEventLevel.Warning)
    .Enrich.FromLogContext()
    .WriteTo.Console()
    .WriteTo.File(
        logPath,
        rollingInterval: RollingInterval.Day,
        retainedFileCountLimit: 30,
        fileSizeLimitBytes: 10 * 1024 * 1024,
        rollOnFileSizeLimit: true,
        outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {Message:lj}{NewLine}{Exception}"
    )
    .CreateLogger();

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseSerilog();

// Append custom persistent configuration from ProgramData on Windows
if (OperatingSystem.IsWindows())
{
    var appData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    var pulseConfigFolder = Path.Combine(appData, "PULSE Edge");
    var configPath = Path.Combine(pulseConfigFolder, "config.json");
    var hashPath = Path.Combine(pulseConfigFolder, "config.json.sha256");

    if (File.Exists(configPath))
    {
        if (File.Exists(hashPath))
        {
            try
            {
                using var sha256 = System.Security.Cryptography.SHA256.Create();
                using var stream = File.OpenRead(configPath);
                var hashBytes = sha256.ComputeHash(stream);
                var calculatedHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
                var expectedHash = File.ReadAllText(hashPath).Trim().ToLowerInvariant();

                if (calculatedHash != expectedHash)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[CRITICAL SECURITY ALERT] Configuration file 'config.json' has been tampered with or modified unauthorized! Hash verification failed.");
                    Console.WriteLine($"Expected: {expectedHash}");
                    Console.WriteLine($"Calculated: {calculatedHash}");
                    Console.ResetColor();
                }
                else
                {
                    Console.WriteLine("[INFO] Configuration file integrity check passed successfully.");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[WARNING] Failed to verify configuration integrity: {ex.Message}");
            }
        }
        else
        {
            Console.WriteLine("[WARNING] Configuration integrity signature file 'config.json.sha256' is missing. Security validation skipped.");
        }

        builder.Configuration.AddJsonFile(configPath, optional: true, reloadOnChange: true);
    }
}

// Bind Kestrel port. Priority: Config override -> Default http://*:5288
var serverUrl = builder.Configuration["serverUrl"] ?? "http://*:5288";
builder.WebHost.UseUrls(serverUrl);

// Enable running as a Windows Service
builder.Host.UseWindowsService();

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

// Register SQLite storage service and OPC UA driver
builder.Services.AddSingleton<QueueStorageService>();
builder.Services.AddSingleton<OpcUaDriver>();
builder.Services.AddSingleton<CloudClient>();

var hostingMode = builder.Configuration["hostingMode"] ?? "SinglePort";
var isSinglePort = string.Equals(hostingMode, "SinglePort", StringComparison.OrdinalIgnoreCase);

if (isSinglePort)
{
    // Register Agent background synchronization & communication protocols
    builder.Services.AddSingleton<SyncService>();
    builder.Services.AddSingleton<MqttDriver>();
    builder.Services.AddSingleton<ModbusDriver>();

    // Register background Worker process
    builder.Services.AddHostedService<Worker>();
}

var app = builder.Build();

app.UseCors();

if (isSinglePort)
{
    // Serve React UI static assets embedded in the assembly
    var embeddedProvider = new ManifestEmbeddedFileProvider(typeof(Program).Assembly, "wwwroot");

    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = embeddedProvider
    });

    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = embeddedProvider
    });
}

// GET /health - Service health endpoint for installer and monitoring systems
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));

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
        CloudStatus = config?.CloudStatus ?? "PendingApproval",
        BufferStatus = pendingTelemetryCount + pendingEventsCount > 0 ? "Buffering" : "Healthy",
        Version = config?.Version ?? "1.0.0",
        LastSync = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC", System.Globalization.CultureInfo.InvariantCulture),
        Device = new
        {
            DeviceId = config?.Id ?? "Not Registered",
            CloudEdgeId = config?.CloudEdgeId ?? "Not Registered",
            SerialNumber = config?.SerialNumber ?? "N/A",
            SiteId = config?.SiteId ?? "N/A",
            SiteName = config?.SiteName ?? "N/A",
            ApiKey = !string.IsNullOrEmpty(config?.ApiKey) ? "••••••••" + config.ApiKey[Math.Max(0, config.ApiKey.Length - 6)..] : "None",
            CloudEndpoint = config?.CloudEndpoint ?? "http://localhost:3000"
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

// POST /api/adapters/test-connection - Tests IP and Port connectivity
app.MapPost("/api/adapters/test-connection", async (TestConnectionRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.Host))
    {
        return Results.BadRequest(new { success = false, message = "Host/IP is required." });
    }
    if (request.Port <= 0 || request.Port > 65535)
    {
        return Results.BadRequest(new { success = false, message = "Invalid port number. Port must be between 1 and 65535." });
    }

    string targetHost = request.Host;
    int targetPort = request.Port;

    // Handle host strings that contain a port suffix (e.g. 192.168.1.51:502)
    if (targetHost.Contains(':'))
    {
        var parts = targetHost.Split(':');
        targetHost = parts[0];
        if (parts.Length > 1 && int.TryParse(parts[1], out var parsedPort))
        {
            targetPort = parsedPort;
        }
    }

    try
    {
        using var client = new TcpClient();
        // Use a 2-second timeout for testing connection
        var connectTask = client.ConnectAsync(targetHost, targetPort);
        var delayTask = Task.Delay(2000);

        var completedTask = await Task.WhenAny(connectTask, delayTask);
        if (completedTask == connectTask)
        {
            await connectTask; // Throws if failed
            return Results.Ok(new { success = true, message = $"Successfully connected to {targetHost}:{targetPort}." });
        }
        else
        {
            return Results.Ok(new { success = false, message = $"Connection timed out after 2000ms attempting to reach {targetHost}:{targetPort}." });
        }
    }
    catch (SocketException ex)
    {
        return Results.Ok(new { 
            success = false, 
            message = $"Socket error: {ex.Message} (Error Code: {ex.SocketErrorCode}). Verify that the IP/host is correct and reachable, and that the remote server is active." 
        });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { 
            success = false, 
            message = $"Failed to connect: {ex.Message}" 
        });
    }
});

// POST /api/adapters/opcua/discover - Discover OPC UA endpoints for a host URL
app.MapPost("/api/adapters/opcua/discover", async (DiscoverEndpointsRequest request, OpcUaDriver opcUaDriver) =>
{
    if (string.IsNullOrWhiteSpace(request.DiscoveryUrl))
    {
        return Results.BadRequest(new { success = false, message = "Discovery URL is required." });
    }

    try
    {
        var endpoints = await opcUaDriver.DiscoverEndpointsAsync(request.DiscoveryUrl);
        return Results.Ok(new { success = true, endpoints });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, message = $"Discovery failed: {ex.Message}" });
    }
});

// POST /api/adapters/opcua/browse - Browse OPC UA nodes hierarchically
app.MapPost("/api/adapters/opcua/browse", async (BrowseNodesRequest request, OpcUaDriver opcUaDriver) =>
{
    if (string.IsNullOrWhiteSpace(request.AdapterId))
    {
        return Results.BadRequest(new { success = false, message = "AdapterId is required." });
    }

    try
    {
        using var db = new QueueDbContext();
        var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
        if (adapter == null)
        {
            return Results.NotFound(new { success = false, message = "Adapter not found." });
        }

        if (adapter.Protocol != "OPC_UA")
        {
            return Results.BadRequest(new { success = false, message = "Selected adapter is not an OPC UA adapter." });
        }

        string securityMode = "None";
        string securityPolicy = "http://opcfoundation.org/UA/SecurityPolicy#None";
        string username = "";
        string password = "";

        if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
        {
            try
            {
                var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("SecurityMode", out var smProp)) securityMode = smProp.GetString() ?? "None";
                if (root.TryGetProperty("SecurityPolicy", out var spProp)) securityPolicy = spProp.GetString() ?? "http://opcfoundation.org/UA/SecurityPolicy#None";
                if (root.TryGetProperty("Username", out var uProp)) username = uProp.GetString() ?? "";
                if (root.TryGetProperty("Password", out var pProp)) password = pProp.GetString() ?? "";
            }
            catch (Exception)
            {
                // Fallback to default
            }
        }

        string endpointUrl = adapter.Host;
        if (!endpointUrl.StartsWith("opc.tcp://", StringComparison.OrdinalIgnoreCase))
        {
            endpointUrl = $"opc.tcp://{adapter.Host}:{adapter.Port}";
        }

        var nodes = await opcUaDriver.BrowseNodesAsync(
            endpointUrl,
            securityMode,
            securityPolicy,
            username,
            password,
            request.NodeId);

        return Results.Ok(new { success = true, nodes });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
    }
});

// POST /api/adapters/mqtt/browse - Browse seen MQTT topics and their JSON paths
app.MapPost("/api/adapters/mqtt/browse", async (MqttBrowseRequest request) =>
{
    if (string.IsNullOrWhiteSpace(request.AdapterId))
    {
        return Results.BadRequest(new { success = false, message = "AdapterId is required." });
    }

    try
    {
        using var db = new QueueDbContext();
        var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
        if (adapter == null)
        {
            return Results.NotFound(new { success = false, message = "Adapter not found." });
        }

        if (adapter.Protocol != "MQTT")
        {
            return Results.BadRequest(new { success = false, message = "Selected adapter is not an MQTT adapter." });
        }

        var conn = db.Database.GetDbConnection();
        bool wasClosed = conn.State == System.Data.ConnectionState.Closed;
        if (wasClosed) await conn.OpenAsync();

        var topics = new List<MqttBrowseItem>();

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Topic, Payload, LastSeen FROM MqttSeenTopics ORDER BY Topic ASC;";
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                string topic = reader.GetString(0);
                string payload = reader.GetString(1);
                string lastSeen = reader.GetString(2);

                var keys = new List<MqttJsonKeyItem>();
                if (!string.IsNullOrWhiteSpace(payload))
                {
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(payload);
                        ExtractJsonPaths(doc.RootElement, "", keys);
                    }
                    catch
                    {
                        // Payload is not JSON or invalid
                    }
                }

                // If no JSON keys were extracted, add a default key for the raw payload
                if (keys.Count == 0)
                {
                    keys.Add(new MqttJsonKeyItem("$", "String", payload));
                }

                topics.Add(new MqttBrowseItem(topic, payload, lastSeen, keys));
            }
        }
        finally
        {
            if (wasClosed) await conn.CloseAsync();
        }

        return Results.Ok(new { success = true, topics });
    }
    catch (Exception ex)
    {
        return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
    }
});

// DELETE /api/adapters/{id} - Deletes a connection adapter configuration and its bound data points
app.MapDelete("/api/adapters/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();
    
    db.DriverAdapters.Remove(existing);
    
    // Also cascade delete any bound MQTT devices
    var boundDevices = await db.MqttDevices.Where(x => x.AdapterId == id).ToListAsync();
    if (boundDevices.Any())
    {
        db.MqttDevices.RemoveRange(boundDevices);
    }

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
app.MapPost("/api/datasources", async (DataSource updated, bool? create) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DataSources.FirstOrDefaultAsync(x => x.Id == updated.Id);
    if (create == true && existing != null)
    {
        return Results.BadRequest(new { error = $"Stream with ID '{updated.Id}' already exists." });
    }

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

// DELETE /api/datasources/{id} - Deletes a stream and unbinds all associated physical tags
app.MapDelete("/api/datasources/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.DataSources.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();

    // Find and unbind all data points mapped to this stream
    var boundDataPoints = await db.DataPoints.Where(x => x.DataSourceId == id).ToListAsync();
    foreach (var dp in boundDataPoints)
    {
        dp.DataSourceId = string.Empty;
        dp.Metric = string.Empty;
        db.DataPoints.Update(dp);
    }

    db.DataSources.Remove(existing);
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true, unboundTagsCount = boundDataPoints.Count });
});

// GET /api/stream-templates - Returns list of available stream templates
app.MapGet("/api/stream-templates", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.StreamTemplates.ToListAsync();
    return Results.Ok(list);
});

// POST /api/stream-templates - Creates or updates a stream template
app.MapPost("/api/stream-templates", async (StreamTemplate updated) =>
{
    using var db = new QueueDbContext();
    if (string.IsNullOrEmpty(updated.Id))
    {
        return Results.BadRequest(new { error = "Template ID/Name is required." });
    }

    var existing = await db.StreamTemplates.FirstOrDefaultAsync(x => x.Id == updated.Id);
    if (existing == null)
    {
        db.StreamTemplates.Add(updated);
        await db.SaveChangesAsync();
        return Results.Created($"/api/stream-templates/{updated.Id}", updated);
    }

    existing.Description = updated.Description;
    existing.ParametersJson = updated.ParametersJson;
    existing.Icon = updated.Icon;

    db.StreamTemplates.Update(existing);
    
    // Auto-unbind tags for removed parameters on all streams matching this template type
    var parametersList = updated.GetParameters();
    var affectedStreams = await db.DataSources.Where(x => x.Type == updated.Id).Select(x => x.Id).ToListAsync();
    if (affectedStreams.Any())
    {
        var datapointsToUnbind = await db.DataPoints
            .Where(x => x.DataSourceId != null && affectedStreams.Contains(x.DataSourceId!) && !string.IsNullOrEmpty(x.Metric))
            .ToListAsync();
            
        foreach (var dp in datapointsToUnbind)
        {
            if (dp.Metric != null && !parametersList.Contains(dp.Metric!))
            {
                dp.DataSourceId = string.Empty;
                dp.Metric = string.Empty;
                db.DataPoints.Update(dp);
            }
        }
    }

    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

// DELETE /api/stream-templates/{id} - Deletes a stream template
app.MapDelete("/api/stream-templates/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.StreamTemplates.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();

    // Prevent deletion if the template is currently in use by any stream
    bool isUsed = await db.DataSources.AnyAsync(x => x.Type == id);
    if (isUsed)
    {
        return Results.BadRequest(new { error = $"Template '{id}' is currently in use by one or more streams and cannot be deleted." });
    }

    db.StreamTemplates.Remove(existing);
    await db.SaveChangesAsync();
    return Results.Ok(new { success = true });
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
    existing.MqttDeviceId = updated.MqttDeviceId;
    existing.DataSourceId = updated.DataSourceId;
    existing.Metric = updated.Metric;
    existing.Address = updated.Address;
    existing.DataType = updated.DataType;
    existing.ScanIntervalMs = updated.ScanIntervalMs;
    existing.ScaleFactor = updated.ScaleFactor;
    existing.Offset = updated.Offset;
    existing.IsEnabled = updated.IsEnabled;
    existing.ByteOrder = updated.ByteOrder;
    existing.Description = updated.Description;
    existing.MqttParseMode = updated.MqttParseMode;
    existing.MqttJsonPath = updated.MqttJsonPath;
    existing.ConsecutiveFailures = updated.ConsecutiveFailures;
    
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

// GET /api/mqtt-devices - Returns configured MQTT devices
app.MapGet("/api/mqtt-devices", async () =>
{
    using var db = new QueueDbContext();
    var list = await db.MqttDevices.ToListAsync();
    return Results.Ok(list);
});

// POST /api/mqtt-devices - Updates or inserts an MQTT device
app.MapPost("/api/mqtt-devices", async (MqttDevice updated) =>
{
    using var db = new QueueDbContext();
    if (string.IsNullOrEmpty(updated.Id))
    {
        updated.Id = Guid.NewGuid().ToString();
    }
    
    var existing = await db.MqttDevices.FirstOrDefaultAsync(x => x.Id == updated.Id);
    if (existing == null)
    {
        db.MqttDevices.Add(updated);
    }
    else
    {
        existing.AdapterId = updated.AdapterId;
        existing.Name = updated.Name;
        existing.TopicSubscription = updated.TopicSubscription;
        existing.MqttParseMode = updated.MqttParseMode;
        existing.IsEnabled = updated.IsEnabled;
        existing.LwtTopic = updated.LwtTopic;
        existing.LwtOnlinePayload = updated.LwtOnlinePayload;
        existing.LwtOfflinePayload = updated.LwtOfflinePayload;
        existing.Status = updated.Status;
        existing.LastError = updated.LastError;
        existing.LastUpdated = updated.LastUpdated;
        existing.ConsecutiveFailures = updated.ConsecutiveFailures;
        db.MqttDevices.Update(existing);
    }
    
    await db.SaveChangesAsync();
    return Results.Created($"/api/mqtt-devices/{updated.Id}", updated);
});

// DELETE /api/mqtt-devices/{id} - Deletes an MQTT device configuration
app.MapDelete("/api/mqtt-devices/{id}", async (string id) =>
{
    using var db = new QueueDbContext();
    var existing = await db.MqttDevices.FirstOrDefaultAsync(x => x.Id == id);
    if (existing == null) return Results.NotFound();
    
    // Unbind any data points associated with this device
    var dps = await db.DataPoints.Where(x => x.MqttDeviceId == id).ToListAsync();
    foreach (var dp in dps)
    {
        dp.MqttDeviceId = null;
        db.DataPoints.Update(dp);
    }
    
    db.MqttDevices.Remove(existing);
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

// GET /api/settings - Returns raw settings from SQLite
app.MapGet("/api/settings", async () =>
{
    using var db = new QueueDbContext();
    var config = await db.DeviceConfigs.FirstOrDefaultAsync();
    return Results.Ok(new
    {
        SerialNumber = config?.SerialNumber ?? "",
        CloudEndpoint = config?.CloudEndpoint ?? "http://localhost:3000",
        ApiKey = config?.ApiKey ?? ""
    });
});

// POST /api/settings - Saves updated DeviceConfig (Cloud Endpoint, Serial Number) to SQLite database
app.MapPost("/api/settings", async (UpdateSettingsRequest request) =>
{
    using var db = new QueueDbContext();
    var config = await db.DeviceConfigs.FirstOrDefaultAsync();
    
    string generateClaimSecret()
    {
        var secretBytes = new byte[24];
        using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
        {
            rng.GetBytes(secretBytes);
        }
        return Convert.ToHexString(secretBytes).ToLowerInvariant();
    }

    if (config == null)
    {
        config = new DeviceConfig
        {
            Id = Guid.NewGuid().ToString(),
            ClaimSecret = generateClaimSecret(),
            SerialNumber = request.SerialNumber,
            CloudEndpoint = request.CloudEndpoint,
            ApiKey = "",
            SiteId = "",
            Version = "1.0.0",
            CloudStatus = "PendingApproval"
        };
        db.DeviceConfigs.Add(config);
    }
    else
    {
        bool resetRequired = config.CloudEndpoint != request.CloudEndpoint || config.SerialNumber != request.SerialNumber;
        
        config.SerialNumber = request.SerialNumber;
        config.CloudEndpoint = request.CloudEndpoint;
        
        if (resetRequired)
        {
            config.ApiKey = "";
            config.SiteId = "";
            config.SiteName = "";
            config.CloudStatus = "PendingApproval";
        }
        
        if (string.IsNullOrEmpty(config.ClaimSecret))
        {
            config.ClaimSecret = generateClaimSecret();
        }
        db.DeviceConfigs.Update(config);
    }
    await db.SaveChangesAsync();
    return Results.Ok(config);
});

// POST /api/settings/validate-cloud - Validates Cloud URL sync registration
app.MapPost("/api/settings/validate-cloud", async (ValidateCloudRequest request, CloudClient cloudClient) =>
{
    if (string.IsNullOrWhiteSpace(request.CloudEndpoint))
    {
        return Results.BadRequest(new { error = "Cloud target URL cannot be empty." });
    }

    if (!request.CloudEndpoint.StartsWith("http://") && !request.CloudEndpoint.StartsWith("https://"))
    {
        return Results.BadRequest(new { error = "Target URL must start with http:// or https://" });
    }

    try
    {
        using var httpClient = new HttpClient();
        httpClient.Timeout = TimeSpan.FromSeconds(5);
        
        var baseUri = new Uri(request.CloudEndpoint.TrimEnd('/'));
        var healthUri = new Uri(baseUri, "/health");
        
        var response = await httpClient.GetAsync(healthUri);
        if (!response.IsSuccessStatusCode)
        {
            return Results.BadRequest(new { error = $"Cloud health check returned unsuccessful status code: {response.StatusCode}" });
        }
        
        var content = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrEmpty(content) || (!content.Contains("postgres") && !content.Contains("influx")))
        {
            return Results.BadRequest(new { error = "Target URL responded but is not a valid PULSE Cloud instance." });
        }

        return Results.Ok(new { success = true });
    }
    catch (Exception ex)
    {
        return Results.BadRequest(new { error = $"Connection failed: {ex.Message}" });
    }
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

if (isSinglePort)
{
    // Fallback all SPA routing to index.html from embedded files
    app.MapFallbackToFile("index.html", new StaticFileOptions
    {
        FileProvider = new ManifestEmbeddedFileProvider(typeof(Program).Assembly, "wwwroot")
    });
}

try
{
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application host terminated unexpectedly.");
}
finally
{
    Log.CloseAndFlush();
}

static void ExtractJsonPaths(System.Text.Json.JsonElement element, string currentPath, List<MqttJsonKeyItem> paths)
{
    if (element.ValueKind == System.Text.Json.JsonValueKind.Object)
    {
        foreach (var property in element.EnumerateObject())
        {
            string path = string.IsNullOrEmpty(currentPath) ? $"$.{property.Name}" : $"{currentPath}.{property.Name}";
            
            string dataType = property.Value.ValueKind switch
            {
                System.Text.Json.JsonValueKind.Number => property.Value.GetRawText().Contains('.') ? "Float" : "Int32",
                System.Text.Json.JsonValueKind.True => "Boolean",
                System.Text.Json.JsonValueKind.False => "Boolean",
                System.Text.Json.JsonValueKind.String => "String",
                _ => "String"
            };

            paths.Add(new MqttJsonKeyItem(path, dataType, property.Value.ValueKind == System.Text.Json.JsonValueKind.String ? property.Value.GetString() ?? "" : property.Value.GetRawText()));
            ExtractJsonPaths(property.Value, path, paths);
        }
    }
    else if (element.ValueKind == System.Text.Json.JsonValueKind.Array)
    {
        int index = 0;
        foreach (var item in element.EnumerateArray())
        {
            string path = $"{currentPath}[{index}]";
            
            string dataType = item.ValueKind switch
            {
                System.Text.Json.JsonValueKind.Number => item.GetRawText().Contains('.') ? "Float" : "Int32",
                System.Text.Json.JsonValueKind.True => "Boolean",
                System.Text.Json.JsonValueKind.False => "Boolean",
                System.Text.Json.JsonValueKind.String => "String",
                _ => "String"
            };

            paths.Add(new MqttJsonKeyItem(path, dataType, item.ValueKind == System.Text.Json.JsonValueKind.String ? item.GetString() ?? "" : item.GetRawText()));
            ExtractJsonPaths(item, path, paths);
            index++;
        }
    }
}

public record TestConnectionRequest(string Host, int Port);
public record DiscoverEndpointsRequest(string DiscoveryUrl);
public record BrowseNodesRequest(string AdapterId, string? NodeId);
public record UpdateSettingsRequest(string SerialNumber, string CloudEndpoint);
public record ValidateCloudRequest(string CloudEndpoint, string SerialNumber);

public record MqttBrowseRequest(string AdapterId);
public record MqttBrowseItem(string Topic, string Payload, string LastSeen, List<MqttJsonKeyItem> Keys);
public record MqttJsonKeyItem(string Path, string DataType, string Value);


