using System.Net;
using System.Net.Security;

namespace Pulse.Edge.Agent.Services;

/// <summary>
/// TLS trust policy for HTTP clients that talk to this machine's own API over its
/// self-signed certificate (Slice 2B local HTTPS). A certificate that fails normal
/// validation is accepted only when the request targets a loopback address; any other
/// host keeps full chain validation, so this policy can never be used to reach a
/// remote server with an untrusted certificate.
/// </summary>
public static class LoopbackCertificateTrust
{
    public static bool Validate(HttpRequestMessage request, SslPolicyErrors errors)
    {
        if (errors == SslPolicyErrors.None) return true;
        return IsLoopbackHost(request.RequestUri?.Host);
    }

    private static bool IsLoopbackHost(string? host)
    {
        if (string.IsNullOrWhiteSpace(host)) return false;
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
        return IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
    }
}
