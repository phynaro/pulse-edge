using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Serilog.Core;
using Serilog.Events;

namespace Pulse.Edge.Api.Diagnostics;

public sealed class DiagnosticLogService : BackgroundService, ILogEventSink
{
    private const int RingLimit = 1_000;
    private const int PersistedLimit = 10_000;
    private const int DebugPersistedLimit = 5_000;
    private static readonly TimeSpan RetentionAge = TimeSpan.FromDays(30);
    private static readonly TimeSpan DebugRetentionAge = TimeSpan.FromHours(24);
    private static readonly Regex SensitiveValue = new(@"(?i)(password|authorization|token|secret|api[_-]?key|cookie|credential)\s*[:=]\s*([^\s,;]+)", RegexOptions.Compiled);
    private readonly ConcurrentQueue<DiagnosticLogEntry> _ring = new();
    private readonly Channel<DiagnosticEvent> _persistence = Channel.CreateBounded<DiagnosticEvent>(new BoundedChannelOptions(2_000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
    private readonly ConcurrentDictionary<Guid, Channel<DiagnosticLogEntry>> _subscribers = new();
    private long _sequence;

    public void Emit(LogEvent logEvent)
    {
        if (logEvent.Level < LogEventLevel.Information) return;
        var entry = new DiagnosticLogEntry(
            Interlocked.Increment(ref _sequence),
            logEvent.Timestamp.UtcDateTime,
            LevelName(logEvent.Level),
            Property(logEvent, "SourceContext", "System"),
            Property(logEvent, "EventId", ""),
            Sanitize(logEvent.RenderMessage(), 2_000),
            Sanitize(logEvent.Exception?.ToString() ?? "", 8_000),
            Property(logEvent, "AdapterId", ""),
            Property(logEvent, "DataPointId", ""),
            Property(logEvent, "CorrelationId", ""));

        _ring.Enqueue(entry);
        while (_ring.Count > RingLimit) _ring.TryDequeue(out _);
        foreach (var subscriber in _subscribers.Values) subscriber.Writer.TryWrite(entry);

        if (logEvent.Level >= LogEventLevel.Warning)
            _persistence.Writer.TryWrite(new DiagnosticEvent { TimestampUtc = entry.TimestampUtc, Level = entry.Level, Category = entry.Category, EventCode = entry.EventCode, Message = entry.Message, Details = entry.Details, AdapterId = entry.AdapterId, DataPointId = entry.DataPointId, CorrelationId = entry.CorrelationId });
    }

    public void Ingest(ForwardedDiagnostic item, bool allowDebug = false)
    {
        var level = item.Level is "Critical" or "Error" or "Warning" or "Information" ? item.Level
            : item.Level == "Debug" && allowDebug ? "Debug" : "Information";
        if (item.Level == "Debug" && !allowDebug) return;
        var entry = new DiagnosticLogEntry(Interlocked.Increment(ref _sequence), item.TimestampUtc, level,
            Sanitize(item.Category, 300), item.EventCode, Sanitize(item.Message, 2_000), Sanitize(item.Details, 8_000),
            Sanitize(item.AdapterId, 200), Sanitize(item.DataPointId, 200), Sanitize(item.CorrelationId, 200));
        _ring.Enqueue(entry);
        while (_ring.Count > RingLimit) _ring.TryDequeue(out _);
        foreach (var subscriber in _subscribers.Values) subscriber.Writer.TryWrite(entry);
        if (level is "Debug" or "Warning" or "Error" or "Critical")
            _persistence.Writer.TryWrite(new DiagnosticEvent { TimestampUtc = entry.TimestampUtc, Level = entry.Level, Category = entry.Category, EventCode = entry.EventCode, Message = entry.Message, Details = entry.Details, AdapterId = entry.AdapterId, DataPointId = entry.DataPointId, CorrelationId = entry.CorrelationId });
    }

    public void AddLifecycle(string message)
    {
        var entry = new DiagnosticLogEntry(Interlocked.Increment(ref _sequence), DateTime.UtcNow, "Information", "Pulse.Edge.Diagnostics.DebugCapture", "", Sanitize(message, 2_000), "", "", "", "");
        _ring.Enqueue(entry);
        while (_ring.Count > RingLimit) _ring.TryDequeue(out _);
        foreach (var subscriber in _subscribers.Values) subscriber.Writer.TryWrite(entry);
        _persistence.Writer.TryWrite(new DiagnosticEvent { TimestampUtc = entry.TimestampUtc, Level = entry.Level, Category = entry.Category, Message = entry.Message });
    }

    public IReadOnlyList<DiagnosticLogEntry> Recent(int limit, string? level, string? category, string? search) => _ring
        .Reverse()
        .Where(x => string.IsNullOrWhiteSpace(level) || x.Level.Equals(level, StringComparison.OrdinalIgnoreCase))
        .Where(x => string.IsNullOrWhiteSpace(category) || x.Category.Contains(category, StringComparison.OrdinalIgnoreCase))
        .Where(x => string.IsNullOrWhiteSpace(search) || x.Message.Contains(search, StringComparison.OrdinalIgnoreCase) || x.Details.Contains(search, StringComparison.OrdinalIgnoreCase))
        .Take(Math.Clamp(limit, 1, 1_000)).ToList();

    public (Guid Id, ChannelReader<DiagnosticLogEntry> Reader) Subscribe()
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<DiagnosticLogEntry>(new BoundedChannelOptions(250) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        _subscribers[id] = channel;
        return (id, channel.Reader);
    }

    public void Unsubscribe(Guid id) { if (_subscribers.TryRemove(id, out var channel)) channel.Writer.TryComplete(); }
    public void ClearMemory() { while (_ring.TryDequeue(out _)) { } }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var persistedSinceCleanup = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var ready = _persistence.Reader.WaitToReadAsync(stoppingToken).AsTask();
                await Task.WhenAny(ready, Task.Delay(TimeSpan.FromSeconds(5), stoppingToken));
                while (_persistence.Reader.TryRead(out var item))
                {
                    using var db = new QueueDbContext();
                    db.DiagnosticEvents.Add(item);
                    await db.SaveChangesAsync(stoppingToken);

                    if (item.Level == "Debug")
                    {
                        var excessDebugIds = await db.DiagnosticEvents.Where(x => x.Level == "Debug").OrderByDescending(x => x.TimestampUtc).Skip(DebugPersistedLimit).Select(x => x.Id).ToListAsync(stoppingToken);
                        if (excessDebugIds.Count > 0)
                        {
                            await db.DiagnosticEvents.Where(x => excessDebugIds.Contains(x.Id)).ExecuteDeleteAsync(stoppingToken);
                            var capture = await db.DiagnosticCaptureConfigs.FirstOrDefaultAsync(x => x.Id == 1, stoppingToken);
                            if (capture != null && !capture.HasRotated)
                            {
                                capture.HasRotated = true;
                                await db.SaveChangesAsync(stoppingToken);
                                AddLifecycle("Debug capture reached 5,000 retained entries; oldest Debug entries are now being rotated.");
                            }
                        }
                    }

                    if (++persistedSinceCleanup >= 100)
                    {
                        persistedSinceCleanup = 0;
                        await CleanupAsync(db, stoppingToken);
                    }
                }
                using var maintenanceDb = new QueueDbContext();
                await MaintainCaptureAsync(maintenanceDb, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch when (!stoppingToken.IsCancellationRequested) { /* diagnostics must never interrupt the agent */ }
        }
    }

    private async Task MaintainCaptureAsync(QueueDbContext db, CancellationToken ct)
    {
        var capture = await db.DiagnosticCaptureConfigs.FirstOrDefaultAsync(x => x.Id == 1, ct);
        if (capture is { IsEnabled: true, ExpiresAtUtc: not null } && capture.ExpiresAtUtc <= DateTime.UtcNow)
        {
            capture.IsEnabled = false;
            await db.SaveChangesAsync(ct);
            AddLifecycle("Debug capture expired automatically.");
        }
        await CleanupAsync(db, ct);
    }

    private static async Task CleanupAsync(QueueDbContext db, CancellationToken ct)
    {
        var incidentCutoff = DateTime.UtcNow - RetentionAge;
        var debugCutoff = DateTime.UtcNow - DebugRetentionAge;
        await db.DiagnosticEvents.Where(x => (x.Level == "Debug" && x.TimestampUtc < debugCutoff) || (x.Level != "Debug" && x.TimestampUtc < incidentCutoff)).ExecuteDeleteAsync(ct);
        var excessIds = await db.DiagnosticEvents.Where(x => x.Level != "Debug").OrderByDescending(x => x.TimestampUtc).Skip(PersistedLimit).Select(x => x.Id).ToListAsync(ct);
        if (excessIds.Count > 0) await db.DiagnosticEvents.Where(x => excessIds.Contains(x.Id)).ExecuteDeleteAsync(ct);
    }

    private static string Property(LogEvent item, string name, string fallback) => item.Properties.TryGetValue(name, out var value) ? value.ToString().Trim('"') : fallback;
    private static string Sanitize(string value, int max) { var safe = SensitiveValue.Replace(value, "$1=[REDACTED]"); return safe.Length <= max ? safe : safe[..max] + "…"; }
    private static string LevelName(LogEventLevel level) => level switch { LogEventLevel.Fatal => "Critical", LogEventLevel.Error => "Error", LogEventLevel.Warning => "Warning", LogEventLevel.Debug => "Debug", _ => "Information" };
}

public record DiagnosticLogEntry(long Sequence, DateTime TimestampUtc, string Level, string Category, string EventCode, string Message, string Details, string AdapterId, string DataPointId, string CorrelationId);
public record ForwardedDiagnostic(DateTime TimestampUtc, string Level, string Category, string EventCode, string Message, string Details, string AdapterId = "", string DataPointId = "", string CorrelationId = "");
