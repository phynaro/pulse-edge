using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Services;
using System;
using System.Globalization;
using System.Threading.Tasks;

namespace Pulse.Edge.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/dashboard", async (QueueStorageService storageService) =>
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
                LastSync = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss UTC", CultureInfo.InvariantCulture),
                Device = new
                {
                    DeviceId = config?.Id ?? "Not Registered",
                    CloudEdgeId = config?.CloudEdgeId ?? "Not Registered",
                    SerialNumber = config?.SerialNumber ?? "N/A",
                    PairingToken = config?.PairingToken ?? "",
                    PairingShortCode = config?.PairingShortCode ?? "",
                    PairingExpiresAt = config?.PairingExpiresAt,
                    PairingBaseUrl = config?.PairingBaseUrl ?? "",
                    OrganizationId = config?.OrganizationId ?? "N/A",
                    OrganizationName = config?.OrganizationName ?? "N/A",
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

        routes.MapGet("/api/diagnostics", () =>
        {
            return Results.Ok(new
            {
                CpuUsage = $"{Random.Shared.Next(5, 18)}%",
                MemoryUsage = $"{Random.Shared.Next(84, 115)} MB",
                DiskSpace = "14.2 GB / 32 GB",
                Uptime = "02d:04h:12m"
            });
        });
    }
}
