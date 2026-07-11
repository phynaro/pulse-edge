using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Diagnostics;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Helpers;
using Pulse.Edge.Storage.Models;
using System.Security.Cryptography;
using System.Text;

namespace Pulse.Edge.Api.Endpoints;

public static class DiagnosticLogEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public static void MapDiagnosticLogEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/api/diagnostic-logs/ingest", async (HttpContext context, DiagnosticLogService logs, List<ForwardedDiagnostic> entries) =>
        {
            if (context.Connection.RemoteIpAddress == null || !System.Net.IPAddress.IsLoopback(context.Connection.RemoteIpAddress)) return Results.NotFound();
            var supplied = context.Request.Headers["X-Pulse-Diagnostic-Key"].ToString();
            var expected = DiagnosticBridgeKey.LoadOrCreate();
            if (supplied.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(expected))) return Results.NotFound();
            using var db = new QueueDbContext();
            var capture = await db.DiagnosticCaptureConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == 1);
            var captureActive = capture is { IsEnabled: true, ExpiresAtUtc: not null } && capture.ExpiresAtUtc > DateTime.UtcNow;
            foreach (var entry in entries.Take(200))
            {
                var allowDebug = captureActive && entry.Level == "Debug" && !string.IsNullOrWhiteSpace(entry.AdapterId) &&
                    (string.IsNullOrWhiteSpace(capture!.AdapterId) || capture.AdapterId == entry.AdapterId);
                logs.Ingest(entry, allowDebug);
            }
            return Results.Accepted();
        });

        routes.MapGet("/api/diagnostic-logs/debug-capture", async () =>
        {
            using var db = new QueueDbContext();
            var capture = await db.DiagnosticCaptureConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == 1);
            var now = DateTime.UtcNow;
            var active = capture is { IsEnabled: true, ExpiresAtUtc: not null } && capture.ExpiresAtUtc > now;
            var entryCount = await db.DiagnosticEvents.CountAsync(x => x.Level == "Debug" && x.TimestampUtc >= now.AddHours(-24));
            var adapterName = string.Empty;
            if (!string.IsNullOrWhiteSpace(capture?.AdapterId))
                adapterName = await db.DriverAdapters.Where(x => x.Id == capture.AdapterId).Select(x => x.Name).FirstOrDefaultAsync() ?? capture.AdapterId;
            return Results.Ok(new
            {
                isActive = active,
                adapterId = capture?.AdapterId ?? "",
                adapterName,
                startedAtUtc = AsUtc(capture?.StartedAtUtc),
                expiresAtUtc = AsUtc(capture?.ExpiresAtUtc),
                remainingSeconds = active ? Math.Max(0, (int)Math.Ceiling((capture!.ExpiresAtUtc!.Value - now).TotalSeconds)) : 0,
                entryCount,
                hasRotated = capture?.HasRotated ?? false
            });
        });

        routes.MapPost("/api/diagnostic-logs/debug-capture", async (StartDebugCaptureRequest request, DiagnosticLogService logs) =>
        {
            if (request.DurationMinutes is not (5 or 15 or 30))
                return Results.BadRequest(new { message = "Duration must be 5, 15, or 30 minutes." });
            using var db = new QueueDbContext();
            var adapterId = request.AdapterId?.Trim() ?? "";
            var adapterName = "all adapters";
            if (!string.IsNullOrEmpty(adapterId))
            {
                var adapter = await db.DriverAdapters.AsNoTracking().FirstOrDefaultAsync(x => x.Id == adapterId);
                if (adapter == null) return Results.BadRequest(new { message = "The selected adapter does not exist." });
                adapterName = adapter.Name;
            }
            var capture = await db.DiagnosticCaptureConfigs.FirstOrDefaultAsync(x => x.Id == 1) ?? new DiagnosticCaptureConfig { Id = 1 };
            var now = DateTime.UtcNow;
            capture.IsEnabled = true;
            capture.AdapterId = adapterId;
            capture.StartedAtUtc = now;
            capture.ExpiresAtUtc = now.AddMinutes(request.DurationMinutes);
            capture.HasRotated = false;
            if (db.Entry(capture).State == EntityState.Detached) db.DiagnosticCaptureConfigs.Add(capture);
            await db.SaveChangesAsync();
            logs.AddLifecycle($"Debug capture started for {adapterName}; duration {request.DurationMinutes} minutes.");
            return Results.Ok(new { success = true });
        });

        routes.MapDelete("/api/diagnostic-logs/debug-capture", async (DiagnosticLogService logs) =>
        {
            using var db = new QueueDbContext();
            var capture = await db.DiagnosticCaptureConfigs.FirstOrDefaultAsync(x => x.Id == 1);
            if (capture != null && capture.IsEnabled)
            {
                capture.IsEnabled = false;
                await db.SaveChangesAsync();
                logs.AddLifecycle("Debug capture stopped by an administrator.");
            }
            return Results.NoContent();
        });

        routes.MapGet("/api/diagnostic-logs/recent", (DiagnosticLogService logs, int? limit, string? level, string? category, string? search) =>
            Results.Ok(logs.Recent(limit ?? 300, level, category, search)));

        routes.MapGet("/api/diagnostic-logs/history", async (int? page, int? pageSize, string? level, string? category, string? search) =>
        {
            using var db = new QueueDbContext();
            var query = db.DiagnosticEvents.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(level)) query = query.Where(x => x.Level == level);
            if (!string.IsNullOrWhiteSpace(category)) query = query.Where(x => x.Category.Contains(category));
            if (!string.IsNullOrWhiteSpace(search)) query = query.Where(x => x.Message.Contains(search) || x.Details.Contains(search));
            var safePage = Math.Max(1, page ?? 1);
            var safeSize = Math.Clamp(pageSize ?? 100, 1, 250);
            var total = await query.CountAsync();
            var items = await query.OrderByDescending(x => x.TimestampUtc).Skip((safePage - 1) * safeSize).Take(safeSize).ToListAsync();
            return Results.Ok(new { items, total, page = safePage, pageSize = safeSize });
        });

        routes.MapGet("/api/diagnostic-logs/stream", async (HttpContext context, DiagnosticLogService logs) =>
        {
            context.Response.Headers.CacheControl = "no-cache";
            context.Response.Headers.Connection = "keep-alive";
            context.Response.ContentType = "text/event-stream";
            var subscription = logs.Subscribe();
            try
            {
                await context.Response.WriteAsync(": connected\n\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
                await foreach (var entry in subscription.Reader.ReadAllAsync(context.RequestAborted))
                {
                    await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(entry, JsonOptions)}\n\n", context.RequestAborted);
                    await context.Response.Body.FlushAsync(context.RequestAborted);
                }
            }
            catch (OperationCanceledException) { }
            finally { logs.Unsubscribe(subscription.Id); }
        });

        routes.MapDelete("/api/diagnostic-logs", async (DiagnosticLogService logs) =>
        {
            using var db = new QueueDbContext();
            await db.DiagnosticEvents.ExecuteDeleteAsync();
            await db.DiagnosticCaptureConfigs.Where(x => x.Id == 1).ExecuteUpdateAsync(x => x.SetProperty(c => c.HasRotated, false));
            logs.ClearMemory();
            return Results.NoContent();
        });
    }

    private static DateTime? AsUtc(DateTime? value) => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : null;
}

public record StartDebugCaptureRequest(int DurationMinutes, string? AdapterId);
