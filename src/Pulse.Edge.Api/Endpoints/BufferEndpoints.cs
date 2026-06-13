using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using System.Linq;
using System.Threading.Tasks;

namespace Pulse.Edge.Api.Endpoints;

public static class BufferEndpoints
{
    public static void MapBufferEndpoints(this IEndpointRouteBuilder routes)
    {
        // GET /api/buffer/telemetry - Returns list of currently enqueued telemetry records in SQLite
        routes.MapGet("/api/buffer/telemetry", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.QueueTelemetry
                .OrderByDescending(x => x.Timestamp)
                .Take(50)
                .ToListAsync();
            return Results.Ok(list);
        });

        // GET /api/buffer/events - Returns list of currently enqueued event records in SQLite
        routes.MapGet("/api/buffer/events", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.QueueEvents
                .OrderByDescending(x => x.Timestamp)
                .Take(50)
                .ToListAsync();
            return Results.Ok(list);
        });
    }
}
