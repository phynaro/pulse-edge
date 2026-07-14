using System.Text.Json;
using Pulse.Edge.Api.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Api.Endpoints;

public static class BackupEndpoints
{
    // The restore body size cap (RestoreBodySizeLimitMiddleware.MaxRestoreBodyBytes) is enforced
    // by middleware ahead of routing, before Minimal API model binding ever deserializes the
    // request body -- see that class for why an in-handler ContentLength check alone isn't
    // enough (it doesn't run early enough, and misses chunked requests with no Content-Length).

    public static void MapBackupEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/backups/configuration", async (ConfigurationBackupService backups, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();
            var document = await backups.CreateAsync(cancellationToken);
            await AuditAsync(context, "ConfigurationBackupCreated", true, cancellationToken);
            var serial = SafeFilePart(document.SourceSerialNumber);
            var fileName = $"pulse-edge-{serial}-{DateTime.UtcNow:yyyyMMdd-HHmmss}.pulsebackup.json";
            return Results.File(backups.Serialize(document), "application/json", fileName);
        }).RequireAuthorization();

        routes.MapPost("/api/restores/configuration/inspect", (ConfigurationBackupDocument document, ConfigurationBackupService backups, HttpContext context) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();

            var inspection = backups.Inspect(document);
            return inspection.IsValid ? Results.Ok(inspection) : Results.BadRequest(inspection);
        }).RequireAuthorization();

        routes.MapPost("/api/restores/configuration/apply", async (ConfigurationBackupDocument document, ConfigurationBackupService backups, HttpContext context, CancellationToken cancellationToken) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();

            var inspection = backups.Inspect(document);
            if (!inspection.IsValid)
            {
                await AuditAsync(context, "ConfigurationRestore", false, cancellationToken);
                return Results.BadRequest(inspection);
            }

            try
            {
                await backups.RestoreAsync(document, cancellationToken);
                await AuditAsync(context, "ConfigurationRestore", true, cancellationToken);
                return Results.Ok(new { success = true, message = "Local configuration restored. Device identity and cloud pairing were preserved.", inspection.Counts });
            }
            catch
            {
                await AuditAsync(context, "ConfigurationRestore", false, cancellationToken);
                throw;
            }
        }).RequireAuthorization();
    }

    private static string SafeFilePart(string value)
    {
        var safe = string.Concat(value.Where(x => char.IsLetterOrDigit(x) || x is '-' or '_'));
        return string.IsNullOrEmpty(safe) ? "unregistered" : safe[..Math.Min(48, safe.Length)];
    }

    private static async Task AuditAsync(HttpContext context, string eventType, bool succeeded, CancellationToken cancellationToken)
    {
        await using var db = new QueueDbContext();
        db.AuditEvents.Add(new AuditEvent
        {
            EventType = eventType,
            ActorUsername = context.User.Identity?.Name ?? "unknown",
            Target = "LocalConfiguration",
            RemoteIp = context.Connection.RemoteIpAddress?.ToString() ?? "",
            Succeeded = succeeded
        });
        await db.SaveChangesAsync(cancellationToken);
    }
}
