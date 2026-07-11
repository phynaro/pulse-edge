using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Diagnostics;
using Pulse.Edge.Storage;

namespace Pulse.Edge.Api.Endpoints;

public static class DiagnosticLogEndpoints
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    public static void MapDiagnosticLogEndpoints(this IEndpointRouteBuilder routes)
    {
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
            logs.ClearMemory();
            return Results.NoContent();
        });
    }
}
