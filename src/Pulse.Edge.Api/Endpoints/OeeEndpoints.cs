using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Api.Endpoints;

public static class OeeEndpoints
{
    public record OeeChannelRequest(
        string ExternalId,
        string Name,
        bool Enabled,
        string RunDataPointId,
        string? FaultDataPointId,
        string? CodeDataPointId,
        string? GoodDataPointId,
        string? RejectDataPointId,
        int DebounceSeconds);

    private static string? Validate(OeeChannelRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.ExternalId)) return "externalId is required.";
        if (string.IsNullOrWhiteSpace(req.Name)) return "name is required.";
        if (string.IsNullOrWhiteSpace(req.RunDataPointId)) return "runDataPointId is required.";
        if (req.DebounceSeconds is < 0 or > 60) return "debounceSeconds must be between 0 and 60.";
        if (!string.IsNullOrEmpty(req.RejectDataPointId) && string.IsNullOrEmpty(req.GoodDataPointId))
            return "rejectDataPointId requires goodDataPointId (counters capability is derived from the good counter).";
        return null;
    }

    public static void MapOeeEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/oee/channels", async (OeeStorageService oee) =>
            Results.Ok(await oee.GetChannelsAsync()));

        routes.MapPost("/api/oee/channels", async (OeeChannelRequest req, OeeStorageService oee) =>
        {
            var error = Validate(req);
            if (error != null) return Results.BadRequest(new { error });

            var existing = await oee.GetChannelsAsync();
            if (existing.Any(c => c.ExternalId == req.ExternalId))
                return Results.Conflict(new { error = $"A channel with externalId '{req.ExternalId}' already exists." });

            try
            {
                var channel = await oee.CreateChannelAsync(new OeeChannel
                {
                    ExternalId = req.ExternalId.Trim(),
                    Name = req.Name.Trim(),
                    Enabled = req.Enabled,
                    RunDataPointId = req.RunDataPointId,
                    FaultDataPointId = NullIfEmpty(req.FaultDataPointId),
                    CodeDataPointId = NullIfEmpty(req.CodeDataPointId),
                    GoodDataPointId = NullIfEmpty(req.GoodDataPointId),
                    RejectDataPointId = NullIfEmpty(req.RejectDataPointId),
                    DebounceSeconds = req.DebounceSeconds,
                });
                return Results.Created($"/api/oee/channels/{channel.Id}", channel);
            }
            catch (DbUpdateException)
            {
                // Handle concurrent create race: a concurrent request won the unique index on ExternalId.
                // The pre-check above covers the common case; this catch is the authority when DB-level enforcement fires.
                return Results.Conflict(new { error = $"A channel with externalId '{req.ExternalId}' already exists." });
            }
        });

        routes.MapPut("/api/oee/channels/{id}", async (int id, OeeChannelRequest req, OeeStorageService oee) =>
        {
            var error = Validate(req);
            if (error != null) return Results.BadRequest(new { error });

            var existing = await oee.GetChannelAsync(id);
            if (existing == null) return Results.NotFound();

            // Contract §2.1: externalId is the channel's identity, stable forever.
            // Changing it would orphan cloud-side history — enforce immutability here,
            // the only place it could be broken.
            if (!string.Equals(existing.ExternalId, req.ExternalId, StringComparison.Ordinal))
                return Results.BadRequest(new { error = "externalId is immutable. Delete the channel and create a new one for a different machine identity." });

            existing.Name = req.Name.Trim();
            existing.Enabled = req.Enabled;
            existing.RunDataPointId = req.RunDataPointId;
            existing.FaultDataPointId = NullIfEmpty(req.FaultDataPointId);
            existing.CodeDataPointId = NullIfEmpty(req.CodeDataPointId);
            existing.GoodDataPointId = NullIfEmpty(req.GoodDataPointId);
            existing.RejectDataPointId = NullIfEmpty(req.RejectDataPointId);
            existing.DebounceSeconds = req.DebounceSeconds;

            return await oee.UpdateChannelAsync(existing) ? Results.Ok(existing) : Results.NotFound();
        });

        routes.MapDelete("/api/oee/channels/{id}", async (int id, OeeStorageService oee) =>
            await oee.DeleteChannelAsync(id) ? Results.Ok() : Results.NotFound());

        routes.MapGet("/api/oee/status", async (OeeStorageService oee) =>
        {
            var channels = await oee.GetChannelsAsync();
            using var db = new QueueDbContext();
            var pendingByChannel = await db.OeeOutboxMessages
                .GroupBy(m => m.ChannelId)
                .Select(g => new { ChannelId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.ChannelId, x => x.Count);

            return Results.Ok(new
            {
                Channels = channels.Select(c => new
                {
                    c.Id,
                    c.ExternalId,
                    c.Name,
                    c.Enabled,
                    c.LastState,
                    c.LastCode,
                    c.LastStateChangedAt,
                    c.NextSeq,
                    PendingCount = pendingByChannel.GetValueOrDefault(c.Id),
                }),
                OutboxDepth = pendingByChannel.Values.Sum(),
            });
        });

        routes.MapGet("/api/oee/outbox", async (OeeStorageService oee) =>
            Results.Ok(await oee.GetRecentOutboxAsync(50)));
    }

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;
}
