using System;

namespace Pulse.Edge.Storage.Models;

public class QueueEvent
{
    public int Id { get; set; }
    public string EventType { get; set; } = string.Empty; // e.g., ProductionCount, Downtime, Alarm
    public string PayloadJson { get; set; } = string.Empty; // Serialized JSON payload
    public DateTime Timestamp { get; set; }
    public int RetryCount { get; set; }
    public bool IsSending { get; set; }
}
