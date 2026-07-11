using Pulse.Edge.Api.Diagnostics;
using Serilog;

namespace Pulse.Edge.Tests;

public class DiagnosticLogServiceTests
{
    [Fact]
    public void Sink_CapturesStructuredEntry_AndRedactsSecrets()
    {
        var service = new DiagnosticLogService();
        using var logger = new LoggerConfiguration().MinimumLevel.Information().WriteTo.Sink(service).CreateLogger();

        logger.ForContext("SourceContext", "Pulse.Edge.Tests.Driver")
            .Information("Connection failed apiKey={ApiKey}", "top-secret-value");

        var entry = Assert.Single(service.Recent(10, null, null, null));
        Assert.Equal("Information", entry.Level);
        Assert.Equal("Pulse.Edge.Tests.Driver", entry.Category);
        Assert.DoesNotContain("top-secret-value", entry.Message);
        Assert.Contains("[REDACTED]", entry.Message);
    }

    [Fact]
    public void Recent_AppliesLevelCategoryAndSearchFilters()
    {
        var service = new DiagnosticLogService();
        using var logger = new LoggerConfiguration().MinimumLevel.Information().WriteTo.Sink(service).CreateLogger();
        logger.ForContext("SourceContext", "Cloud.Sync").Warning("Upload timeout");
        logger.ForContext("SourceContext", "Driver.Modbus").Information("Poll healthy");

        var results = service.Recent(10, "Warning", "Cloud", "timeout");

        Assert.Single(results);
        Assert.Equal("Upload timeout", results[0].Message);
    }

    [Fact]
    public void Ingest_DebugRequiresActiveCaptureApproval()
    {
        var service = new DiagnosticLogService();
        var item = new ForwardedDiagnostic(DateTime.UtcNow, "Debug", "Pulse.Edge.Agent.Drivers.OpcUaDriverPoller", "", "Telemetry Read", "", "adapter-1");

        service.Ingest(item, allowDebug: false);
        Assert.Empty(service.Recent(10, null, null, null));

        service.Ingest(item, allowDebug: true);
        var entry = Assert.Single(service.Recent(10, null, null, null));
        Assert.Equal("Debug", entry.Level);
        Assert.Equal("adapter-1", entry.AdapterId);
    }

    [Fact]
    public void LifecycleEntry_IsPublishedAsInformation()
    {
        var service = new DiagnosticLogService();
        service.AddLifecycle("Debug capture started.");

        var entry = Assert.Single(service.Recent(10, null, null, null));
        Assert.Equal("Information", entry.Level);
        Assert.Equal("Pulse.Edge.Diagnostics.DebugCapture", entry.Category);
    }
}
