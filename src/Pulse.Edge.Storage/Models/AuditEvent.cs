namespace Pulse.Edge.Storage.Models;

public class AuditEvent
{
    public long Id { get; set; }
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;
    public string EventType { get; set; } = string.Empty;
    public string ActorUsername { get; set; } = string.Empty;
    public string Target { get; set; } = string.Empty;
    public string RemoteIp { get; set; } = string.Empty;
    public bool Succeeded { get; set; }
}
