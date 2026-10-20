using System;
using System.Linq;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Edge.Agent.Simulation;

namespace Pulse.Edge.Api.Endpoints;

public static class SimulatorEndpoints
{
    public record TriggerEventRequest(string? EventId);

    public static void MapSimulatorEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/simulator/scenarios", () =>
            ScenarioCatalog.Ids().Select(ScenarioCatalog.Load).Select(s => new
            {
                id = s.Id,
                name = s.Name,
                units = s.Units.Select(u => new { id = u.Id, kind = u.Kind, signals = ScenarioCatalog.SignalsOf(u).ToArray() }),
                events = s.Events.Select(e => new { id = e.Id, unit = e.Unit, durationMinutes = e.DurationMinutes })
            }));

        app.MapGet("/api/simulator/scenarios/{id}/status", (string id, IServiceProvider sp) =>
        {
            if (!ScenarioCatalog.Ids().Contains(id)) return Results.NotFound(new { error = "Unknown scenario." });
            var engine = sp.GetService<ScenarioEngine>();
            if (engine is null)
                return Results.Json(new { error = "Scenario status is available in single-port mode only." }, statusCode: StatusCodes.Status503ServiceUnavailable);
            return Results.Ok(engine.Status(id, DateTime.UtcNow));
        });

        app.MapPost("/api/simulator/scenarios/{id}/events", (string id, TriggerEventRequest req, ScenarioStateStore store) =>
        {
            if (!ScenarioCatalog.Ids().Contains(id)) return Results.NotFound(new { error = "Unknown scenario." });
            var def = ScenarioCatalog.Load(id);
            if (string.IsNullOrWhiteSpace(req.EventId) || !def.Events.Any(e => e.Id == req.EventId))
                return Results.NotFound(new { error = "Unknown event." });
            store.RequestEvent(id, req.EventId, DateTime.UtcNow);
            return Results.Accepted(value: new { accepted = true, eventId = req.EventId });
        });
    }
}
