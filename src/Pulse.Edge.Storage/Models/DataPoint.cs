using System;

namespace Pulse.Edge.Storage.Models;

public class DataPoint
{
    public string Id { get; set; } = string.Empty; // Primary Key (UUID)
    public string AdapterId { get; set; } = string.Empty; // Foreign Key to DriverAdapter
    public string? DataSourceId { get; set; } // Nullable: empty if unmapped/prepared
    public string? Metric { get; set; }       // Nullable: standard metric code
    public string Address { get; set; } = string.Empty; // PLC NodeID or register address
    public string DataType { get; set; } = string.Empty; // "Float", "Int32", "Boolean", "String"
    public int ScanIntervalMs { get; set; } = 1000; // Polling frequency in ms
    public double ScaleFactor { get; set; } = 1.0;
    public double Offset { get; set; } = 0.0;
    public bool IsEnabled { get; set; } = true;

    // Diagnostic columns
    public string? LastValue { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastUpdated { get; set; }
}
