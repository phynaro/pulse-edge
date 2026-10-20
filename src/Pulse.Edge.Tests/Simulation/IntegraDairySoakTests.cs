using System.Diagnostics;
using Pulse.Edge.Agent.Simulation;

namespace Pulse.Edge.Tests.Simulation;

/// <summary>One simulated week of Integra Dairy at 10 s steps: nothing may go insane.</summary>
public sealed class IntegraDairySoakTests : IDisposable
{
    private const string Sid = "integra-dairy";
    private static readonly TimeSpan Step = TimeSpan.FromSeconds(10);

    // Noise is Gaussian, so it has no hard edge. A week is ~60k steps x 90 ambient units = 5.4M samples; at 4 sigma
    // (6e-5 per sample) hundreds would stray, at 6 sigma (2e-9) essentially none do.
    private const double NoiseSigmas = 6;

    // Monday 2026-09-07 00:00 local (+07:00) = Sunday 2026-09-06 17:00 UTC.
    private static readonly DateTime Start = new(2026, 9, 6, 17, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime End = Start.AddDays(7);

    private readonly string _dir =
        Path.Combine(Path.GetTempPath(), "pulse-scenario-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    [Fact]
    public void IntegraDairy_SevenDays_Sane()
    {
        Directory.CreateDirectory(_dir);
        var def = ScenarioCatalog.Load(Sid);
        var errors = new List<Exception>();
        using var engine = new ScenarioEngine(new ScenarioStateStore(_dir), errors.Add);
        var failures = new List<string>();

        void Fail(string msg)
        {
            if (failures.Count < 20) failures.Add(msg);
        }

        // Monotonic counters: every good_count / reject_count, and every meter's kwh.
        var counters = def.Units
            .SelectMany(u => ScenarioCatalog.SignalsOf(u)
                .Where(s => s is "good_count" or "reject_count" or "kwh")
                .Select(s => $"{u.Id}.{s}"))
            .ToArray();
        var lastCounter = new double[counters.Length];
        Array.Fill(lastCounter, double.NegativeInfinity);

        (string Addr, double Min, double Max)[] bounds =
        [
            ("cold1_temp.value", 0, 15),
            ("blr1_pressure.value", 0, 12),
            ("m_main.kw", 40, 900),
        ];

        // Ambient units wander gently around Center while their followed machine runs
        // (or always, when they follow nothing); otherwise they sit at StoppedValue.
        // The HTST outlet is only a pasteurising temperature while the line runs: when stopped it cools to
        // its stopped value (20 C) and after a restart it warms up over a few minutes (tau 60 s). So the
        // 60-80 C band applies after 10 minutes of continuous running; 0-80 C holds always.
        var htstRunningSteps = 0;
        var warmedUpAfter = (int)(TimeSpan.FromMinutes(10) / Step);

        var ambients = def.Units.Where(u => u.Kind == "ambient").ToArray();

        var fired = def.Events.ToDictionary(e => e.Id, _ => 0);
        var wasActive = def.Events.ToDictionary(e => e.Id, _ => false);

        var sw = Stopwatch.StartNew();
        var stepNo = 0;
        for (var t = Start; t < End; t = t + Step, stepNo++)
        {
            engine.Update(Sid, t);

            for (var i = 0; i < counters.Length; i++)
            {
                var v = engine.Read(Sid, counters[i]);
                if (v < lastCounter[i]) Fail($"{counters[i]} went backwards at {t:O}: {lastCounter[i]} -> {v}");
                lastCounter[i] = v;
            }

            foreach (var (addr, min, max) in bounds)
            {
                var v = engine.Read(Sid, addr);
                if (double.IsNaN(v) || v < min || v > max) Fail($"{addr} = {v} outside [{min}, {max}] at {t:O}");
            }

            var htst = engine.Read(Sid, "htst1_outlet.value");
            htstRunningSteps = engine.Read(Sid, "htst1.state") == 1 ? htstRunningSteps + 1 : 0;
            if (htst < 0 || htst > 80) Fail($"htst1_outlet.value = {htst} outside [0, 80] at {t:O}");
            else if (htstRunningSteps > warmedUpAfter && htst < 60)
                Fail($"htst1_outlet.value = {htst} below 60 after 10 min running at {t:O}");

            foreach (var u in ambients)
            {
                var p = u.Ambient!;
                var v = engine.Read(Sid, $"{u.Id}.value");
                var running = p.FollowsUnit is null || engine.Read(Sid, $"{p.FollowsUnit}.state") == 1;
                if (running)
                {
                    var half = p.Amplitude + NoiseSigmas * p.NoiseSd;
                    if (Math.Abs(v - p.Center) > half) Fail($"{u.Id} = {v} outside {p.Center} +/- {half:F3} at {t:O}");
                }
                else if (Math.Abs(v - (p.StoppedValue ?? 0)) > 1e-9)
                {
                    Fail($"{u.Id} = {v} but its machine is stopped (expected {p.StoppedValue ?? 0}) at {t:O}");
                }
            }

            // Events last at least 8 minutes, so a once-a-minute sample cannot miss one.
            if (stepNo % 6 == 0)
            {
                var active = engine.Status(Sid, t).ActiveEvents.Select(a => a.Id).ToHashSet();
                foreach (var id in fired.Keys.ToArray())
                {
                    var on = active.Contains(id);
                    if (on && !wasActive[id]) fired[id]++;
                    wasActive[id] = on;
                }
            }
        }
        sw.Stop();
        Console.WriteLine($"Soak: {stepNo} steps in {sw.Elapsed.TotalSeconds:F1}s; events fired: " +
                          string.Join(", ", fired.Select(kv => $"{kv.Key}={kv.Value}")));

        // Windows scanners/indexers briefly lock the state file now and then; the engine reports those to
        // onError and retries next tick (by design). Anything else would be a real fault.
        Console.WriteLine($"Soak: {errors.Count} transient state-file IO errors tolerated");
        Assert.DoesNotContain(errors, e => e is not (IOException or UnauthorizedAccessException));
        Assert.True(failures.Count == 0, string.Join(Environment.NewLine, failures));
        foreach (var (id, count) in fired)
            Assert.True(count >= 1, $"event '{id}' never fired in 7 days");
    }
}
