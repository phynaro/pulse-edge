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
}
