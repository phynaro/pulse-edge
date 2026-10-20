using System.Collections.Concurrent;
using System.Globalization;

namespace Pulse.Edge.Agent.Simulation;

public enum MachineMode { Running, Idle, Fault, PlannedStop }

public readonly record struct MachineSnapshot(MachineMode Mode, int FaultCode);

/// <summary>
/// Deterministic machine mode as a pure function of time. Time is cut into scenario-local hour
/// buckets; each bucket's faults and micro-stops are drawn once from
/// <c>StableRandom.For(scenarioId, unit.Id, "yyyy-MM-ddTHH")</c> and cached, so units are
/// independent and results survive restarts. Precedence: PlannedStop, Fault, Idle (micro-stop), Running.
/// </summary>
public sealed class MachineStateModel(string scenarioId, UnitDefinition unit, ShiftCalendar shifts, TimeSpan utcOffset)
{
    private const double MinFaultMinutes = 2, MaxFaultMinutes = 90;
    private const double MinMicroSeconds = 20, MaxMicroSeconds = 90;
    private const int LookbackBuckets = 2; // a 90 min fault can span into the bucket after next

    private readonly MachineParams _p = unit.Machine
        ?? throw new ArgumentException($"Unit '{unit.Id}' has no machine params", nameof(unit));

    private readonly ConcurrentDictionary<long, Bucket> _buckets = new();
    private readonly (int Weekday, int StartMin, int EndMin)[] _windows = ExpandShifts(shifts);

    private sealed record Bucket(long[] FaultStart, long[] FaultEnd, int[] FaultCode, long[] MicroStart, long[] MicroEnd);

    private static (int, int, int)[] ExpandShifts(ShiftCalendar cal)
    {
        var list = new List<(int, int, int)>();
        foreach (var w in cal.Windows)
            foreach (var d in w.Weekdays)
                list.Add((d, ParseMinutes(w.Start), ParseMinutes(w.End)));
        return list.ToArray();
    }

    private static int ParseMinutes(string hhmm)
    {
        var parts = hhmm.Split(':');
        return int.Parse(parts[0], CultureInfo.InvariantCulture) * 60 + int.Parse(parts[1], CultureInfo.InvariantCulture);
    }

    public MachineSnapshot At(DateTime utc)
    {
        var ticks = utc.Ticks;
        if (_p.FollowsShifts && !InShift(ticks))
            return new MachineSnapshot(MachineMode.PlannedStop, 0);

        var hour = HourIndex(ticks);
        for (var h = hour; h >= hour - LookbackBuckets; h--)
        {
            var b = GetBucket(h);
            for (var i = 0; i < b.FaultStart.Length; i++)
                if (ticks >= b.FaultStart[i] && ticks < b.FaultEnd[i])
                    return new MachineSnapshot(MachineMode.Fault, b.FaultCode[i]);
        }
        for (var h = hour; h >= hour - 1; h--)
        {
            var b = GetBucket(h);
            for (var i = 0; i < b.MicroStart.Length; i++)
                if (ticks >= b.MicroStart[i] && ticks < b.MicroEnd[i])
                    return new MachineSnapshot(MachineMode.Idle, 0);
        }
        return new MachineSnapshot(MachineMode.Running, 0);
    }

    /// <summary>
    /// Pieces produced in [fromUtc, toUtc): RatePerMin/60 for every whole UTC second s (from &lt;= s &lt; to)
    /// at which the machine is Running. Partitioning on whole seconds makes it exactly additive.
    /// </summary>
    public double ProducedBetween(DateTime fromUtc, DateTime toUtc)
    {
        if (toUtc <= fromUtc) return 0;
        const long perSec = TimeSpan.TicksPerSecond;
        var first = (fromUtc.Ticks + perSec - 1) / perSec;
        var last = (toUtc.Ticks + perSec - 1) / perSec; // exclusive
        long running = 0;
        for (var s = first; s < last; s++)
            if (At(new DateTime(s * perSec, DateTimeKind.Utc)).Mode == MachineMode.Running)
                running++;
        return running * _p.RatePerMin / 60.0;
    }

    private bool InShift(long utcTicks)
    {
        var local = new DateTime(utcTicks + utcOffset.Ticks);
        var minute = local.Hour * 60 + local.Minute;
        var day = (int)local.DayOfWeek;
        var prevDay = (day + 6) % 7;
        foreach (var (wd, s, e) in _windows)
        {
            if (s < e)
            {
                if (wd == day && minute >= s && minute < e) return true;
            }
            else if (s > e) // crosses midnight
            {
                if (wd == day && minute >= s) return true;
                if (wd == prevDay && minute < e) return true;
            }
        }
        return false;
    }

    private long HourIndex(long utcTicks) =>
        (long)Math.Floor((double)(utcTicks + utcOffset.Ticks) / TimeSpan.TicksPerHour);

    private Bucket GetBucket(long hourIndex) => _buckets.GetOrAdd(hourIndex, Build);

    private Bucket Build(long hourIndex)
    {
        var startUtcTicks = hourIndex * TimeSpan.TicksPerHour - utcOffset.Ticks;
        var localStart = new DateTime(hourIndex * TimeSpan.TicksPerHour);
        var key = localStart.ToString("yyyy-MM-ddTHH", CultureInfo.InvariantCulture);
        var rng = StableRandom.For(scenarioId, unit.Id, key);

        var faultCount = _p.MtbfMinutes > 0 ? Poisson(rng, 60.0 / _p.MtbfMinutes) : 0;
        var fs = new long[faultCount];
        var fe = new long[faultCount];
        var fc = new int[faultCount];
        for (var i = 0; i < faultCount; i++)
        {
            var offset = rng.NextDouble() * TimeSpan.TicksPerHour;
            var mins = Math.Clamp(rng.NextExponential(_p.MttrMinutes), MinFaultMinutes, MaxFaultMinutes);
            var codeRoll = rng.NextDouble();
            fs[i] = startUtcTicks + (long)offset;
            fe[i] = fs[i] + (long)(mins * TimeSpan.TicksPerMinute);
            fc[i] = _p.FaultCodes.Length == 0 ? 0 : _p.FaultCodes[(int)(codeRoll * _p.FaultCodes.Length)];
        }

        var microCount = _p.MicroStopsPerHour > 0 ? Poisson(rng, _p.MicroStopsPerHour) : 0;
        var ms = new long[microCount];
        var me = new long[microCount];
        for (var i = 0; i < microCount; i++)
        {
            var offset = rng.NextDouble() * TimeSpan.TicksPerHour;
            var secs = MinMicroSeconds + rng.NextDouble() * (MaxMicroSeconds - MinMicroSeconds);
            ms[i] = startUtcTicks + (long)offset;
            me[i] = ms[i] + (long)(secs * TimeSpan.TicksPerSecond);
        }
        return new Bucket(fs, fe, fc, ms, me);
    }

    private static int Poisson(StableRandom rng, double mean)
    {
        var l = Math.Exp(-mean);
        var k = 0;
        var p = 1.0;
        do
        {
            k++;
            p *= rng.NextDouble();
        } while (p > l && k < 64);
        return k - 1;
    }
}
