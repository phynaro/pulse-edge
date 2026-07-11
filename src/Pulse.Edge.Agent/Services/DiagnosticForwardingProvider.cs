using System.Threading.Channels;
using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Storage.Helpers;

namespace Pulse.Edge.Agent.Services;

[ProviderAlias("PulseDiagnostic")]
public sealed class DiagnosticForwardingProvider : ILoggerProvider, ISupportExternalScope, IHostedService
{
    private readonly DiagnosticCaptureMonitor _captureMonitor;
    private readonly Channel<ForwardedDiagnostic> _queue = Channel.CreateBounded<ForwardedDiagnostic>(new BoundedChannelOptions(2_000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
    private readonly HttpClient _client = new() { BaseAddress = new Uri("http://127.0.0.1:5288"), Timeout = TimeSpan.FromSeconds(3) };
    private CancellationTokenSource? _stopping;
    private Task? _worker;
    private IExternalScopeProvider _scopeProvider = new LoggerExternalScopeProvider();

    public DiagnosticForwardingProvider(DiagnosticCaptureMonitor captureMonitor)
    {
        _captureMonitor = captureMonitor;
        _client.DefaultRequestHeaders.Add("X-Pulse-Diagnostic-Key", DiagnosticBridgeKey.LoadOrCreate());
    }

    public ILogger CreateLogger(string categoryName) => new ForwardingLogger(categoryName, _queue.Writer, () => _scopeProvider, _captureMonitor);
    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopeProvider = scopeProvider;
    public void Dispose() { _client.Dispose(); _stopping?.Dispose(); }
    public Task StartAsync(CancellationToken cancellationToken) { _stopping = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken); _worker = RunAsync(_stopping.Token); return Task.CompletedTask; }
    public async Task StopAsync(CancellationToken cancellationToken) { if (_stopping == null || _worker == null) return; _stopping.Cancel(); try { await _worker.WaitAsync(cancellationToken); } catch (OperationCanceledException) { } }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var batch = new List<ForwardedDiagnostic>(100);
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var first = await _queue.Reader.ReadAsync(cancellationToken);
                batch.Add(first);
                while (batch.Count < 100 && _queue.Reader.TryRead(out var next)) batch.Add(next);
                using var response = await _client.PostAsJsonAsync("/api/diagnostic-logs/ingest", batch, cancellationToken);
                if (!response.IsSuccessStatusCode) await Task.Delay(1_000, cancellationToken);
            }
            catch (HttpRequestException) { await Task.Delay(1_000, cancellationToken); }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested) { await Task.Delay(1_000, cancellationToken); }
            finally { batch.Clear(); }
        }
    }

    private sealed class ForwardingLogger(string category, ChannelWriter<ForwardedDiagnostic> writer, Func<IExternalScopeProvider> scopes, DiagnosticCaptureMonitor captureMonitor) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => scopes().Push(state);
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information ||
            (logLevel == LogLevel.Debug && captureMonitor.Current.IsActive &&
             (category.StartsWith("Pulse.Edge.Agent.Drivers", StringComparison.Ordinal) || category.StartsWith("Pulse.Edge.Protocols", StringComparison.Ordinal)));
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var properties = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            scopes().ForEachScope((scope, target) =>
            {
                if (scope is IEnumerable<KeyValuePair<string, object>> values)
                    foreach (var value in values) target[value.Key] = value.Value?.ToString() ?? "";
            }, properties);
            if (logLevel == LogLevel.Debug && !captureMonitor.Current.Includes(properties.GetValueOrDefault("AdapterId", ""))) return;
            writer.TryWrite(new ForwardedDiagnostic(DateTime.UtcNow, LevelName(logLevel), category, eventId.Id == 0 ? "" : eventId.Id.ToString(), formatter(state, exception), exception?.ToString() ?? "",
                properties.GetValueOrDefault("AdapterId", ""), properties.GetValueOrDefault("DataPointId", ""), properties.GetValueOrDefault("CorrelationId", "")));
        }
        private static string LevelName(LogLevel level) => level switch { LogLevel.Critical => "Critical", LogLevel.Error => "Error", LogLevel.Warning => "Warning", LogLevel.Debug => "Debug", _ => "Information" };
    }

    private record ForwardedDiagnostic(DateTime TimestampUtc, string Level, string Category, string EventCode, string Message, string Details, string AdapterId = "", string DataPointId = "", string CorrelationId = "");
}
