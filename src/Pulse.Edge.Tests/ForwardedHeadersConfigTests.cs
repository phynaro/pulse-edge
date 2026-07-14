using System.Net;
using Microsoft.Extensions.Configuration;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class ForwardedHeadersConfigTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    [Fact]
    public void IsEnabled_defaults_to_false()
    {
        Assert.False(ForwardedHeadersConfig.IsEnabled(Config(new())));
    }

    [Fact]
    public void Build_trusts_only_the_configured_known_proxy()
    {
        var config = Config(new()
        {
            ["ForwardedHeaders:Enabled"] = "true",
            ["ForwardedHeaders:KnownProxies:0"] = "10.0.0.5",
        });

        var options = ForwardedHeadersConfig.Build(config);

        Assert.Contains(IPAddress.Parse("10.0.0.5"), options.KnownProxies);
    }

    [Fact]
    public void Build_with_no_known_sources_trusts_nothing()
    {
        var config = Config(new() { ["ForwardedHeaders:Enabled"] = "true" });

        var options = ForwardedHeadersConfig.Build(config);

        Assert.Empty(options.KnownProxies);
        // KnownNetworks (Microsoft.AspNetCore.HttpOverrides.IPNetwork) is obsolete in .NET 10 in
        // favor of KnownIPNetworks (System.Net.IPNetwork); both share the same backing list, so
        // asserting on KnownIPNetworks avoids triggering the warnings-as-errors build gate.
        Assert.Empty(options.KnownIPNetworks);
    }
}
