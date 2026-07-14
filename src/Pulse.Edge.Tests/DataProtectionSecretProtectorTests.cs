using Microsoft.AspNetCore.DataProtection;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class DataProtectionSecretProtectorTests
{
    private static DataProtectionSecretProtector NewProtector()
        => new(DataProtectionProvider.Create("pulse-edge-tests"));

    [Fact]
    public void Protect_then_Unprotect_round_trips()
    {
        var p = NewProtector();
        var cipher = p.Protect("super-secret-api-key");

        Assert.NotEqual("super-secret-api-key", cipher);
        Assert.True(p.IsProtected(cipher));
        Assert.Equal("super-secret-api-key", p.Unprotect(cipher));
    }

    [Fact]
    public void Unprotect_passes_through_legacy_plaintext()
    {
        var p = NewProtector();
        // A value that was never protected (legacy row) must come back unchanged.
        Assert.Equal("legacy-plaintext", p.Unprotect("legacy-plaintext"));
        Assert.False(p.IsProtected("legacy-plaintext"));
    }

    [Fact]
    public void Empty_stays_empty()
    {
        var p = NewProtector();
        Assert.Equal("", p.Protect(""));
        Assert.Equal("", p.Unprotect(""));
    }
}
