using System;

namespace Pulse.Edge.Storage.Models;

public class DriverAdapter
{
    public string Id { get; set; } = string.Empty; // Primary Key (e.g. "adp-opcua-1")
    public string Name { get; set; } = string.Empty; // e.g. "Line 1 Main PLC"
    public string Protocol { get; set; } = string.Empty; // "OPC_UA", "MODBUS_TCP", "MQTT"
    public string Host { get; set; } = string.Empty; // Hostname or IP
    public int Port { get; set; } = 1883;
    public string ConfigJson { get; set; } = string.Empty; // Protocol-specific auth / TLS
    public bool IsEnabled { get; set; } = true;
    public string Status { get; set; } = "Disconnected"; // "Connected", "Offline", "Error"
}
