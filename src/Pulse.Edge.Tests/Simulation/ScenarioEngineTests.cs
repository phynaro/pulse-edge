using System.Diagnostics;
using Pulse.Edge.Agent.Simulation;

namespace Pulse.Edge.Tests.Simulation;

public sealed class ScenarioEngineTests : IDisposable
{
    private const string Sid = "integra-dairy";
    private static readonly TimeSpan Offset = TimeSpan.FromHours(7);
    private static readonly ScenarioDefinition Def = ScenarioCatalog.Load(Sid);

    // Tuesday 2026-09-01 09:00 local (+07:00).
    private static readonly DateTime WeekdayMorning = new(2026, 9, 1, 2, 0, 0, DateTimeKind.Utc);
    // Sunday 2026-09-06 10:00 local: every shift-following machine is in PlannedStop.
    private static readonly DateTime Sunday = new(2026, 9, 6, 3, 0, 0, DateTimeKind.Utc);

    private readonly List<string> _dirs = [];

    public void Dispose()
    {
        foreach (var d in _dirs)
        {
            try { Directory.Delete(d, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    private string NewDir()
    {
        var d = Path.Combine(Path.GetTempPath(), "pulse-scenario-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(d);
        _dirs.Add(d);
        return d;
    }

    private static MachineStateModel Model(string unitId) =>
        new(Sid, Def.Units.Single(u => u.Id == unitId), Def.Shifts, Offset);

    private static bool RunningThroughout(MachineStateModel m, DateTime from, DateTime to)
    {
        for (var t = from; t <= to; t = t.AddSeconds(1))
            if (m.At(t).Mode != MachineMode.Running) return false;
        return true;
    }

    private static bool NoScheduled(ScenarioEngine engine, string eventId, DateTime from, DateTime to)
    {
        var ev = Def.Events.Single(e => e.Id == eventId);
        var d0 = DateOnly.FromDateTime(from + Offset).AddDays(-1);
        var d1 = DateOnly.FromDateTime(to + Offset);
        for (var d = d0; d <= d1; d = d.AddDays(1))
        {
            var s = engine.ScheduledStartUtc(Sid, eventId, d);
            if (s is { } start && start < to && start.AddMinutes(ev.DurationMinutes) > from) return false;
        }
        return true;
    }

    /// <summary>First minute-aligned t (scanning from 09:00 on weekdays) where the unit runs over [t+before, t+after].</summary>
    private static DateTime FindRunning(ScenarioEngine engine, string unitId, TimeSpan before, TimeSpan after, string? avoidEvent)
    {
        var m = Model(unitId);
        for (var day = 0; day < 60; day++)
        {
            var dayStart = WeekdayMorning.AddDays(day);
            if ((dayStart + Offset).DayOfWeek == DayOfWeek.Sunday) continue;
            for (var min = 0; min < 10 * 60; min++)
            {
                var t = dayStart.AddMinutes(min);
                if (!RunningThroughout(m, t + before, t + after)) continue;
                if (avoidEvent is not null && !NoScheduled(engine, avoidEvent, t + before, t + after)) continue;
                return t;
            }
        }
        throw new InvalidOperationException($"No running window found for {unitId}");
    }

    private static void Step(ScenarioEngine e, DateTime from, DateTime to, Action<DateTime>? each = null)
    {
        for (var t = from; t <= to; t = t.AddSeconds(1))
        {
            e.Update(Sid, t);
            each?.Invoke(t);
        }
    }

    [Fact]
    public void Analog_WithMin_NeverReadsBelowIt_WhileItsMachineIsStopped()
    {
        // Real path: wwt1_flow (Min 0, stopped value 0, noise sd 0.8) follows wwt1. Find the first instant
        // wwt1 is faulted or in planned stop, start a fresh engine there (an analog starts settled at its stopped value),
        // then run one hour at 1 s steps.
        Assert.Equal(0, Def.Units.Single(u => u.Id == "wwt1_flow").Analog!.Min);
        var m = Model("wwt1");
        DateTime? stopped = null;
        for (var t = WeekdayMorning; t < WeekdayMorning.AddDays(60) && stopped is null; t = t.AddMinutes(1))
            if (m.At(t).Mode is MachineMode.Fault or MachineMode.PlannedStop) stopped = t; // Idle keeps the flow (R11)
        Assert.NotNull(stopped);

        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        double lowest = double.MaxValue;
        var clamped = 0;
        Step(engine, stopped!.Value, stopped.Value.AddHours(1), _ =>
        {
            var v = engine.Read(Sid, "wwt1_flow.value");
            lowest = Math.Min(lowest, v);
            if (v == 0) clamped++;
        });
        Assert.True(lowest >= 0, $"wwt1_flow dipped to {lowest}");
        Assert.True(clamped > 0, "the clamp never engaged, so this test proves nothing");
    }

    [Fact]
    public void Counters_AreMonotonic()
    {
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        double lastGood = -1, lastReject = -1;
        var sw = Stopwatch.StartNew();
        Step(engine, WeekdayMorning, WeekdayMorning.AddHours(2), _ =>
        {
            var g = engine.Read(Sid, "iws1.good_count");
            var r = engine.Read(Sid, "iws1.reject_count");
            Assert.True(g >= lastGood, $"good went {lastGood} -> {g}");
            Assert.True(r >= lastReject, $"reject went {lastReject} -> {r}");
            lastGood = g;
            lastReject = r;
        });
        sw.Stop();
        Assert.True(lastGood > 10_000, $"good={lastGood}");
        Assert.True(lastReject > 0, $"reject={lastReject}");
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(30), $"2 h of 1 s updates took {sw.Elapsed}");
    }

    [Fact]
    public void Restart_ContinuesCounters()
    {
        var dir = NewDir();
        var end = WeekdayMorning.AddMinutes(30);
        double aGood;
        var probes = Enumerable.Range(0, 20).Select(i => WeekdayMorning.AddMinutes(45 + i * 7)).ToList();
        var aModes = new List<string>();
        using (var a = new ScenarioEngine(new ScenarioStateStore(dir)))
        {
            Step(a, WeekdayMorning, end);
            aGood = a.Read(Sid, "iws1.good_count");
            foreach (var p in probes)
                aModes.AddRange(a.Status(Sid, p).Units.Select(u => $"{u.Id}:{u.Mode}"));
        }
        Assert.True(aGood > 0);
        Assert.True(File.Exists(Path.Combine(dir, "simulator", $"{Sid}.state.json")));

        using var b = new ScenarioEngine(new ScenarioStateStore(dir));
        b.Update(Sid, end.AddSeconds(1));
        Assert.True(b.Read(Sid, "iws1.good_count") >= aGood, $"b={b.Read(Sid, "iws1.good_count")} a={aGood}");
        var bModes = probes.SelectMany(p => b.Status(Sid, p).Units.Select(u => $"{u.Id}:{u.Mode}")).ToList();
        Assert.Equal(aModes, bModes);
    }

    [Fact]
    public void Gap_CatchesUpWithoutOvershoot()
    {
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var t = WeekdayMorning;
        for (var day = 0; !NoScheduled(engine, "iws1_film_jam", t, t.AddMinutes(60)); day++)
            t = WeekdayMorning.AddDays(day + 1);
        engine.Update(Sid, t);
        var g0 = engine.Read(Sid, "iws1.good_count");
        engine.Update(Sid, t.AddMinutes(60));
        var g1 = engine.Read(Sid, "iws1.good_count");
        var expected = Model("iws1").ProducedBetween(t, t.AddMinutes(60)) * (1 - 0.015);
        Assert.True(expected > 0);
        Assert.InRange(g1 - g0, expected * 0.99 - 1, expected * 1.01 + 1);
    }

    [Fact]
    public void Meter_DropsWhenFedMachinesStop()
    {
        using var probe = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var running = FindRunning(probe, "iws1", TimeSpan.Zero, TimeSpan.Zero, null);

        using var a = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        a.Update(Sid, Sunday);
        var sundayKw = a.Read(Sid, "m_iws1.kw");

        using var b = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        b.Update(Sid, running);
        var weekdayKw = b.Read(Sid, "m_iws1.kw");

        Assert.True(sundayKw < weekdayKw, $"sunday={sundayKw} weekday={weekdayKw}");
        Assert.InRange(b.Read(Sid, "m_iws1.pf"), 0.8, 0.94);
        Assert.True(b.Read(Sid, "m_iws1.kwh") >= 205000);
    }

    [Fact]
    public void Analog_ConvergesToSetpoint()
    {
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        // Find a shift start (06:00 local) where htst1 then runs for 12 min, and start the
        // engine 5 min before it so the outlet begins at its stopped value.
        var m = Model("htst1");
        DateTime? shiftStart = null;
        for (var day = 0; day < 60 && shiftStart is null; day++)
        {
            var s = new DateTime(2026, 8, 31, 23, 0, 0, DateTimeKind.Utc).AddDays(day); // 06:00 local
            if ((s + Offset).DayOfWeek == DayOfWeek.Sunday) continue;
            if (RunningThroughout(m, s, s.AddMinutes(12)) && NoScheduled(engine, "htst_temp_drop", s.AddMinutes(-5), s.AddMinutes(12)))
                shiftStart = s;
        }
        Assert.NotNull(shiftStart);
        var start = shiftStart.Value;

        Step(engine, start.AddMinutes(-5), start);
        Assert.True(engine.Read(Sid, "htst1_outlet.value") < 30, "outlet should start near its stopped value");
        Step(engine, start.AddSeconds(1), start.AddMinutes(10));
        Assert.InRange(engine.Read(Sid, "htst1_outlet.value"), 73 - 0.6, 73 + 0.6);
    }

    [Fact]
    public void Event_Offset_LowersHtst_AndExpires()
    {
        var store = new ScenarioStateStore(NewDir());
        using var engine = new ScenarioEngine(store);
        var t = FindRunning(engine, "htst1", TimeSpan.FromMinutes(-5), TimeSpan.FromMinutes(14), "htst_temp_drop");

        Step(engine, t.AddMinutes(-5), t);
        Assert.True(engine.Read(Sid, "htst1_outlet.value") > 72);

        store.RequestEvent(Sid, "htst_temp_drop", t);
        Step(engine, t.AddSeconds(1), t.AddMinutes(3));
        Assert.True(engine.Read(Sid, "htst1_outlet.value") < 70.5, $"value={engine.Read(Sid, "htst1_outlet.value")}");
        Assert.Contains(engine.Status(Sid, t.AddMinutes(3)).ActiveEvents, e => e.Id == "htst_temp_drop");

        Step(engine, t.AddMinutes(3).AddSeconds(1), t.AddMinutes(13));
        Assert.True(engine.Read(Sid, "htst1_outlet.value") > 72, $"value={engine.Read(Sid, "htst1_outlet.value")}");
        Assert.DoesNotContain(engine.Status(Sid, t.AddMinutes(13)).ActiveEvents, e => e.Id == "htst_temp_drop");
    }

    [Fact]
    public void Event_RetriggerExtends_NotStacks()
    {
        using var probe = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var t = FindRunning(probe, "htst1", TimeSpan.FromMinutes(-5), TimeSpan.FromMinutes(16), "htst_temp_drop");

        double MinWith(params int[] requestMinutes)
        {
            var store = new ScenarioStateStore(NewDir());
            using var e = new ScenarioEngine(store);
            var min = double.MaxValue;
            var pending = requestMinutes.Select(m => t.AddMinutes(m)).ToList();
            Step(e, t.AddMinutes(-5), t.AddMinutes(16), now =>
            {
                min = Math.Min(min, e.Read(Sid, "htst1_outlet.value"));
                if (now == t.AddMinutes(3))
                {
                    var active = e.Status(Sid, now).ActiveEvents.Where(a => a.Id == "htst_temp_drop").ToList();
                    Assert.Single(active);
                    Assert.Equal(t.AddMinutes(requestMinutes.Max() + 8), active[0].UntilUtc);
                }
                foreach (var p in pending.Where(p => p == now.AddSeconds(1)).ToList())
                {
                    store.RequestEvent(Sid, "htst_temp_drop", p);
                    pending.Remove(p);
                }
            });
            return min;
        }

        var single = MinWith(0);
        var twice = MinWith(0, 2);
        Assert.True(single < 70.5);
        // Stacking would push the target 3.5 °C lower again (to ~66); allow only noise-level difference.
        Assert.True(twice > single - 1.0, $"single={single} twice={twice}");
    }

    [Fact]
    public void Read_UnknownAddress_Throws()
    {
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        engine.Update(Sid, WeekdayMorning);
        Assert.Throws<KeyNotFoundException>(() => engine.Read(Sid, "nope.value"));
        Assert.Throws<KeyNotFoundException>(() => engine.Read(Sid, "iws1.nope"));
        Assert.Throws<KeyNotFoundException>(() => engine.Read(Sid, "iws1"));
        Assert.Throws<KeyNotFoundException>(() => engine.Read(Sid, "htst1_outlet.kw"));
    }

    [Fact]
    public void Ambient_AlwaysMoves_StaysInBand()
    {
        var p = Def.Units.Single(u => u.Id == "pkg_room_temp").Ambient!;
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var values = new List<double>();
        for (var t = WeekdayMorning; t < WeekdayMorning.AddHours(1); t = t.AddSeconds(10))
        {
            engine.Update(Sid, t);
            values.Add(engine.Read(Sid, "pkg_room_temp.value"));
        }
        var differ = values.Zip(values.Skip(1)).Count(x => x.First != x.Second);
        Assert.True(differ >= 0.9 * (values.Count - 1), $"{differ}/{values.Count - 1} differ");
        var band = p.Amplitude + 4 * p.NoiseSd;
        Assert.All(values, v => Assert.InRange(v, p.Center - band, p.Center + band));
    }

    [Fact]
    public void Ambient_FollowsMachine()
    {
        using var a = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        a.Update(Sid, Sunday);
        Assert.Equal(0, a.Read(Sid, "iws1_motor_current.value"));

        using var b = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var running = FindRunning(b, "iws1", TimeSpan.Zero, TimeSpan.Zero, "iws1_film_jam");
        b.Update(Sid, running);
        Assert.True(b.Read(Sid, "iws1_motor_current.value") > 0);
        Assert.Equal(1, b.Read(Sid, "iws1.state"));
        Assert.Equal(420, b.Read(Sid, "iws1.speed"));
    }

    [Fact]
    public void Store_Events_AppendAndDrain()
    {
        var store = new ScenarioStateStore(NewDir());
        var t = WeekdayMorning;
        Parallel.For(0, 50, i => store.RequestEvent(Sid, $"e{i}", t.AddSeconds(i)));
        var drained = store.DrainEventRequests(Sid);
        Assert.Equal(50, drained.Count);
        Assert.Equal(Enumerable.Range(0, 50).Select(i => $"e{i}").Order(), drained.Select(d => d.EventId).Order());
        Assert.All(drained, d => Assert.Equal(DateTimeKind.Utc, d.RequestedUtc.Kind));
        Assert.Empty(store.DrainEventRequests(Sid));
    }

    [Fact]
    public void Store_SaveLoad_RoundTrips()
    {
        var store = new ScenarioStateStore(NewDir());
        Assert.Null(store.Load(Sid));
        var s = new ScenarioPersistedState(
            new() { ["iws1.good_count"] = 12.5 },
            new() { ["htst1_outlet"] = 72.9 },
            new() { ["htst_temp_drop"] = WeekdayMorning },
            WeekdayMorning);
        store.Save(Sid, s);
        var back = store.Load(Sid)!;
        Assert.Equal(12.5, back.Counters["iws1.good_count"]);
        Assert.Equal(72.9, back.Analogs["htst1_outlet"]);
        Assert.Equal(WeekdayMorning, back.ActiveEventsUntil["htst_temp_drop"]);
        Assert.Equal(DateTimeKind.Utc, back.LastUpdateUtc.Kind);
        Assert.Equal(WeekdayMorning, back.LastUpdateUtc);
    }

    // ---- Fix round 1 ----

    [Fact]
    public void Store_DrainEmptyExistingFile_LeavesItUntouched()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir);
        store.RequestEvent(Sid, "htst_temp_drop", WeekdayMorning);
        Assert.Single(store.DrainEventRequests(Sid));
        var path = Path.Combine(dir, "simulator", $"{Sid}.events.json");
        var stamp = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(path, stamp);
        Assert.Empty(store.DrainEventRequests(Sid));
        Assert.Equal(stamp, File.GetLastWriteTimeUtc(path));
    }

    [Fact]
    public void DrainedEvent_SurvivesCrash_WithoutDispose()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir);
        var a = new ScenarioEngine(store); // deliberately never disposed: simulates a crash
        a.Update(Sid, WeekdayMorning); // first update saves
        store.RequestEvent(Sid, "htst_temp_drop", WeekdayMorning.AddSeconds(1));
        a.Update(Sid, WeekdayMorning.AddSeconds(1)); // drains, well inside the 30 s throttle

        using var b = new ScenarioEngine(new ScenarioStateStore(dir));
        b.Update(Sid, WeekdayMorning.AddSeconds(2));
        Assert.Contains(b.Status(Sid, WeekdayMorning.AddSeconds(2)).ActiveEvents, e => e.Id == "htst_temp_drop");
    }

    [Fact]
    public void MachineModel_BucketCache_StaysBounded()
    {
        var m = Model("iws1");
        for (var t = WeekdayMorning; t < WeekdayMorning.AddDays(30); t = t.AddMinutes(1)) m.At(t);
        Assert.True(m.CachedBucketCount <= 6, $"cached={m.CachedBucketCount}");
        // eviction must not change results
        var fresh = Model("iws1");
        for (var t = WeekdayMorning; t < WeekdayMorning.AddDays(2); t = t.AddSeconds(37))
            Assert.Equal(fresh.At(t), m.At(t));
        Assert.True(m.ProducedBetween(WeekdayMorning, WeekdayMorning.AddHours(3)) ==
                    fresh.ProducedBetween(WeekdayMorning, WeekdayMorning.AddHours(3)));
    }

    [Fact]
    public void Meter_PlannedStopDrawsNothing()
    {
        using var a = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        a.Update(Sid, Sunday);
        var baseKw = Def.Units.Single(u => u.Id == "m_iws1").Meter!.BaseKw;
        Assert.Equal(baseKw, a.Read(Sid, "m_iws1.kw"), 6);
        var sundayMain = a.Read(Sid, "m_main.kw");

        using var b = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        b.Update(Sid, FindRunning(b, "iws1", TimeSpan.Zero, TimeSpan.Zero, null));
        var weekdayMain = b.Read(Sid, "m_main.kw");
        Assert.True(sundayMain < 0.6 * weekdayMain, $"sunday={sundayMain} weekday={weekdayMain}");
    }

    [Fact]
    public void Update_SaveFailure_DoesNotThrow_AndCleansTemp()
    {
        var dir = NewDir();
        var sim = Path.Combine(dir, "simulator");
        Directory.CreateDirectory(Path.Combine(sim, $"{Sid}.state.json")); // a directory where the file goes: Move fails
        var errors = new List<Exception>();
        using var engine = new ScenarioEngine(new ScenarioStateStore(dir), errors.Add);
        var t = FindRunning(engine, "iws1", TimeSpan.Zero, TimeSpan.FromMinutes(2), "iws1_film_jam");
        engine.Update(Sid, t);
        var g0 = engine.Read(Sid, "iws1.good_count");
        engine.Update(Sid, t.AddSeconds(1)); // retried: the failed save didn't count as saved
        engine.Update(Sid, t.AddMinutes(2));
        Assert.True(engine.Read(Sid, "iws1.good_count") > g0);
        Assert.True(errors.Count >= 2, $"errors={errors.Count}");
        Assert.Empty(Directory.GetFiles(sim, "*.tmp"));
    }

    [Fact]
    public void Update_DrainFailure_DoesNotThrow_AndRetriesNextTick()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir) { LockTimeout = TimeSpan.FromMilliseconds(50) };
        var errors = new List<Exception>();
        using var engine = new ScenarioEngine(store, errors.Add);
        var t = FindRunning(engine, "htst1", TimeSpan.Zero, TimeSpan.FromMinutes(1), "htst_temp_drop");
        engine.Update(Sid, t);
        store.RequestEvent(Sid, "htst_temp_drop", t);
        var path = Path.Combine(dir, "simulator", $"{Sid}.events.json");
        using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            engine.Update(Sid, t.AddSeconds(1)); // drain blocked by another holder
        }
        Assert.NotEmpty(errors);
        Assert.DoesNotContain(engine.Status(Sid, t.AddSeconds(1)).ActiveEvents, e => e.Id == "htst_temp_drop");
        engine.Update(Sid, t.AddSeconds(2));
        Assert.Contains(engine.Status(Sid, t.AddSeconds(2)).ActiveEvents, e => e.Id == "htst_temp_drop");
    }

    // ---- Final fix wave ----

    private static string StateFile(string dir) => Path.Combine(dir, "simulator", $"{Sid}.state.json");

    private static ScenarioPersistedState StateWith(double good, DateTime at) =>
        new(new() { ["iws1.good_count"] = good }, [], [], at);

    [Fact]
    public void Analog_StaysHot_DuringIdleMicroStop()
    {
        // R11: a 20-90 s micro-stop (Idle) must not cool the pasteuriser; only Fault and PlannedStop do.
        var m = Model("htst1");
        using var probe = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        DateTime? idleStart = null;
        for (var day = 0; day < 60 && idleStart is null; day++)
        {
            var dayStart = WeekdayMorning.AddDays(day);
            if ((dayStart + Offset).DayOfWeek == DayOfWeek.Sunday) continue;
            for (var t = dayStart; t < dayStart.AddHours(10); t = t.AddSeconds(5))
            {
                if (m.At(t).Mode != MachineMode.Idle) continue;
                var s = t;
                while (m.At(s.AddSeconds(-1)).Mode == MachineMode.Idle) s = s.AddSeconds(-1);
                if (RunningThroughout(m, s.AddMinutes(-5), s.AddSeconds(-1))
                    && NoScheduled(probe, "htst_temp_drop", s.AddMinutes(-5), s.AddMinutes(3)))
                {
                    idleStart = s;
                    break;
                }
                t = t.AddMinutes(2);
            }
        }
        Assert.NotNull(idleStart);

        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var idleSamples = 0;
        Step(engine, idleStart.Value.AddMinutes(-5), idleStart.Value.AddMinutes(2), now =>
        {
            if (m.At(now).Mode != MachineMode.Idle) return;
            idleSamples++;
            var v = engine.Read(Sid, "htst1_outlet.value");
            Assert.True(v >= 70, $"htst1_outlet fell to {v} during a micro-stop at {now:O}");
        });
        Assert.True(idleSamples >= 20, $"only {idleSamples} idle samples");
    }

    [Fact]
    public void Meter_Current_FollowsLoad()
    {
        Assert.Equal(["kw", "kwh", "pf", "current"], ScenarioCatalog.SignalsOf(Def.Units.Single(u => u.Id == "m_main")));
        Assert.DoesNotContain(Def.Units, u => u.Id == "m_main_current");
        Assert.Equal(400, Def.Units.Single(u => u.Id == "m_main_voltage").Ambient!.Center);

        using var probe = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var running = FindRunning(probe, "iws1", TimeSpan.Zero, TimeSpan.Zero, null);
        using var b = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        b.Update(Sid, running);
        var kw = b.Read(Sid, "m_main.kw");
        var pf = b.Read(Sid, "m_main.pf");
        var expected = kw * 1000 / (Math.Sqrt(3) * 400 * pf);
        var weekday = b.Read(Sid, "m_main.current");
        Assert.InRange(weekday, expected * 0.98, expected * 1.02);

        using var a = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        a.Update(Sid, Sunday);
        // m_main keeps the 24/7 utilities on Sunday (and a lower pf at low load); m_iws1 drops to its base load.
        var sunday = a.Read(Sid, "m_main.current");
        Assert.True(sunday > 0 && sunday < 0.75 * weekday, $"m_main sunday={sunday} weekday={weekday}");
        var iwsSunday = a.Read(Sid, "m_iws1.current");
        var iwsWeekday = b.Read(Sid, "m_iws1.current");
        Assert.True(iwsSunday > 0 && iwsSunday < 0.2 * iwsWeekday, $"m_iws1 sunday={iwsSunday} weekday={iwsWeekday}");
    }

    [Fact]
    public void Store_CorruptState_FallsBackToBak_AndMovesItAside()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir);
        store.Save(Sid, StateWith(111, WeekdayMorning));
        store.Save(Sid, StateWith(222, WeekdayMorning.AddMinutes(1))); // the first save becomes the .bak
        Assert.True(File.Exists(StateFile(dir) + ".bak"));
        File.WriteAllText(StateFile(dir), "{\"counters\":{\"iws1.good_co"); // torn write

        var errors = new List<Exception>();
        var back = store.Load(Sid, errors.Add);

        Assert.NotNull(back);
        Assert.Equal(111, back.Counters["iws1.good_count"]);
        Assert.False(File.Exists(StateFile(dir)));
        Assert.Single(Directory.GetFiles(Path.Combine(dir, "simulator"), $"{Sid}.state.json.corrupt-*"));
        Assert.Contains(errors, e => e is InvalidDataException);
    }

    [Fact]
    public void Store_EmptyState_NoBak_StartsFresh_AndReports()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir);
        Directory.CreateDirectory(Path.Combine(dir, "simulator"));
        File.WriteAllText(StateFile(dir), "");
        var errors = new List<Exception>();
        Assert.Null(store.Load(Sid, errors.Add));
        Assert.Single(errors);
        Assert.Single(Directory.GetFiles(Path.Combine(dir, "simulator"), $"{Sid}.state.json.corrupt-*"));
    }

    [Fact]
    public void Store_Save_KeepsPreviousAsBak()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir);
        store.Save(Sid, StateWith(1, WeekdayMorning));
        Assert.False(File.Exists(StateFile(dir) + ".bak")); // nothing to keep yet
        store.Save(Sid, StateWith(2, WeekdayMorning.AddMinutes(1)));
        Assert.Contains("\"iws1.good_count\":1", File.ReadAllText(StateFile(dir) + ".bak"));
        Assert.Contains("\"iws1.good_count\":2", File.ReadAllText(StateFile(dir)));
        Assert.Empty(Directory.GetFiles(Path.Combine(dir, "simulator"), "*.tmp"));
    }

    [Fact]
    public void Engine_CorruptState_ResumesFromBak()
    {
        var dir = NewDir();
        var store = new ScenarioStateStore(dir);
        store.Save(Sid, StateWith(50_000, WeekdayMorning));
        store.Save(Sid, StateWith(60_000, WeekdayMorning));
        File.WriteAllText(StateFile(dir), "not json");
        var errors = new List<Exception>();
        using var engine = new ScenarioEngine(new ScenarioStateStore(dir), errors.Add);
        engine.Update(Sid, WeekdayMorning.AddSeconds(1));
        Assert.True(engine.Read(Sid, "iws1.good_count") >= 50_000);
        Assert.Contains(errors, e => e is InvalidDataException);
    }

    [Fact]
    public void Gap_OverSevenDays_CatchesUpOnlyTheLastSevenDays()
    {
        // htst1 has no force_fault events, so its production is exactly the model's ProducedBetween.
        var errors = new List<Exception>();
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()), errors.Add);
        var t0 = WeekdayMorning;
        var t1 = t0.AddDays(30);
        engine.Update(Sid, t0);
        var g0 = engine.Read(Sid, "htst1.good_count");

        var sw = Stopwatch.StartNew();
        engine.Update(Sid, t1);
        sw.Stop();
        Assert.True(sw.Elapsed < TimeSpan.FromSeconds(5), $"30-day catch-up took {sw.Elapsed}");

        var expected = Model("htst1").ProducedBetween(t1 - ScenarioEngine.MaxCatchUp, t1) * (1 - 0.002);
        Assert.True(expected > 100_000, $"expected={expected}");
        Assert.InRange(engine.Read(Sid, "htst1.good_count") - g0, expected - 1, expected + 1);
        Assert.Contains(errors, e => e is ScenarioNotice);
        Assert.DoesNotContain(errors, e => e is not ScenarioNotice);
    }

    [Fact]
    public void BackwardsClockJump_NeverDecreasesACounter()
    {
        var counters = Def.Units
            .SelectMany(u => ScenarioCatalog.SignalsOf(u)
                .Where(s => s is "good_count" or "reject_count" or "kwh")
                .Select(s => $"{u.Id}.{s}"))
            .ToArray();
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var t = WeekdayMorning;
        engine.Update(Sid, t);
        engine.Update(Sid, t.AddMinutes(30));
        var before = counters.Select(c => engine.Read(Sid, c)).ToArray();

        var back = t.AddMinutes(10);
        engine.Update(Sid, back); // the clock went back 20 minutes
        var after = counters.Select(c => engine.Read(Sid, c)).ToArray();
        for (var i = 0; i < counters.Length; i++)
            Assert.True(after[i] >= before[i], $"{counters[i]} went {before[i]} -> {after[i]}");
        Assert.Equal(Model("htst1").At(back).Mode.ToString(),
            engine.Status(Sid, back).Units.Single(u => u.Id == "htst1").Mode);

        engine.Update(Sid, back.AddMinutes(5)); // production resumes from the new clock
        Assert.True(engine.Read(Sid, "m_main.kwh") > after[Array.IndexOf(counters, "m_main.kwh")]);
        for (var i = 0; i < counters.Length; i++)
            Assert.True(engine.Read(Sid, counters[i]) >= after[i], counters[i]);
    }

    [Fact]
    public void Load_IoFailureOnce_IsRetriedOnTheNextUpdate()
    {
        var dir = NewDir();
        new ScenarioStateStore(dir).Save(Sid, StateWith(70_000, WeekdayMorning));
        var errors = new List<Exception>();
        using var engine = new ScenarioEngine(new ScenarioStateStore(dir), errors.Add);
        using (new FileStream(StateFile(dir), FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            engine.Update(Sid, WeekdayMorning.AddSeconds(1)); // load fails: reported, not thrown
        }
        Assert.Contains(errors, e => e is IOException);

        engine.Update(Sid, WeekdayMorning.AddSeconds(2));
        Assert.True(engine.Read(Sid, "iws1.good_count") >= 70_000, "the retried load must pick up the saved counters");
    }

    [Fact]
    public void UnknownScenario_NeverCreatesARuntime()
    {
        using var engine = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        for (var i = 0; i < 5; i++)
        {
            Assert.Throws<KeyNotFoundException>(() => engine.Update($"nope-{i}", WeekdayMorning));
            Assert.Throws<KeyNotFoundException>(() => engine.Read($"nope-{i}", "iws1.state"));
        }
        Assert.Equal(0, engine.RuntimeCount);
        engine.Update(Sid, WeekdayMorning);
        Assert.Equal(1, engine.RuntimeCount);
    }

    [Fact]
    public void Update_TenTimesWithinASecond_IsOneStep()
    {
        string[] addrs = ["iws1.good_count", "htst1.good_count", "m_main.kwh", "m_iws1.kwh"];
        using var probe = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        var t = FindRunning(probe, "iws1", TimeSpan.Zero, TimeSpan.FromSeconds(5), null);

        using var single = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        single.Update(Sid, t);
        single.Update(Sid, t.AddSeconds(1));

        using var many = new ScenarioEngine(new ScenarioStateStore(NewDir()));
        many.Update(Sid, t);
        for (var k = 0; k < 10; k++) many.Update(Sid, t.AddSeconds(1).AddMilliseconds(k * 95));

        foreach (var a in addrs) Assert.Equal(single.Read(Sid, a), many.Read(Sid, a));

        many.Update(Sid, t.AddSeconds(2)); // a full second later the next step applies
        Assert.True(many.Read(Sid, "m_main.kwh") > single.Read(Sid, "m_main.kwh"));
    }
}
