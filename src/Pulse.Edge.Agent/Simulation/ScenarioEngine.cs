using System.Collections.Concurrent;
using System.Globalization;

namespace Pulse.Edge.Agent.Simulation;

public sealed record ScenarioStatus(IReadOnlyList<UnitStatus> Units, IReadOnlyList<ActiveEvent> ActiveEvents);

/// <summary>Mode: machines report their MachineMode; analog/ambient report "Event" while an event acts on them,
/// else the followed machine's mode (or "Running"); meters report "Running". Value: the last computed
/// value/kW (null for machines and before the first update).</summary>
public sealed record UnitStatus(string Id, string Kind, string Mode, double? Value);

public sealed record ActiveEvent(string Id, DateTime UntilUtc);

/// <summary>
/// Runs scenarios: advances counters, analogs and meters on each <see cref="Update"/>, applies presenter
/// and scheduled events, and persists through <see cref="ScenarioStateStore"/> (at most every 30 s of
/// scenario time, immediately after draining event requests, plus on Dispose). IO failures in saving or
/// draining never escape Update: they go to <c>onError</c> (default no-op) and are retried next tick.
/// Machine modes, noise and scheduled events are pure functions of time,
/// so a restart resumes the same plant. One lock per scenario.
/// </summary>
public sealed class ScenarioEngine(ScenarioStateStore store, Action<Exception>? onError = null) : IDisposable
{
    private static readonly TimeSpan SaveInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan LongGap = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan GapSubStep = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<string, Lazy<Runtime>> _runtimes = new(StringComparer.Ordinal);

    public void Update(string scenarioId, DateTime nowUtc)
    {
        var rt = Get(scenarioId);
        lock (rt.Gate)
        {
            var drained = rt.Update(store, nowUtc, onError);
            // Save right after a non-empty drain: the requests are gone from disk, so a crash before
            // the next periodic save would otherwise lose them.
            if (drained || rt.LastSaveUtc is not { } saved || (nowUtc - saved).Duration() >= SaveInterval)
            {
                try
                {
                    store.Save(scenarioId, rt.Snapshot());
                    rt.LastSaveUtc = nowUtc;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    onError?.Invoke(ex); // LastSaveUtc unchanged: retried on the next tick
                }
            }
        }
    }

    /// <summary>Value of <c>&lt;unitId&gt;.&lt;signal&gt;</c> as of the last Update.</summary>
    public double Read(string scenarioId, string address)
    {
        var rt = Get(scenarioId);
        lock (rt.Gate)
        {
            if (!rt.AddressIndex.TryGetValue(address, out var i))
                throw new KeyNotFoundException($"Unknown address '{address}' in scenario '{scenarioId}'.");
            if (rt.LastUpdateUtc is null)
                throw new InvalidOperationException($"Scenario '{scenarioId}' has not been updated yet.");
            return rt.Values[i];
        }
    }

    public ScenarioStatus Status(string scenarioId, DateTime nowUtc)
    {
        var rt = Get(scenarioId);
        lock (rt.Gate) return rt.Status(nowUtc);
    }

    /// <summary>The scheduled (daily-draw) start of an event on a scenario-local date, or null when it doesn't fire.</summary>
    public DateTime? ScheduledStartUtc(string scenarioId, string eventId, DateOnly localDate)
    {
        var rt = Get(scenarioId);
        lock (rt.Gate)
        {
            if (!rt.EventById.TryGetValue(eventId, out var ev))
                throw new KeyNotFoundException($"Unknown event '{eventId}' in scenario '{scenarioId}'.");
            return rt.ScheduledStart(ev, localDate);
        }
    }

    public void Dispose()
    {
        foreach (var (id, lazy) in _runtimes)
        {
            if (!lazy.IsValueCreated) continue;
            var rt = lazy.Value;
            lock (rt.Gate)
            {
                if (rt.LastUpdateUtc is null) continue;
                try { store.Save(id, rt.Snapshot()); }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    onError?.Invoke(ex); // best effort on shutdown; the last periodic save stands
                }
            }
        }
    }

    private Runtime Get(string scenarioId) =>
        _runtimes.GetOrAdd(scenarioId, id => new Lazy<Runtime>(() => new Runtime(id, store.Load(id)))).Value;

    private sealed class Runtime
    {
        public readonly object Gate = new();
        public readonly string Id;
        public readonly ScenarioDefinition Def;
        public readonly TimeSpan Offset;
        public readonly UnitDefinition[] Units;
        public readonly Dictionary<string, int> UnitIndex = new(StringComparer.Ordinal);
        public readonly Dictionary<string, int> AddressIndex = new(StringComparer.Ordinal);
        public readonly Dictionary<string, EventDefinition> EventById = new(StringComparer.Ordinal);
        public double[] Values;
        public DateTime? LastUpdateUtc;
        public DateTime? LastSaveUtc;

        private readonly MachineStateModel?[] _models;
        private readonly int[] _valueBase; // first value slot of each unit
        private readonly int[] _followIdx; // followed machine index or -1 (analog/ambient)
        private readonly int[][] _feeds; // meter → fed machine indices
        private readonly double[] _phase; // ambient
        private readonly EventDefinition[][] _eventsOnUnit;
        private readonly (int Weekday, int StartMin, int EndMin)[] _shiftWindows;
        private readonly Dictionary<(string, DateOnly), DateTime?> _scheduleCache = [];

        private readonly Dictionary<string, double> _counters;
        private readonly Dictionary<string, double> _analogs;
        private readonly Dictionary<string, DateTime> _activeUntil;

        // per-tick scratch
        private readonly MachineSnapshot[] _modeNow;

        public Runtime(string id, ScenarioPersistedState? persisted)
        {
            Id = id;
            Def = ScenarioCatalog.Load(id);
            Offset = ParseOffset(Def.UtcOffset);
            Units = Def.Units.ToArray();
            _models = new MachineStateModel?[Units.Length];
            _valueBase = new int[Units.Length];
            _followIdx = new int[Units.Length];
            _feeds = new int[Units.Length][];
            _phase = new double[Units.Length];
            _eventsOnUnit = new EventDefinition[Units.Length][];
            _modeNow = new MachineSnapshot[Units.Length];

            for (var i = 0; i < Units.Length; i++) UnitIndex[Units[i].Id] = i;
            var slot = 0;
            for (var i = 0; i < Units.Length; i++)
            {
                var u = Units[i];
                _valueBase[i] = slot;
                foreach (var sig in ScenarioCatalog.SignalsOf(u)) AddressIndex[$"{u.Id}.{sig}"] = slot++;
                if (u.Kind == "machine") _models[i] = new MachineStateModel(id, u, Def.Shifts, Offset);
                var follows = u.Analog?.FollowsUnit ?? u.Ambient?.FollowsUnit;
                _followIdx[i] = follows is not null && UnitIndex.TryGetValue(follows, out var f) ? f : -1;
                _feeds[i] = u.Meter?.Feeds.Where(UnitIndex.ContainsKey).Select(x => UnitIndex[x]).ToArray() ?? [];
                if (u.Kind == "ambient")
                    _phase[i] = 2 * Math.PI * StableRandom.For(id, u.Id, "phase").NextDouble();
            }
            Values = new double[slot];
            foreach (var e in Def.Events) EventById[e.Id] = e;
            for (var i = 0; i < Units.Length; i++)
                _eventsOnUnit[i] = Def.Events.Where(e => e.Unit == Units[i].Id && Units[i].Kind != "ambient").ToArray();
            _shiftWindows = Def.Shifts.Windows
                .SelectMany(w => w.Weekdays.Select(d => (d, Minutes(w.Start), Minutes(w.End))))
                .ToArray();

            _counters = persisted?.Counters is { } c ? new(c) : [];
            _analogs = persisted?.Analogs is { } a ? new(a) : [];
            _activeUntil = persisted?.ActiveEventsUntil is { } ae ? new(ae) : [];
            LastUpdateUtc = persisted?.LastUpdateUtc;
        }

        public ScenarioPersistedState Snapshot() =>
            new(new(_counters), new(_analogs), new(_activeUntil), LastUpdateUtc ?? DateTime.MinValue);

        /// <summary>Advances the scenario to <paramref name="now"/>; returns true when event requests were drained.</summary>
        public bool Update(ScenarioStateStore store, DateTime now, Action<Exception>? onError)
        {
            now = AsUtc(now);
            IReadOnlyList<(string EventId, DateTime RequestedUtc)> requests;
            try
            {
                requests = store.DrainEventRequests(Id);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                onError?.Invoke(ex); // the requests stay on disk; drained on a later tick
                requests = [];
            }
            foreach (var (eventId, requested) in requests)
            {
                if (!EventById.TryGetValue(eventId, out var ev)) continue; // unknown id: ignore
                var until = requested.AddMinutes(ev.DurationMinutes);
                _activeUntil[eventId] = _activeUntil.TryGetValue(eventId, out var cur) && cur > until ? cur : until;
            }

            var last = LastUpdateUtc;
            var dt = last is { } l ? now - l : TimeSpan.Zero;
            var advancing = dt > TimeSpan.Zero;

            for (var i = 0; i < Units.Length; i++)
                if (_models[i] is not null) _modeNow[i] = EffectiveMode(i, now);

            // Machines: instantaneous signals + counters.
            for (var i = 0; i < Units.Length; i++)
            {
                var m = Units[i].Machine;
                if (m is null) continue;
                var u = Units[i];
                var good = Counter($"{u.Id}.good_count", 0);
                var reject = Counter($"{u.Id}.reject_count", 0);
                if (advancing)
                {
                    var produced = ProducedExcludingForced(i, last!.Value, now);
                    good += produced * (1 - m.RejectFraction);
                    reject += produced * m.RejectFraction;
                    _counters[$"{u.Id}.good_count"] = good;
                    _counters[$"{u.Id}.reject_count"] = reject;
                }
                var snap = _modeNow[i];
                var b = _valueBase[i];
                Values[b + 0] = snap.Mode == MachineMode.Running ? 1 : 0;
                Values[b + 1] = snap.Mode == MachineMode.Fault ? 1 : 0;
                Values[b + 2] = snap.Mode == MachineMode.Fault ? snap.FaultCode : 0;
                Values[b + 3] = Math.Floor(good);
                Values[b + 4] = Math.Floor(reject);
                Values[b + 5] = snap.Mode == MachineMode.Running ? m.RatePerMin : 0;
            }

            for (var i = 0; i < Units.Length; i++)
            {
                var u = Units[i];
                var b = _valueBase[i];
                switch (u.Kind)
                {
                    case "analog":
                    {
                        var p = u.Analog!;
                        var target = AnalogTarget(i, now);
                        if (last is null || !_analogs.TryGetValue(u.Id, out var x))
                            x = target; // first run starts settled
                        else if (advancing)
                            x += (target - x) * (1 - Math.Exp(-dt.TotalSeconds / Math.Max(p.TauSeconds, 1e-6)));
                        _analogs[u.Id] = x;
                        Values[b] = x + Noise(u.Id, now, p.NoiseSd);
                        break;
                    }
                    case "ambient":
                    {
                        var p = u.Ambient!;
                        var f = _followIdx[i];
                        if (f >= 0 && _modeNow[f].Mode != MachineMode.Running)
                        {
                            Values[b] = p.StoppedValue ?? 0;
                            break;
                        }
                        var minutes = (now.Ticks - DateTime.UnixEpoch.Ticks) / (double)TimeSpan.TicksPerMinute;
                        Values[b] = p.Center
                            + p.Amplitude * Math.Sin(2 * Math.PI * minutes / p.PeriodMinutes + _phase[i])
                            + Noise(u.Id, now, p.NoiseSd);
                        break;
                    }
                    case "meter":
                    {
                        var p = u.Meter!;
                        var kw = MeterKw(i, now, useCurrent: true);
                        var key = $"{u.Id}.kwh";
                        var kwh = Counter(key, p.StartKwh);
                        if (advancing)
                        {
                            if (dt <= LongGap)
                            {
                                kwh += kw * dt.TotalHours;
                            }
                            else
                            {
                                for (var t = last!.Value; t < now; t += GapSubStep)
                                {
                                    var end = t + GapSubStep < now ? t + GapSubStep : now;
                                    kwh += MeterKw(i, t, useCurrent: false) * (end - t).TotalHours;
                                }
                            }
                        }
                        _counters[key] = kwh;
                        var full = p.BaseKw + _feeds[i].Sum(f => Units[f].Machine!.RunningKw);
                        var load = full > 0 ? Math.Clamp(kw / full, 0, 1) : 0;
                        Values[b + 0] = kw;
                        Values[b + 1] = kwh;
                        Values[b + 2] = p.PfAtLowLoad + (p.PfAtFullLoad - p.PfAtLowLoad) * load;
                        break;
                    }
                }
            }

            foreach (var k in _activeUntil.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList())
                _activeUntil.Remove(k);
            if (last is null || advancing) LastUpdateUtc = now;
            return requests.Count > 0;
        }

        public ScenarioStatus Status(DateTime now)
        {
            now = AsUtc(now);
            var units = new List<UnitStatus>(Units.Length);
            for (var i = 0; i < Units.Length; i++)
            {
                var u = Units[i];
                double? value = LastUpdateUtc is null || u.Kind == "machine" ? null : Values[_valueBase[i]];
                string mode;
                if (_models[i] is not null) mode = EffectiveMode(i, now).Mode.ToString();
                else if (_eventsOnUnit[i].Any(e => ActiveWindow(e, now) is not null)) mode = "Event";
                else if (_followIdx[i] >= 0) mode = EffectiveMode(_followIdx[i], now).Mode.ToString();
                else mode = "Running";
                units.Add(new UnitStatus(u.Id, u.Kind, mode, value));
            }
            var active = Def.Events
                .Select(e => (e.Id, Window: ActiveWindow(e, now)))
                .Where(x => x.Window is not null)
                .Select(x => new ActiveEvent(x.Id, x.Window!.Value.Until))
                .ToList();
            return new ScenarioStatus(units, active);
        }

        private double Counter(string key, double initial)
        {
            if (_counters.TryGetValue(key, out var v)) return v;
            _counters[key] = initial;
            return initial;
        }

        private MachineSnapshot EffectiveMode(int machineIdx, DateTime t)
        {
            foreach (var e in _eventsOnUnit[machineIdx])
                if (e.Effect == "force_fault" && ActiveWindow(e, t) is not null)
                    return new MachineSnapshot(MachineMode.Fault, e.FaultCode ?? 0);
            return _models[machineIdx]!.At(t);
        }

        private double AnalogTarget(int i, DateTime t)
        {
            var p = Units[i].Analog!;
            var f = _followIdx[i];
            var target = f >= 0 && _modeNow[f].Mode != MachineMode.Running ? p.StoppedValue ?? p.Setpoint : p.Setpoint;
            foreach (var e in _eventsOnUnit[i])
            {
                if (ActiveWindow(e, t) is not { } w) continue;
                if (e.Effect == "offset") target += e.Magnitude;
                else if (e.Effect == "ramp" && e.DurationMinutes > 0)
                    target += e.Magnitude * Math.Clamp((t - w.Start).TotalMinutes / e.DurationMinutes, 0, 1);
            }
            return target;
        }

        private double MeterKw(int i, DateTime t, bool useCurrent)
        {
            var kw = Units[i].Meter!.BaseKw;
            foreach (var f in _feeds[i])
            {
                var mode = useCurrent ? _modeNow[f].Mode : EffectiveMode(f, t).Mode;
                var m = Units[f].Machine!;
                kw += mode switch
                {
                    MachineMode.Running => m.RunningKw,
                    MachineMode.PlannedStop => 0, // switched off outside shifts
                    _ => m.IdleKw, // Idle and Fault stay energised
                };
            }
            return kw;
        }

        /// <summary>The window [Start, Until) of an event that is active at t (presenter request or scheduled draw), or null.</summary>
        private (DateTime Start, DateTime Until)? ActiveWindow(EventDefinition e, DateTime t)
        {
            (DateTime, DateTime)? best = null;
            var dur = TimeSpan.FromMinutes(e.DurationMinutes);
            if (_activeUntil.TryGetValue(e.Id, out var until) && t >= until - dur && t < until)
                best = (until - dur, until);
            var today = DateOnly.FromDateTime(t + Offset);
            for (var d = today.AddDays(-1); d <= today; d = d.AddDays(1))
            {
                if (ScheduledStart(e, d) is not { } s || t < s || t >= s + dur) continue;
                if (best is null || s + dur > best.Value.Item2) best = (s, s + dur);
            }
            return best;
        }

        public DateTime? ScheduledStart(EventDefinition e, DateOnly localDate)
        {
            if (_scheduleCache.TryGetValue((e.Id, localDate), out var cached)) return cached;
            DateTime? result = null;
            var dateKey = localDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var rng = StableRandom.For(Id, e.Id, dateKey);
            if (rng.NextDouble() < e.DailyProbability)
            {
                var minutes = ShiftMinutes((int)localDate.DayOfWeek);
                if (minutes.Count > 0)
                {
                    var minute = minutes[Math.Min((int)(rng.NextDouble() * minutes.Count), minutes.Count - 1)];
                    var localStart = localDate.ToDateTime(TimeOnly.MinValue).AddMinutes(minute);
                    result = DateTime.SpecifyKind(localStart - Offset, DateTimeKind.Utc);
                }
            }
            _scheduleCache[(e.Id, localDate)] = result;
            return result;
        }

        /// <summary>Local minutes-of-day [0,1440) inside a shift that starts on this weekday (0 = Sunday).</summary>
        private List<int> ShiftMinutes(int weekday)
        {
            var set = new SortedSet<int>();
            foreach (var (wd, s, e) in _shiftWindows)
            {
                if (wd != weekday) continue;
                var end = s < e ? e : 1440; // a window crossing midnight contributes its pre-midnight part
                for (var m = s; m < end; m++) set.Add(m);
            }
            return set.ToList();
        }

        /// <summary>ProducedBetween over [from, to) minus the part of it covered by force_fault events.</summary>
        private double ProducedExcludingForced(int i, DateTime from, DateTime to)
        {
            var model = _models[i]!;
            var produced = model.ProducedBetween(from, to);
            var forced = new List<(DateTime S, DateTime E)>();
            foreach (var e in _eventsOnUnit[i])
            {
                if (e.Effect != "force_fault") continue;
                var dur = TimeSpan.FromMinutes(e.DurationMinutes);
                if (_activeUntil.TryGetValue(e.Id, out var until)) forced.Add((until - dur, until));
                var d0 = DateOnly.FromDateTime(from + Offset).AddDays(-1);
                var d1 = DateOnly.FromDateTime(to + Offset);
                for (var d = d0; d <= d1; d = d.AddDays(1))
                    if (ScheduledStart(e, d) is { } s) forced.Add((s, s + dur));
            }
            if (forced.Count == 0) return produced;

            var clipped = forced
                .Select(x => (S: x.S > from ? x.S : from, E: x.E < to ? x.E : to))
                .Where(x => x.E > x.S)
                .OrderBy(x => x.S)
                .ToList();
            var merged = new List<(DateTime S, DateTime E)>();
            foreach (var x in clipped)
            {
                if (merged.Count > 0 && x.S <= merged[^1].E)
                    merged[^1] = (merged[^1].S, x.E > merged[^1].E ? x.E : merged[^1].E);
                else merged.Add(x);
            }
            foreach (var (s, e) in merged) produced -= model.ProducedBetween(s, e);
            return Math.Max(0, produced);
        }

        private double Noise(string unitId, DateTime t, double sd)
        {
            if (sd <= 0) return 0;
            var secs = (t.Ticks - DateTime.UnixEpoch.Ticks) / TimeSpan.TicksPerSecond;
            return StableRandom.For(Id, unitId, "s:" + secs.ToString(CultureInfo.InvariantCulture)).NextNormal(0, sd);
        }

        private static int Minutes(string hhmm)
        {
            var parts = hhmm.Split(':');
            return int.Parse(parts[0], CultureInfo.InvariantCulture) * 60 + int.Parse(parts[1], CultureInfo.InvariantCulture);
        }

        private static TimeSpan ParseOffset(string s)
        {
            var sign = s.StartsWith('-') ? -1 : 1;
            var body = s.TrimStart('+', '-');
            return sign * TimeSpan.ParseExact(body, @"hh\:mm", CultureInfo.InvariantCulture);
        }

        private static DateTime AsUtc(DateTime d) => d.Kind switch
        {
            DateTimeKind.Utc => d,
            DateTimeKind.Local => d.ToUniversalTime(),
            _ => DateTime.SpecifyKind(d, DateTimeKind.Utc),
        };
    }
}
