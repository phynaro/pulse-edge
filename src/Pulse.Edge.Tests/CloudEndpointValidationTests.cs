using Pulse.Edge.Cloud.Services;

namespace Pulse.Edge.Tests;

public sealed class CloudEndpointValidationTests
{
    [Theory]
    [InlineData("https://cloud.example.com", true)]
    [InlineData("https://cloud.example.com:8443/api", true)]
    [InlineData("http://localhost:3000", true)]
    [InlineData("http://127.0.0.1:3000", true)]
    [InlineData("http://[::1]:3000", true)]
    [InlineData("http://cloud.example.com", false)]
    [InlineData("http://192.168.1.50:3000", false)]
    [InlineData("ftp://cloud.example.com", false)]
    [InlineData("not-a-url", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void IsAcceptableCloudEndpoint_enforces_https_except_loopback(string? url, bool expected)
    {
        Assert.Equal(expected, CloudClient.IsAcceptableCloudEndpoint(url));
    }
}
