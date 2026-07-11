using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;

namespace Pulse.Edge.Agent.Services;

public sealed class DiagnosticCaptureMonitor : BackgroundService
{
    private DiagnosticCaptureSnapshot _current = DiagnosticCaptureSnapshot.Disabled;
    public DiagnosticCaptureSnapshot Current => Volatile.Read(ref _current);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var db = new QueueDbContext();
                var config = await db.DiagnosticCaptureConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == 1, stoppingToken);
                var active = config is { IsEnabled: true, ExpiresAtUtc: not null } && config.ExpiresAtUtc > DateTime.UtcNow;
                Volatile.Write(ref _current, active
                    ? new DiagnosticCaptureSnapshot(true, config!.AdapterId, config.ExpiresAtUtc!.Value)
                    : DiagnosticCaptureSnapshot.Disabled);
            }
            catch when (!stoppingToken.IsCancellationRequested)
            {
                Volatile.Write(ref _current, DiagnosticCaptureSnapshot.Disabled);
            }
            await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
        }
    }
}

public sealed record DiagnosticCaptureSnapshot(bool IsActive, string AdapterId, DateTime ExpiresAtUtc)
{
    public static readonly DiagnosticCaptureSnapshot Disabled = new(false, "", DateTime.MinValue);
    public bool Includes(string adapterId) => IsActive && ExpiresAtUtc > DateTime.UtcNow && !string.IsNullOrWhiteSpace(adapterId) &&
        (string.IsNullOrWhiteSpace(AdapterId) || AdapterId == adapterId);
}
