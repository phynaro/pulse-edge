using System;

namespace Pulse.Edge.Storage.Models;

public class MqttDevice
{
    public string Id { get; set; } = string.Empty; // Primary Key (UUID)
    public string AdapterId { get; set; } = string.Empty; // Foreign Key to DriverAdapter
    public string Name { get; set; } = string.Empty; // e.g. "Packer 01"
    public string TopicSubscription { get; set; } = string.Empty; // e.g. "tele/packer01/SENSOR" or "tele/packer01/#"
    public string MqttParseMode { get; set; } = "JSON"; // "Plaintext" or "JSON"
    public bool IsEnabled { get; set; } = true;

    // Last Will and Testament (LWT) configurations for health tracking
    public string? LwtTopic { get; set; } // e.g. "tele/packer01/LWT"
    public string LwtOnlinePayload { get; set; } = "Online";
    public string LwtOfflinePayload { get; set; } = "Offline";

    // Health / Session Management
    public string Status { get; set; } = "Disconnected"; // "Connected", "Offline", "Error"
    public string? LastError { get; set; }
    public DateTime? LastUpdated { get; set; }
    public int ConsecutiveFailures { get; set; } = 0;
}
