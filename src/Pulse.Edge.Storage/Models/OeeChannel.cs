using System;

namespace Pulse.Edge.Storage.Models;

/// <summary>
/// One monitored machine for OEE ingestion. ExternalId is the contract identity
/// (know-how/cloud_oee_ingestion.md §2) — stable forever; the API refuses to change it.
/// NextSeq is the persistent per-channel sequence counter; it is only ever incremented,
/// inside the same transaction that inserts the outbox row (never reset, never reused).
/// </summary>
public class OeeChannel
{
    public int Id { get; set; }
    public string ExternalId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;

    // Role bindings reference DataPoint.Id (string UUID). Run is required; the rest optional.
    public string RunDataPointId { get; set; } = string.Empty;
    public string? FaultDataPointId { get; set; }
    public string? CodeDataPointId { get; set; }
    public string? GoodDataPointId { get; set; }   // binding this derives the "counters" capability
    public string? RejectDataPointId { get; set; }

    public int DebounceSeconds { get; set; } = 2;
    public long NextSeq { get; set; }

    // Live-state snapshot for the UI/status endpoint (works across processes in MultiPort mode).
    public string? LastState { get; set; }
    public DateTime? LastStateChangedAt { get; set; }
    public string? LastCode { get; set; }

    // Bumped on every create/update; OeeSyncService re-declares when it sees a newer stamp.
    public DateTime UpdatedAt { get; set; }
}
