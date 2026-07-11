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
    private static readonly TimeSpan RetentionAge = TimeSpan.FromDays(30);
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
        await foreach (var item in _persistence.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                using var db = new QueueDbContext();
                db.DiagnosticEvents.Add(item);
                await db.SaveChangesAsync(stoppingToken);
                if (++persistedSinceCleanup >= 100)
                {
                    persistedSinceCleanup = 0;
                    var cutoff = DateTime.UtcNow - RetentionAge;
                    await db.DiagnosticEvents.Where(x => x.TimestampUtc < cutoff).ExecuteDeleteAsync(stoppingToken);
                    var excessIds = await db.DiagnosticEvents.OrderByDescending(x => x.TimestampUtc).Skip(PersistedLimit).Select(x => x.Id).ToListAsync(stoppingToken);
                    if (excessIds.Count > 0) await db.DiagnosticEvents.Where(x => excessIds.Contains(x.Id)).ExecuteDeleteAsync(stoppingToken);
                }
            }
            catch when (!stoppingToken.IsCancellationRequested) { /* diagnostics must never interrupt the agent */ }
        }
    }

    private static string Property(LogEvent item, string name, string fallback) => item.Properties.TryGetValue(name, out var value) ? value.ToString().Trim('"') : fallback;
    private static string Sanitize(string value, int max) { var safe = SensitiveValue.Replace(value, "$1=[REDACTED]"); return safe.Length <= max ? safe : safe[..max] + "…"; }
    private static string LevelName(LogEventLevel level) => level switch { LogEventLevel.Fatal => "Critical", LogEventLevel.Error => "Error", LogEventLevel.Warning => "Warning", _ => "Information" };
}

public record DiagnosticLogEntry(long Sequence, DateTime TimestampUtc, string Level, string Category, string EventCode, string Message, string Details, string AdapterId, string DataPointId, string CorrelationId);
