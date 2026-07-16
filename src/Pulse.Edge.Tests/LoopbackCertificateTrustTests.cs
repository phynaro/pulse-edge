using System.Net.Security;
using Pulse.Edge.Agent.Services;

namespace Pulse.Edge.Tests;

public sealed class LoopbackCertificateTrustTests
{
    [Theory]
    [InlineData("https://127.0.0.1:5288/api/diagnostic-logs/ingest", true)]
    [InlineData("https://localhost:5288/api/diagnostic-logs/ingest", true)]
    [InlineData("https://[::1]:5288/api/diagnostic-logs/ingest", true)]
    [InlineData("https://pulse.example.com/api/diagnostic-logs/ingest", false)]
    [InlineData("https://192.168.1.10:5288/api/diagnostic-logs/ingest", false)]
    public void Invalid_certificate_is_trusted_only_for_loopback_hosts(string url, bool expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        Assert.Equal(expected, LoopbackCertificateTrust.Validate(request, SslPolicyErrors.RemoteCertificateChainErrors));
    }

    [Fact]
    public void Valid_certificate_chain_is_trusted_for_any_host()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://pulse.example.com/x");
        Assert.True(LoopbackCertificateTrust.Validate(request, SslPolicyErrors.None));
    }

    [Fact]
    public void Request_without_a_uri_is_not_trusted()
    {
        using var request = new HttpRequestMessage();
        Assert.False(LoopbackCertificateTrust.Validate(request, SslPolicyErrors.RemoteCertificateChainErrors));
    }
}
