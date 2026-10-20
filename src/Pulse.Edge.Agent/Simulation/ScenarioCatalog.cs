using System.Reflection;
using System.Text.Json;

namespace Pulse.Edge.Agent.Simulation;

/// <summary>Scenarios shipped inside the agent as embedded <c>Simulation/Scenarios/&lt;id&gt;.json</c> resources.</summary>
public static class ScenarioCatalog
{
    private const string Marker = ".Simulation.Scenarios.";
    private const string Suffix = ".json";

    private static readonly Assembly Asm = typeof(ScenarioCatalog).Assembly;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static IReadOnlyList<string> Ids() =>
        Asm.GetManifestResourceNames()
            .Select(IdOf)
            .Where(id => id is not null)
            .Select(id => id!)
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToList();

    public static ScenarioDefinition Load(string id)
    {
        var resource = Asm.GetManifestResourceNames().FirstOrDefault(n => IdOf(n) == id)
            ?? throw new KeyNotFoundException($"Unknown scenario '{id}'.");
        using var stream = Asm.GetManifestResourceStream(resource)
            ?? throw new KeyNotFoundException($"Unknown scenario '{id}'.");
        return JsonSerializer.Deserialize<ScenarioDefinition>(stream, Json)
            ?? throw new InvalidDataException($"Scenario '{id}' is empty.");
    }

    public static IEnumerable<string> SignalsOf(UnitDefinition u) => u.Kind switch
    {
        "machine" => ["state", "fault", "fault_code", "good_count", "reject_count", "speed"],
        "analog" or "ambient" => ["value"],
        "meter" => ["kw", "kwh", "pf", "current"],
        _ => throw new ArgumentException($"Unknown unit kind '{u.Kind}' on '{u.Id}'.", nameof(u)),
    };

    private static string? IdOf(string resourceName)
    {
        var i = resourceName.IndexOf(Marker, StringComparison.Ordinal);
        if (i < 0 || !resourceName.EndsWith(Suffix, StringComparison.Ordinal)) return null;
        var id = resourceName[(i + Marker.Length)..^Suffix.Length];
        return id.Length == 0 ? null : id;
    }
}
