using Pulse.Edge.Api.Diagnostics;

namespace Pulse.Edge.Tests;

public sealed class DiagnosticRedactionTests
{
    [Theory]
    [InlineData("Using ApiKey=abc123secretvalue to connect", "abc123secretvalue")]
    [InlineData("token: pair-tok-9999", "pair-tok-9999")]
    [InlineData("claim secret=claim-zzz stored", "claim-zzz")]
    [InlineData("credential=cloud-cred-4242", "cloud-cred-4242")]
    public void Sanitize_redacts_labelled_cloud_credentials(string message, string secret)
    {
        var result = DiagnosticLogService.Sanitize(message, 2_000);
        Assert.DoesNotContain(secret, result);
    }
}
