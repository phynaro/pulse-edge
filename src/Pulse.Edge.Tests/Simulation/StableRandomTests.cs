using Pulse.Edge.Agent.Simulation;
using Xunit;

namespace Pulse.Edge.Tests.Simulation;

public class StableRandomTests
{
    [Fact]
    public void Hash_IsStableAcrossCalls()
    {
        Assert.Equal(4420162721083401894UL, StableRandom.Hash("iws1|2026-10-21T10"));
        Assert.Equal(4420162721083401894UL, StableRandom.Hash("iws1|2026-10-21T10"));
    }

    [Fact]
    public void Hash_MatchesKnownFnv1a64Vectors()
    {
        Assert.Equal(14695981039346656037UL, StableRandom.Hash(""));
        Assert.Equal(12638187200555641996UL, StableRandom.Hash("a"));
    }

    [Fact]
    public void Hash_MatchesIndependentFnv1aLoop()
    {
        ulong h = 14695981039346656037UL;
        foreach (var b in System.Text.Encoding.UTF8.GetBytes("iws1|2026-10-21T10"))
        {
            h ^= b;
            h = unchecked(h * 1099511628211UL);
        }
        Assert.Equal(h, StableRandom.Hash("iws1|2026-10-21T10"));
    }

    [Fact]
    public void For_SameParts_SameSequence()
    {
        var a = StableRandom.For("iws1", "10");
        var b = StableRandom.For("iws1", "10");
        for (var i = 0; i < 5; i++) Assert.Equal(a.NextDouble(), b.NextDouble());
    }

    [Fact]
    public void For_DifferentParts_DifferentSequence()
    {
        Assert.NotEqual(StableRandom.For("iws1", "10").NextDouble(), StableRandom.For("iws2", "10").NextDouble());
    }

    [Fact]
    public void NextDouble_InRange()
    {
        var r = new StableRandom(42);
        for (var i = 0; i < 10_000; i++)
        {
            var v = r.NextDouble();
            Assert.InRange(v, 0.0, 1.0);
            Assert.True(v < 1.0);
        }
    }
}
