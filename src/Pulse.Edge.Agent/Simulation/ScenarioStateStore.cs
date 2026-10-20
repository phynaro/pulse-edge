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
/// <c>&lt;id&gt;.state.json</c> (temp file fsynced, then renamed over it; the previous state is kept as
/// <c>&lt;id&gt;.state.json.bak</c>) and <c>&lt;id&gt;.events.json</c>
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
    private string BackupPath(string scenarioId) => StatePath(scenarioId) + ".bak";
    private string EventsPath(string scenarioId) => Path.Combine(_dir, $"{scenarioId}.events.json");

    /// <summary>
    /// The saved state, or null when there is none. A corrupt or empty state file is moved aside as
    /// <c>&lt;id&gt;.state.json.corrupt-&lt;utc&gt;</c> and reported through <paramref name="onError"/>; then the
    /// <c>.bak</c> is tried. IO errors (e.g. the file is locked) propagate so the caller can retry.
    /// </summary>
    public ScenarioPersistedState? Load(string scenarioId, Action<Exception>? onError = null) =>
        TryLoad(StatePath(scenarioId), onError) ?? TryLoad(BackupPath(scenarioId), onError);

    private static ScenarioPersistedState? TryLoad(string path, Action<Exception>? onError)
    {
        if (!File.Exists(path)) return null;
        var text = File.ReadAllText(path);
        try
        {
            if (string.IsNullOrWhiteSpace(text)) throw new JsonException("the file is empty");
            var s = JsonSerializer.Deserialize<ScenarioPersistedState>(text, Json)
                ?? throw new JsonException("the file holds no state");
            return new ScenarioPersistedState(
                s.Counters ?? [],
                s.Analogs ?? [],
                (s.ActiveEventsUntil ?? []).ToDictionary(kv => kv.Key, kv => AsUtc(kv.Value)),
                AsUtc(s.LastUpdateUtc));
        }
        catch (JsonException ex)
        {
            var aside = $"{path}.corrupt-{DateTime.UtcNow:yyyyMMddTHHmmssfffZ}";
            try
            {
                File.Move(path, aside);
            }
            catch (Exception moveEx) when (moveEx is IOException or UnauthorizedAccessException)
            {
                aside = $"(could not move it aside: {moveEx.Message})";
            }
            onError?.Invoke(new InvalidDataException($"Scenario state file '{path}' is corrupt ({ex.Message}); moved to {aside}.", ex));
            return null;
        }
    }

    public void Save(string scenarioId, ScenarioPersistedState s)
    {
        Directory.CreateDirectory(_dir);
        var path = StatePath(scenarioId);
        var tmp = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(s, Json);
            using (var fs = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                fs.Write(bytes);
                fs.Flush(flushToDisk: true); // the bytes are on disk before the rename makes them the state
            }
            // Keep the previous state: the main file stays in place until the rename replaces it.
            if (File.Exists(path)) File.Copy(path, BackupPath(scenarioId), overwrite: true);
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
