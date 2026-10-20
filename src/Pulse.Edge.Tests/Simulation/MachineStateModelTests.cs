using Pulse.Edge.Agent.Simulation;

namespace Pulse.Edge.Tests.Simulation;

public class MachineStateModelTests
{
    private const string ScenarioId = "integra-dairy";
    private static readonly TimeSpan Offset = TimeSpan.FromHours(7);
    private static readonly DateTime Start = new(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc); // Tuesday

    private static MachineStateModel Model(string unitId)
    {
        var s = ScenarioCatalog.Load(ScenarioId);
        var unit = s.Units.Single(u => u.Id == unitId);
        return new MachineStateModel(ScenarioId, unit, s.Shifts, Offset);
    }

    [Fact]
    public void At_IsDeterministic_AcrossInstances()
    {
        var a = Model("iws1");
        var b = Model("iws1");
        var rng = new Random(42);
        for (var i = 0; i < 500; i++)
        {
            var t = Start.AddSeconds(rng.NextInt64(0, 30L * 24 * 3600));
            Assert.Equal(a.At(t), b.At(t));
        }
    }

    [Fact]
    public void At_SameKindUnits_FaultIndependently()
    {
        var a = Model("iws1");
        var b = Model("iws2");
        int both = 0, either = 0;
        for (var m = 0; m < 7 * 24 * 60; m++)
        {
            var t = Start.AddMinutes(m);
            var fa = a.At(t).Mode == MachineMode.Fault;
            var fb = b.At(t).Mode == MachineMode.Fault;
            if (fa && fb) both++;
            if (fa || fb) either++;
        }
        Assert.True(either > 0);
        Assert.True(both < 0.05 * either, $"both={both} either={either}");
    }

    [Fact]
    public void At_OutsideShift_IsPlannedStop()
    {
        // Sunday 2026-09-06 10:00 local (+07:00) = 03:00 UTC.
        var sunday = new DateTime(2026, 9, 6, 3, 0, 0, DateTimeKind.Utc);
        Assert.Equal(MachineMode.PlannedStop, Model("iws1").At(sunday).Mode);
        Assert.NotEqual(MachineMode.PlannedStop, Model("blr1").At(sunday).Mode);
    }

    [Fact]
    public void At_AvailabilityRoughlyMatchesParams()
    {
        var m = Model("iws1");
        int running = 0, shift = 0;
        for (var i = 0; i < 30 * 24 * 60; i++)
        {
            var snap = m.At(Start.AddMinutes(i));
            if (snap.Mode == MachineMode.PlannedStop) continue;
            shift++;
            if (snap.Mode == MachineMode.Running) running++;
        }
        var share = (double)running / shift;
        Assert.InRange(share, 0.80, 0.95);
    }

    [Fact]
    public void ProducedBetween_IsAdditive()
    {
        var m = Model("iws1");
        var a = Start.AddHours(1.3);
        var b = a.AddHours(30.77);
        var c = b.AddHours(50.123);
        var whole = m.ProducedBetween(a, c);
        Assert.True(whole > 0);
        Assert.InRange(m.ProducedBetween(a, b) + m.ProducedBetween(b, c) - whole, -1, 1);
    }

    [Theory]
    [InlineData("iws1")] // follows shifts, frequent micro-stops
    [InlineData("blr1")] // 24/7 utility
    [InlineData("htst1")]
    public void ProducedBetween_EqualsPerSecondCount(string unitId)
    {
        // The interval-based count must equal probing At() at every whole second, including odd sub-second ends
        // and windows that cross shift changes, Sunday and hour boundaries.
        var unit = ScenarioCatalog.Load(ScenarioId).Units.Single(u => u.Id == unitId);
        var m = Model(unitId);
        double BruteForce(DateTime from, DateTime to)
        {
            const long perSec = TimeSpan.TicksPerSecond;
            long running = 0;
            for (var s = (from.Ticks + perSec - 1) / perSec; s < (to.Ticks + perSec - 1) / perSec; s++)
                if (m.At(new DateTime(s * perSec, DateTimeKind.Utc)).Mode == MachineMode.Running) running++;
            return running * unit.Machine!.RatePerMin / 60.0;
        }
        var from0 = Start.AddMilliseconds(437);
        Assert.Equal(BruteForce(from0, from0.AddDays(6).AddMilliseconds(250)), m.ProducedBetween(from0, from0.AddDays(6).AddMilliseconds(250)));
        for (var i = 0; i < 200; i++)
        {
            var f = Start.AddSeconds(i * 2671.3);
            var t = f.AddSeconds(1 + i * 37.9);
            Assert.Equal(BruteForce(f, t), m.ProducedBetween(f, t));
        }
    }

    [Fact]
    public void ProducedBetween_ThirtyDays_FinishesQuickly()
    {
        var m = Model("iws1");
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var p = m.ProducedBetween(Start, Start.AddDays(30));
        Assert.True(p > 0);
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(20), $"took {sw.Elapsed}");
    }
}
