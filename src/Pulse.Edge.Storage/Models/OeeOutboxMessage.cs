using System;

namespace Pulse.Edge.Storage.Models;

/// <summary>
/// Durable OEE outbox row. Deleted ONLY on a 202 acknowledgment (or terminal
/// "invalid message" rejection). Unique (ChannelId, Seq) mirrors the cloud dedup key.
/// </summary>
public class OeeOutboxMessage
{
    public int Id { get; set; }
    public int ChannelId { get; set; }
    public long Seq { get; set; }
    public string Type { get; set; } = string.Empty;   // "state" | "sync"
    public DateTime Ts { get; set; }                    // observation time, UTC
    public string State { get; set; } = string.Empty;  // "running" | "stopped" | "fault"
    public string? Code { get; set; }
    public long? GoodCount { get; set; }               // null = counters omitted on this message
    public long? RejectCount { get; set; }
    public bool IsSending { get; set; }
    public int RetryCount { get; set; }
    public DateTime CreatedAt { get; set; }
}
