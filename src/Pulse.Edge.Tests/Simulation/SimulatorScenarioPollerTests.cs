using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Agent;
using Pulse.Edge.Agent.Drivers;
using Pulse.Edge.Agent.Simulation;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Tests.Simulation;

public sealed class SimulatorScenarioPollerTests : IDisposable
{
    // Tuesday 2026-09-01 09:00 local (+07:00): day shift, machines running.
    private static readonly DateTime WeekdayMorning = new(2026, 9, 1, 2, 0, 0, DateTimeKind.Utc);

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "pulse-scenario-tests", Guid.NewGuid().ToString("N"));
    private readonly ScenarioEngine _engine;

    public SimulatorScenarioPollerTests()
    {
        Directory.CreateDirectory(_dir);
        _engine = new ScenarioEngine(new ScenarioStateStore(_dir));
    }

    public void Dispose()
    {
        _engine.Dispose();
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private SimulatorDriverPoller NewPoller() =>
        new(NullLogger<SimulatorDriverPoller>.Instance, new SimulatorDriver(), new QueueStorageService(), _engine);

    private static DriverAdapter Adapter(string configJson) => new()
    {
        Id = "sim-scn-" + Guid.NewGuid().ToString("N"),
        Name = "Scenario",
        Protocol = "SIMULATOR",
        ConfigJson = configJson,
    };

    private static DataPoint Dp(DriverAdapter a, string address) => new()
    {
        Id = Guid.NewGuid().ToString("N"),
        AdapterId = a.Id,
        Address = address,
        DataType = "Float",
        ScanIntervalMs = 1000,
    };

    [Fact]
    public async Task ScenarioTemplate_ReadsUnitSignal()
    {
        var adapter = Adapter("""{"Template":"scenario","Scenario":"integra-dairy"}""");
        var dp = Dp(adapter, "iws1.good_count");
        var poller = NewPoller();
        var dirty = new List<DataPoint>();

        await poller.PollGroupAsync([dp], adapter, WeekdayMorning, dirty, CancellationToken.None);
        await poller.PollGroupAsync([dp], adapter, WeekdayMorning.AddSeconds(60), dirty, CancellationToken.None);

        Assert.Null(dp.LastError);
        Assert.Equal(0, dp.ConsecutiveFailures);
        Assert.True(double.TryParse(dp.LastValue, out var v), $"LastValue was '{dp.LastValue}'");
        Assert.True(v > 0, $"good_count should be > 0, got {v}");
    }

    [Fact]
    public async Task ScenarioTemplate_UnknownAddress_MarksFailure()
    {
        var adapter = Adapter("""{"Template":"scenario","Scenario":"integra-dairy"}""");
        var dp = Dp(adapter, "iws9.good_count");

        await NewPoller().PollGroupAsync([dp], adapter, WeekdayMorning, [], CancellationToken.None);

        Assert.False(string.IsNullOrEmpty(dp.LastError));
        Assert.Equal(1, dp.ConsecutiveFailures);
    }

    [Theory]
    [InlineData("""{"Template":"scenario"}""")]
    [InlineData("""{"Template":"scenario","Scenario":"no-such-scenario"}""")]
    public async Task ScenarioTemplate_MissingOrUnknownScenario_MarksFailureWithoutThrowing(string config)
    {
        var adapter = Adapter(config);
        var dp = Dp(adapter, "iws1.good_count");

        await NewPoller().PollGroupAsync([dp], adapter, WeekdayMorning, [], CancellationToken.None);

        Assert.False(string.IsNullOrEmpty(dp.LastError));
        Assert.Equal(1, dp.ConsecutiveFailures);
    }

    [Fact]
    public async Task ScenarioTemplate_LocalKindedNow_IsConvertedToUtc()
    {
        var adapter = Adapter("""{"Template":"scenario","Scenario":"integra-dairy"}""");
        var dp = Dp(adapter, "iws1.good_count");
        var poller = NewPoller();

        await poller.PollGroupAsync([dp], adapter, WeekdayMorning.ToLocalTime(), [], CancellationToken.None);

        Assert.Null(dp.LastError);
    }

    [Fact]
    public async Task ProductionTemplate_Unchanged()
    {
        var adapter = Adapter("""{"Template":"production"}""");
        var dp = Dp(adapter, "total_count");

        await NewPoller().PollGroupAsync([dp], adapter, WeekdayMorning, [], CancellationToken.None);

        Assert.Null(dp.LastError);
        Assert.True(double.TryParse(dp.LastValue, out _));
    }
}
