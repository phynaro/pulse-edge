using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;

namespace Pulse.Edge.Api.Security;

public static class ForwardedHeadersConfig
{
    public static bool IsEnabled(IConfiguration config) =>
        config.GetValue("ForwardedHeaders:Enabled", false);

    public static ForwardedHeadersOptions Build(IConfiguration config)
    {
        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        };
        // Default lists include loopback; clear so ONLY explicitly-configured sources are trusted
        // (prevents X-Forwarded-For spoofing that would evade the per-IP login throttle).
        // KnownIPNetworks (System.Net.IPNetwork) is the non-obsolete replacement for KnownNetworks
        // (Microsoft.AspNetCore.HttpOverrides.IPNetwork) in .NET 10 — both share the same backing
        // list, so clearing/populating KnownIPNetworks is reflected in KnownNetworks too.
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();

        foreach (var proxy in config.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
            if (IPAddress.TryParse(proxy, out var ip)) options.KnownProxies.Add(ip);

        foreach (var network in config.GetSection("ForwardedHeaders:KnownNetworks").Get<string[]>() ?? [])
        {
            var parts = network.Split('/');
            if (parts.Length == 2 && IPAddress.TryParse(parts[0], out var prefix) && int.TryParse(parts[1], out var len))
                options.KnownIPNetworks.Add(new System.Net.IPNetwork(prefix, len));
        }
        return options;
    }
}
