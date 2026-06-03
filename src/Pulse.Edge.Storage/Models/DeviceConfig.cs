using System;

namespace Pulse.Edge.Storage.Models;

public class DeviceConfig
{
    public string Id { get; set; } = string.Empty; // Store UUID as string
    public string SerialNumber { get; set; } = string.Empty;
    public string SiteId { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public string Version { get; set; } = "1.0.0";
    public bool IsSyncEnabled { get; set; } = true; // Flag to toggle cloud sync on/off
}
