using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Pulse.Edge.Agent;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;

namespace Pulse.Edge.Api.Endpoints;

public static class SettingsEndpoints
{
    public static void MapSettingsEndpoints(this IEndpointRouteBuilder routes)
    {
        // GET /api/settings/sync-status - Returns sync status flag from SQLite
        routes.MapGet("/api/settings/sync-status", async () =>
        {
            using var db = new QueueDbContext();
            var config = await db.DeviceConfigs.FirstOrDefaultAsync();
            return Results.Ok(new { isSyncEnabled = config?.IsSyncEnabled ?? true });
        });

        // POST /api/settings/toggle-sync - Toggles sync status flag in SQLite
        routes.MapPost("/api/settings/toggle-sync", async (HttpContext context) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();

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
        routes.MapGet("/api/settings", async () =>
        {
            using var db = new QueueDbContext();
            var config = await db.DeviceConfigs.FirstOrDefaultAsync();
            return Results.Ok(new
            {
                SerialNumber = config?.SerialNumber ?? "",
                CloudEndpoint = config?.CloudEndpoint ?? "http://localhost:3000",
                ApiKey = string.IsNullOrEmpty(config?.ApiKey) ? "None" : "••••••••",
                HasApiKey = !string.IsNullOrEmpty(config?.ApiKey)
            });
        });

        // POST /api/settings - Saves updated DeviceConfig (Cloud Endpoint, Serial Number) to SQLite database
        routes.MapPost("/api/settings", async (UpdateSettingsRequest request, IEnumerable<IHostedService> hostedServices) =>
        {
            if (!Pulse.Edge.Cloud.Services.CloudClient.IsAcceptableCloudEndpoint(request.CloudEndpoint))
                return Results.BadRequest(new { error = "Cloud endpoint must use https:// (localhost may use http)." });

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
                    PairingToken = generateClaimSecret(),
                    SerialNumber = request.SerialNumber,
                    CloudEndpoint = request.CloudEndpoint,
                    ApiKey = "",
                    SiteId = "",
                    SiteName = "",
                    OrganizationId = "",
                    OrganizationName = "",
                    PairingShortCode = "",
                    PairingExpiresAt = null,
                    PairingBaseUrl = "",
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
                    config.OrganizationId = "";
                    config.OrganizationName = "";
                    config.PairingShortCode = "";
                    config.PairingExpiresAt = null;
                    config.PairingBaseUrl = "";
                    config.CloudStatus = "PendingApproval";
                }
                
                if (string.IsNullOrEmpty(config.ClaimSecret))
                {
                    config.ClaimSecret = generateClaimSecret();
                }
                if (string.IsNullOrEmpty(config.PairingToken))
                {
                    config.PairingToken = generateClaimSecret();
                }
                db.DeviceConfigs.Update(config);
            }
            await db.SaveChangesAsync();
            
            var worker = hostedServices.OfType<Worker>().FirstOrDefault();
            worker?.WakeUpProvisioning();

            return Results.Ok(new { config.SerialNumber, config.CloudEndpoint, config.CloudStatus });
        });

        // POST /api/settings/factory-reset - Deletes all configurations and resets the edge agent to factory settings
        routes.MapPost("/api/settings/factory-reset", async (IEnumerable<IHostedService> hostedServices, HttpContext context) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();

            using var db = new QueueDbContext();
            try
            {
                await db.Database.ExecuteSqlRawAsync("DELETE FROM DeviceConfigs;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM OeeOutboxMessages;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM QueueTelemetry;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM DriverAdapters;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM DataSources;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM DataPoints;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM MqttDevices;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM StreamTemplates;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM MqttSeenTopics;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM AuditEvents;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM LocalUsers;");
                await db.Database.ExecuteSqlRawAsync("DELETE FROM DiagnosticEvents;");
                
                await db.SaveChangesAsync();

                var worker = hostedServices.OfType<Worker>().FirstOrDefault();
                worker?.WakeUpProvisioning();

                await context.SignOutAsync();

                return Results.Ok(new { success = true, message = "System configuration has been reset to factory default." });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = $"Failed to factory reset: {ex.Message}" });
            }
        });

        // POST /api/settings/soft-reset - Resets the cloud pairing credentials but preserves local configurations
        routes.MapPost("/api/settings/soft-reset", async (IEnumerable<IHostedService> hostedServices, HttpContext context) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();

            using var db = new QueueDbContext();
            try
            {
                var config = await db.DeviceConfigs.FirstOrDefaultAsync();
                if (config != null)
                {
                    string generateClaimSecret()
                    {
                        var secretBytes = new byte[24];
                        using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create())
                        {
                            rng.GetBytes(secretBytes);
                        }
                        return Convert.ToHexString(secretBytes).ToLowerInvariant();
                    }

                    // Generate a new hardware identity (DeviceId UUID and raw secret) so it registers as a new entity in the new organization.
                    config.Id = Guid.NewGuid().ToString();
                    config.ClaimSecret = generateClaimSecret();
                    config.PairingToken = generateClaimSecret();
                    
                    // Clear all cloud association fields
                    config.CloudEdgeId = "";
                    config.ApiKey = "";
                    config.OrganizationId = "";
                    config.OrganizationName = "";
                    config.SiteId = "";
                    config.SiteName = "";
                    config.PairingShortCode = "";
                    config.PairingExpiresAt = null;
                    config.PairingBaseUrl = "";
                    config.CloudStatus = "PendingApproval";

                    db.DeviceConfigs.Update(config);
                    await db.SaveChangesAsync();
                }

                var worker = hostedServices.OfType<Worker>().FirstOrDefault();
                worker?.WakeUpProvisioning();

                return Results.Ok(new { success = true, message = "System configuration has been soft reset. Cloud pairing cleared, local driver configurations preserved." });
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { error = $"Failed to soft reset: {ex.Message}" });
            }
        });

        // POST /api/settings/validate-cloud - Validates Cloud URL sync registration
        routes.MapPost("/api/settings/validate-cloud", async (ValidateCloudRequest request, CloudClient cloudClient) =>
        {
            if (string.IsNullOrWhiteSpace(request.CloudEndpoint))
            {
                return Results.BadRequest(new { error = "Cloud target URL cannot be empty." });
            }

            if (!Pulse.Edge.Cloud.Services.CloudClient.IsAcceptableCloudEndpoint(request.CloudEndpoint))
            {
                return Results.BadRequest(new { error = "Cloud endpoint must use https:// (localhost may use http)." });
            }

            try
            {
                using var httpClient = new HttpClient();
                httpClient.Timeout = TimeSpan.FromSeconds(5);
                
                var baseEndpoint = request.CloudEndpoint.TrimEnd('/');
                var healthUri = new Uri($"{baseEndpoint}/health");
                
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
    }
}

// Request models local to SettingsEndpoints
public record UpdateSettingsRequest(string SerialNumber, string CloudEndpoint);
public record ValidateCloudRequest(string CloudEndpoint, string SerialNumber);
