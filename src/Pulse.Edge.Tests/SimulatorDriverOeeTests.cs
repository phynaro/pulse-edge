using System;
using Pulse.Edge.Agent;
using Pulse.Edge.Storage;
using Xunit;

namespace Pulse.Edge.Tests;

public class SimulatorDriverOeeTests
{
    [Fact]
    public void RejectCount_IsCumulative_AndAddressResolves()
    {
        var driver = new SimulatorDriver();
        var adapterId = "sim-oee-test";
        using var db = new QueueDbContext();

        // Two updates 100 simulated seconds apart. UpdateState derives running/idle/fault
        // from (t % 300): <240 running. Shift t1 until the whole 100 s window is inside
        // the running phase so production (and rejects) must accumulate — deterministic.
        var t1 = new DateTime(2026, 7, 18, 0, 0, 0, DateTimeKind.Utc);
        while (((t1.Ticks / 10000000.0) % 300.0) >= 140.0) { t1 = t1.AddSeconds(10); }
        var t2 = t1.AddSeconds(100);
        driver.UpdateState(adapterId, "production", t1, db);
        driver.UpdateState(adapterId, "production", t2, db);

        var reject = driver.ReadValue(adapterId, "reject_count");
        var total = driver.ReadValue(adapterId, "total_count");
        Assert.True(total > 10000.0, $"total_count should have accumulated, got {total}");
        Assert.True(reject > 0.0, $"reject_count should have accumulated, got {reject}");
        Assert.True(reject < total);

        // Cumulative totalizer: a later read never decreases.
        driver.UpdateState(adapterId, "production", t2.AddSeconds(50), db);
        Assert.True(driver.ReadValue(adapterId, "reject_count") >= reject);
    }
}
