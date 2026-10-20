using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

namespace Pulse.Edge.Agent.Simulation;

/// <summary>What a scenario needs to resume after a restart. All DateTimes are UTC.</summary>
public sealed record ScenarioPersistedState(
    Dictionary<string, double> Counters,
    Dictionary<string, double> Analogs,
    Dictionary<string, DateTime> ActiveEventsUntil,
    DateTime LastUpdateUtc);

/// <summary>
/// File persistence for scenarios under <c>&lt;directory&gt;/simulator/</c>:
/// <c>&lt;id&gt;.state.json</c> (atomic temp-file + rename) and <c>&lt;id&gt;.events.json</c>
/// (append-only JSON lines of presenter event requests). The events file is opened exclusively
/// (FileShare.None, retried) for both append and drain, so requests from another process
/// (split mode) are never lost between the drain's read and its truncate.
/// </summary>
public sealed class ScenarioStateStore(string directory)
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly ConcurrentDictionary<string, object> PathLocks = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>How long to retry opening the events file while another process holds it (holds last milliseconds;
    /// kept short because a blocked drain delays the 1 Hz Update). Settable for tests.</summary>
    public TimeSpan LockTimeout { get; init; } = TimeSpan.FromSeconds(2);

    private readonly string _dir = Path.Combine(Path.GetFullPath(directory), "simulator");

    private sealed record EventLine(string EventId, DateTime RequestedUtc);

    private string StatePath(string scenarioId) => Path.Combine(_dir, $"{scenarioId}.state.json");
    private string EventsPath(string scenarioId) => Path.Combine(_dir, $"{scenarioId}.events.json");

    public ScenarioPersistedState? Load(string scenarioId)
    {
        var path = StatePath(scenarioId);
        if (!File.Exists(path)) return null;
        try
        {
            var s = JsonSerializer.Deserialize<ScenarioPersistedState>(File.ReadAllText(path), Json);
            if (s is null) return null;
            return new ScenarioPersistedState(
                s.Counters ?? [],
                s.Analogs ?? [],
                (s.ActiveEventsUntil ?? []).ToDictionary(kv => kv.Key, kv => AsUtc(kv.Value)),
                AsUtc(s.LastUpdateUtc));
        }
        catch (JsonException)
        {
            return null; // a corrupt state file restarts the scenario rather than crashing the host
        }
    }

    public void Save(string scenarioId, ScenarioPersistedState s)
    {
        Directory.CreateDirectory(_dir);
        var path = StatePath(scenarioId);
        var tmp = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllText(tmp, JsonSerializer.Serialize(s, Json));
            File.Move(tmp, path, overwrite: true);
        }
        catch
        {
            try { File.Delete(tmp); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            throw;
        }
    }

    public void RequestEvent(string scenarioId, string eventId, DateTime requestedUtc)
    {
        var line = JsonSerializer.Serialize(new EventLine(eventId, AsUtc(requestedUtc)), Json) + "\n";
        var bytes = Encoding.UTF8.GetBytes(line);
        WithEventsFile(scenarioId, fs =>
        {
            fs.Seek(0, SeekOrigin.End);
            fs.Write(bytes);
            fs.Flush(flushToDisk: true);
            return 0;
        });
    }

    public IReadOnlyList<(string EventId, DateTime RequestedUtc)> DrainEventRequests(string scenarioId)
    {
        if (!File.Exists(EventsPath(scenarioId))) return [];
        var text = WithEventsFile(scenarioId, fs =>
        {
            // Empty queue (the usual case, every tick): touch nothing, no write, no fsync.
            if (fs.Length == 0) return "";
            fs.Seek(0, SeekOrigin.Begin);
            using var ms = new MemoryStream();
            fs.CopyTo(ms);
            fs.SetLength(0);
            fs.Flush(flushToDisk: true);
            return Encoding.UTF8.GetString(ms.ToArray());
        });

        if (text.Length == 0) return [];
        var result = new List<(string, DateTime)>();
        foreach (var raw in text.Split('\n'))
        {
            var l = raw.Trim();
            if (l.Length == 0) continue;
            try
            {
                var e = JsonSerializer.Deserialize<EventLine>(l, Json);
                if (e is { EventId.Length: > 0 }) result.Add((e.EventId, AsUtc(e.RequestedUtc)));
            }
            catch (JsonException)
            {
                // skip a torn or malformed line; the rest of the queue still applies
            }
        }
        return result;
    }

    private T WithEventsFile<T>(string scenarioId, Func<FileStream, T> body)
    {
        Directory.CreateDirectory(_dir);
        var path = EventsPath(scenarioId);
        lock (PathLocks.GetOrAdd(path, _ => new object()))
        {
            var deadline = DateTime.UtcNow + LockTimeout;
            while (true)
            {
                FileStream fs;
                try
                {
                    fs = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                }
                catch (IOException) when (DateTime.UtcNow < deadline)
                {
                    Thread.Sleep(10); // another process holds it; retry
                    continue;
                }
                using (fs) return body(fs);
            }
        }
    }

    private static DateTime AsUtc(DateTime d) => d.Kind switch
    {
        DateTimeKind.Utc => d,
        DateTimeKind.Local => d.ToUniversalTime(),
        _ => DateTime.SpecifyKind(d, DateTimeKind.Utc),
    };
}
