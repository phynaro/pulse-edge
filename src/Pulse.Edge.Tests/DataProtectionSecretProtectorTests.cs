using Microsoft.AspNetCore.DataProtection;
using Pulse.Edge.Agent.Security;

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

    [Fact]
    public void Ciphertext_interops_across_separate_provider_instances_sharing_a_key_directory()
    {
        // Regression test for the shared-key-ring contract (B-07 fix wave 1): the Api process
        // and the Agent process (MultiPort mode) each construct their own IDataProtectionProvider
        // via DataProtectionProvider.Create(sameDirectory, b => b.SetApplicationName("pulse-edge")).
        // They must be interchangeable — ciphertext written by one must be readable by the other —
        // or cloud sync in MultiPort mode breaks the moment the Agent tries to reuse a credential
        // the Api encrypted (or vice versa). Simulate that here with two independently-constructed
        // providers over the same on-disk key directory, standing in for the two processes.
        var keyDir = Directory.CreateTempSubdirectory("pulse-edge-dp-interop-test-");
        try
        {
            var apiSideProtector = new DataProtectionSecretProtector(
                DataProtectionProvider.Create(keyDir, b => b.SetApplicationName("pulse-edge")));
            var agentSideProtector = new DataProtectionSecretProtector(
                DataProtectionProvider.Create(keyDir, b => b.SetApplicationName("pulse-edge")));

            var cipher = apiSideProtector.Protect("shared-key-ring-round-trip");

            Assert.NotEqual("shared-key-ring-round-trip", cipher);
            Assert.Equal("shared-key-ring-round-trip", agentSideProtector.Unprotect(cipher));
            Assert.True(agentSideProtector.IsProtected(cipher));
        }
        finally
        {
            keyDir.Delete(recursive: true);
        }
    }
}
