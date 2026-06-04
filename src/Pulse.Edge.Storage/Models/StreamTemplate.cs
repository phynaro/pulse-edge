using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Pulse.Edge.Storage.Models;

public class StreamTemplate
{
    public string Id { get; set; } = string.Empty; // Primary Key (Code Name)
    public string Description { get; set; } = string.Empty;
    public string ParametersJson { get; set; } = "[]"; // Serialized JSON list of parameter strings
    public string Icon { get; set; } = "Database"; // Lucide icon identifier: BarChart3, Zap, Database, Activity, etc.

    // Utility helpers
    public List<string> GetParameters()
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(ParametersJson) ?? new List<string>();
        }
        catch
        {
            return new List<string>();
        }
    }

    public void SetParameters(List<string> parameters)
    {
        ParametersJson = JsonSerializer.Serialize(parameters ?? new List<string>());
    }
}
