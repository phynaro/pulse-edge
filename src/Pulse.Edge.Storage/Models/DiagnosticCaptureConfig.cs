namespace Pulse.Edge.Storage.Models;

public class DiagnosticCaptureConfig
{
    public int Id { get; set; } = 1;
    public bool IsEnabled { get; set; }
    public string AdapterId { get; set; } = string.Empty;
    public DateTime? StartedAtUtc { get; set; }
    public DateTime? ExpiresAtUtc { get; set; }
    public bool HasRotated { get; set; }
}
