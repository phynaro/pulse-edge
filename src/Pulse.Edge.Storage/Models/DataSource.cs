using System;

namespace Pulse.Edge.Storage.Models;

public class DataSource
{
    public string Id { get; set; } = string.Empty; // Primary Key (e.g. "DS001")
    public string Name { get; set; } = string.Empty; // e.g. "CasePacker Production"
    public string Type { get; set; } = "General"; // "Production" (OEE), "Energy", "General"
    public string Description { get; set; } = string.Empty;
    public bool IsEnabled { get; set; } = true;
}
