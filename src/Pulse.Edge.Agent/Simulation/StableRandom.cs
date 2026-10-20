using System.Text;

namespace Pulse.Edge.Agent.Simulation;

/// <summary>
/// Deterministic, restart-stable randomness. Seeds come from an FNV-1a hash of the key parts
/// (never <c>GetHashCode()</c>, which is randomized per process); the generator is SplitMix64.
/// </summary>
public sealed class StableRandom(ulong seed)
{
    private ulong _state = seed;

    /// <summary>FNV-1a 64-bit hash over the UTF-8 bytes of <paramref name="key"/>.</summary>
    public static ulong Hash(string key)
    {
        var h = 14695981039346656037UL;
        foreach (var b in Encoding.UTF8.GetBytes(key))
        {
            h ^= b;
            h = unchecked(h * 1099511628211UL);
        }
        return h;
    }

    /// <summary>Seeds a generator from <c>Hash(string.Join("|", parts))</c>.</summary>
    public static StableRandom For(params string[] parts) => new(Hash(string.Join("|", parts)));

    private ulong NextUInt64()
    {
        unchecked
        {
            _state += 0x9E3779B97F4A7C15UL;
            var z = _state;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }
    }

    /// <summary>Uniform value in [0,1) with 53 bits of precision.</summary>
    public double NextDouble() => (NextUInt64() >> 11) * (1.0 / (1UL << 53));

    /// <summary>Exponentially distributed value with the given mean.</summary>
    public double NextExponential(double mean) => -mean * Math.Log(1.0 - NextDouble());

    /// <summary>Normally distributed value (Box-Muller).</summary>
    public double NextNormal(double mean, double sd)
    {
        var u1 = 1.0 - NextDouble(); // (0,1] so Log is finite
        var u2 = NextDouble();
        return mean + sd * Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);
    }
}
