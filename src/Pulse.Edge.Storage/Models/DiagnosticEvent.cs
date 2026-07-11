namespace Pulse.Edge.Storage.Models;

public class DiagnosticEvent
{
    public long Id { get; set; }
    public DateTime TimestampUtc { get; set; }
    public string Level { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string EventCode { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Details { get; set; } = string.Empty;
    public string AdapterId { get; set; } = string.Empty;
    public string DataPointId { get; set; } = string.Empty;
    public string CorrelationId { get; set; } = string.Empty;
}
