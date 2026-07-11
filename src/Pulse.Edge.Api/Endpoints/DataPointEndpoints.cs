using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Agent.Drivers;
using Pulse.Edge.Agent.Services;
using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;

namespace Pulse.Edge.Api.Endpoints;

public static class DataPointEndpoints
{
    public static void MapDataPointEndpoints(this IEndpointRouteBuilder routes)
    {
        // GET /api/datapoints - Returns configured data points
        routes.MapGet("/api/datapoints", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.DataPoints.ToListAsync();
            return Results.Ok(list);
        });

        // POST /api/datapoints - Updates or inserts a data point mapping
        routes.MapPost("/api/datapoints", async (DataPoint updated) =>
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
        routes.MapDelete("/api/datapoints/{id}", async (string id) =>
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
        routes.MapDelete("/api/datapoints/hard/{id}", async (string id) =>
        {
            using var db = new QueueDbContext();
            var existing = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == id);
            if (existing == null) return Results.NotFound();
            
            db.DataPoints.Remove(existing);
            await db.SaveChangesAsync();
            return Results.Ok(new { success = true });
        });

        // POST /api/datapoints/bulk-bind - Binds multiple physical data point tags to metrics in bulk
        routes.MapPost("/api/datapoints/bulk-bind", async (BulkBindRequest request) =>
        {
            using var db = new QueueDbContext();
            
            // Unbind old mappings for the same stream and metric keys to avoid conflicts
            var metricsToBind = request.Bindings.Select(b => b.Metric).ToList();
            var existingBound = await db.DataPoints
                .Where(x => x.DataSourceId == request.DataSourceId && metricsToBind.Contains(x.Metric))
                .ToListAsync();
                
            foreach (var oldDp in existingBound)
            {
                if (!request.Bindings.Any(b => b.DataPointId == oldDp.Id))
                {
                    oldDp.DataSourceId = string.Empty;
                    oldDp.Metric = string.Empty;
                    db.DataPoints.Update(oldDp);
                }
            }
            
            // Apply new bindings
            foreach (var binding in request.Bindings)
            {
                var dp = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == binding.DataPointId);
                if (dp != null)
                {
                    dp.DataSourceId = request.DataSourceId;
                    dp.Metric = binding.Metric;
                    db.DataPoints.Update(dp);
                }
            }
            
            await db.SaveChangesAsync();
            return Results.Ok(new { success = true });
        });

        // GET /api/mqtt-devices - Returns configured MQTT devices
        routes.MapGet("/api/mqtt-devices", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.MqttDevices.ToListAsync();
            return Results.Ok(list);
        });

        // POST /api/mqtt-devices - Updates or inserts an MQTT device
        routes.MapPost("/api/mqtt-devices", async (MqttDevice updated) =>
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
        routes.MapDelete("/api/mqtt-devices/{id}", async (string id) =>
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

        // POST /api/datapoints/poll/{id} - Force-polls a tag directly from its driver for diagnostics
        routes.MapPost("/api/datapoints/poll/{id}", async (string id, IServiceProvider serviceProvider) =>
        {
            var pollerRegistry = serviceProvider.GetService<DriverPollerRegistry>();
            var configMonitor = serviceProvider.GetService<EdgeConfigMonitor>();

            using var db = new QueueDbContext();
            var dp = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == id);
            if (dp == null) return Results.NotFound("DataPoint not found.");

            if (pollerRegistry == null || configMonitor == null)
            {
                // Multi-process mode: trigger a poll by setting LastUpdated = null in the DB
                var originalUpdated = dp.LastUpdated;
                dp.LastUpdated = null;
                dp.LastValue = null;
                db.DataPoints.Update(dp);
                await db.SaveChangesAsync();

                // Wait for the background agent to poll the tag (up to 4 seconds)
                var waitStart = DateTime.UtcNow;
                DataPoint? updatedDp = null;
                while ((DateTime.UtcNow - waitStart).TotalSeconds < 4.0)
                {
                    await Task.Delay(150);
                    using var tempDb = new QueueDbContext();
                    updatedDp = await tempDb.DataPoints.FirstOrDefaultAsync(x => x.Id == id);
                    if (updatedDp != null && updatedDp.LastUpdated != null && updatedDp.LastUpdated != originalUpdated)
                    {
                        break;
                    }
                }

                if (updatedDp != null && updatedDp.LastUpdated != null)
                {
                    var latency = updatedDp.LastLatencyMs ?? (updatedDp.LastUpdated.Value - waitStart).TotalMilliseconds;
                    if (latency < 0) latency = 0;
                    return Results.Ok(new
                    {
                        success = string.IsNullOrEmpty(updatedDp.LastError),
                        value = updatedDp.LastValue,
                        error = updatedDp.LastError,
                        latencyMs = Math.Round(latency, 1),
                        lastUpdated = updatedDp.LastUpdated,
                        consecutiveFailures = updatedDp.ConsecutiveFailures,
                        isCached = false
                    });
                }

                return Results.Ok(new
                {
                    success = string.IsNullOrEmpty(dp.LastError),
                    value = dp.LastValue,
                    error = dp.LastError,
                    latencyMs = 0.0,
                    lastUpdated = dp.LastUpdated,
                    consecutiveFailures = dp.ConsecutiveFailures,
                    isCached = true
                });
            }

            var adapter = configMonitor.CurrentAdapters.FirstOrDefault(a => a.Id == dp.AdapterId);
            if (adapter == null) return Results.BadRequest("Adapter not found or is disabled.");

            var poller = pollerRegistry.GetPoller(adapter.Id, adapter.Protocol);
            if (poller == null) return Results.BadRequest("Poller driver not found.");

            if (!poller.IsConnected)
            {
                return Results.Json(new { success = false, error = "Driver is disconnected or offline." }, statusCode: 503);
            }

            // Create a temporary clone with LastUpdated = null to bypass driver scan rate check
            var testDp = new DataPoint
            {
                Id = dp.Id,
                AdapterId = dp.AdapterId,
                DataSourceId = dp.DataSourceId,
                Metric = dp.Metric,
                Address = dp.Address,
                DataType = dp.DataType,
                ScanIntervalMs = dp.ScanIntervalMs,
                ScaleFactor = dp.ScaleFactor,
                Offset = dp.Offset,
                IsEnabled = dp.IsEnabled,
                ByteOrder = dp.ByteOrder,
                Description = dp.Description,
                MqttDeviceId = dp.MqttDeviceId,
                MqttParseMode = dp.MqttParseMode,
                MqttJsonPath = dp.MqttJsonPath,
                LastValue = dp.LastValue,
                LastError = dp.LastError,
                LastUpdated = null, // Set null to force bypass filter check
                ConsecutiveFailures = dp.ConsecutiveFailures
            };

            var startTime = DateTime.UtcNow;
            var list = new System.Collections.Generic.List<DataPoint> { testDp };
            var dirtyDps = new System.Collections.Generic.List<DataPoint>();
            
            try
            {
                await poller.PollGroupAsync(list, adapter, DateTime.UtcNow, dirtyDps, CancellationToken.None);
                var elapsed = (DateTime.UtcNow - startTime).TotalMilliseconds;

                var resultDp = dirtyDps.FirstOrDefault() ?? testDp;

                // Persist the updated values immediately
                var dbEntry = await db.DataPoints.FirstOrDefaultAsync(x => x.Id == dp.Id);
                if (dbEntry != null)
                {
                    dbEntry.LastValue = resultDp.LastValue;
                    dbEntry.LastError = resultDp.LastError;
                    dbEntry.LastUpdated = resultDp.LastUpdated ?? DateTime.UtcNow;
                    dbEntry.LastLatencyMs = elapsed;
                    dbEntry.ConsecutiveFailures = resultDp.ConsecutiveFailures;
                    db.DataPoints.Update(dbEntry);
                    await db.SaveChangesAsync();
                }
                
                return Results.Ok(new
                {
                    success = string.IsNullOrEmpty(resultDp.LastError),
                    value = resultDp.LastValue,
                    error = resultDp.LastError,
                    latencyMs = Math.Round(elapsed, 1),
                    lastUpdated = resultDp.LastUpdated,
                    consecutiveFailures = resultDp.ConsecutiveFailures,
                    isCached = false
                });
            }
            catch (Exception ex)
            {
                return Results.Ok(new
                {
                    success = false,
                    value = (string?)null,
                    error = ex.Message,
                    latencyMs = Math.Round((DateTime.UtcNow - startTime).TotalMilliseconds, 1),
                    lastUpdated = DateTime.UtcNow,
                    isCached = false
                });
            }
        });
    }
}

public class BulkBindRequest
{
    public string DataSourceId { get; set; } = string.Empty;
    public System.Collections.Generic.List<DataPointBinding> Bindings { get; set; } = new();
}

public class DataPointBinding
{
    public string DataPointId { get; set; } = string.Empty;
    public string Metric { get; set; } = string.Empty;
}
