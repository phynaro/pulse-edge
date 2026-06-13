using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using System.Linq;
using System.Threading.Tasks;

namespace Pulse.Edge.Api.Endpoints;

public static class DataSourceEndpoints
{
    public static void MapDataSourceEndpoints(this IEndpointRouteBuilder routes)
    {
        // GET /api/datasources - Returns logical data sources from database
        routes.MapGet("/api/datasources", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.DataSources.ToListAsync();
            return Results.Ok(list);
        });

        // POST /api/datasources - Updates or inserts a logical data source
        routes.MapPost("/api/datasources", async (DataSource updated, bool? create) =>
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
        routes.MapDelete("/api/datasources/{id}", async (string id) =>
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
        routes.MapGet("/api/stream-templates", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.StreamTemplates.ToListAsync();
            return Results.Ok(list);
        });

        // POST /api/stream-templates - Creates or updates a stream template
        routes.MapPost("/api/stream-templates", async (StreamTemplate updated) =>
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
        routes.MapDelete("/api/stream-templates/{id}", async (string id) =>
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
    }
}
