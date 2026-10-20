using System.Text.RegularExpressions;
using Pulse.Edge.Agent.Simulation;

namespace Pulse.Edge.Tests.Simulation;

public class ScenarioCatalogTests
{
    private static ScenarioDefinition Dairy() => ScenarioCatalog.Load("integra-dairy");

    [Fact]
    public void Catalog_ContainsIntegraDairy() =>
        Assert.Contains("integra-dairy", ScenarioCatalog.Ids());

    [Fact]
    public void IntegraDairy_UnitIdsUnique_AndValid()
    {
        var ids = Dairy().Units.Select(u => u.Id).ToList();
        Assert.All(ids, id => Assert.Matches(new Regex("^[a-z0-9_]+$"), id));
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public void IntegraDairy_MeterFeedsReferToMachines()
    {
        var s = Dairy();
        var machines = s.Units.Where(u => u.Kind == "machine").Select(u => u.Id).ToHashSet();
        var meters = s.Units.Where(u => u.Kind == "meter").ToList();
        Assert.NotEmpty(meters);
        foreach (var m in meters)
            Assert.All(m.Meter!.Feeds, f => Assert.Contains(f, machines));
    }

    [Fact]
    public void IntegraDairy_EventsReferToUnits()
    {
        var s = Dairy();
        var byId = s.Units.ToDictionary(u => u.Id);
        Assert.Equal(5, s.Events.Count);
        foreach (var e in s.Events)
        {
            Assert.True(byId.TryGetValue(e.Unit, out var target), $"event {e.Id} targets unknown unit {e.Unit}");
            Assert.NotEqual("ambient", target!.Kind);
            if (e.Effect == "force_fault") Assert.Equal("machine", target.Kind);
        }
    }

    [Fact]
    public void IntegraDairy_EveryMachineHasAmbientMotorSignals()
    {
        var s = Dairy();
        var byId = s.Units.ToDictionary(u => u.Id);
        foreach (var m in s.Units.Where(u => u.Kind == "machine"))
        {
            foreach (var suffix in new[] { "_motor_current", "_vibration" })
            {
                Assert.True(byId.TryGetValue(m.Id + suffix, out var a), $"missing {m.Id}{suffix}");
                Assert.Equal("ambient", a!.Kind);
                Assert.Equal(m.Id, a.Ambient!.FollowsUnit);
                Assert.Equal(0.0, a.Ambient.StoppedValue);
            }
        }
    }

    [Fact]
    public void IntegraDairy_HasAtLeast60AmbientUnits() =>
        Assert.True(Dairy().Units.Count(u => u.Kind == "ambient") >= 60);

    [Fact]
    public void IntegraDairy_MeterCurrentIsComputed_NotAmbient()
    {
        // R10: each meter's current is derived from its load (signal "current"); only voltages stay ambient.
        var s = Dairy();
        var byId = s.Units.ToDictionary(u => u.Id);
        foreach (var m in s.Units.Where(u => u.Kind == "meter"))
        {
            Assert.False(byId.ContainsKey(m.Id + "_current"), $"{m.Id}_current should not be an ambient unit");
            Assert.Equal("ambient", byId[m.Id + "_voltage"].Kind);
        }
        Assert.Equal(125, s.Units.Count);
        Assert.Equal(84, s.Units.Count(u => u.Kind == "ambient"));
    }

    [Fact]
    public void IntegraDairy_KindsCarryTheirParams()
    {
        foreach (var u in Dairy().Units)
        {
            Assert.Equal(u.Kind == "machine", u.Machine is not null);
            Assert.Equal(u.Kind == "analog", u.Analog is not null);
            Assert.Equal(u.Kind == "meter", u.Meter is not null);
            Assert.Equal(u.Kind == "ambient", u.Ambient is not null);
            Assert.NotEmpty(ScenarioCatalog.SignalsOf(u));
        }
    }

    [Fact]
    public void SignalsOf_ReturnsKindSignals()
    {
        var s = Dairy();
        Assert.Equal(["state", "fault", "fault_code", "good_count", "reject_count", "speed"],
            ScenarioCatalog.SignalsOf(s.Units.First(u => u.Id == "iws1")));
        Assert.Equal(["kw", "kwh", "pf", "current"],ScenarioCatalog.SignalsOf(s.Units.First(u => u.Id == "m_main")));
        Assert.Equal(["value"], ScenarioCatalog.SignalsOf(s.Units.First(u => u.Id == "htst1_outlet")));
    }

    [Fact]
    public void Load_Unknown_Throws() =>
        Assert.Throws<KeyNotFoundException>(() => ScenarioCatalog.Load("nope"));
}
