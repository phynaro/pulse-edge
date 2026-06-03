using System;

namespace Pulse.Edge.Storage.Models;

public class QueueTelemetry
{
    public int Id { get; set; }
    public string DataSourceId { get; set; } = string.Empty; // e.g., CasePacker_Temp
    public string PayloadJson { get; set; } = string.Empty; // Serialized JSON payload
    public DateTime Timestamp { get; set; }
    public int RetryCount { get; set; }
    public bool IsSending { get; set; }
}
