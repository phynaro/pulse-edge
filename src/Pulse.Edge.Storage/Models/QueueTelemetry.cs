using System;

namespace Pulse.Edge.Storage.Models;

public class QueueTelemetry
{
    public int Id { get; set; }
    public string DataSourceId { get; set; } = string.Empty;  // e.g. "DS001"
    public DateTime Timestamp { get; set; }                    // Poll-tick UTC timestamp (ms precision)
    public string MetricsJson { get; set; } = "{}";           // e.g. {"temperature":85.3,"good_count":142}
    public int RetryCount { get; set; }
    public bool IsSending { get; set; }
}
