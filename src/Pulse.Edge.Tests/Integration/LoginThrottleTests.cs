using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

// A dedicated factory with a LOW login limit so the throttle can be exercised in a few
// requests. It is its own host instance, so its rate-limiter state never leaks into the
// functional test classes (which use the base factory's high limit).
public sealed class ThrottledAppFactory : PulseEdgeAppFactory
{
    protected override int LoginPermitLimit => 5;
}

[Collection("EdgeApi")]
public sealed class LoginThrottleTests(ThrottledAppFactory factory) : IClassFixture<ThrottledAppFactory>
{
    [Fact]
    public async Task Repeated_login_attempts_from_one_ip_are_throttled_with_429()
    {
        // Under the in-memory TestServer, HttpContext.Connection.RemoteIpAddress is null,
        // so every request in this test process falls into the single "unknown" rate-limit
        // partition. This test therefore proves the limiter fires on a burst — it does NOT
        // prove that distinct real IPs get isolated into separate partitions.
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        // Unknown username so per-account lockout never applies; only the IP throttle
        // (PermitLimit = 5) can trip. Requests 1–5 return 401; the 6th must be 429.
        HttpStatusCode last = HttpStatusCode.OK;
        for (int i = 0; i < 6; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/login",
                new { Username = TestCredentials.NonexistentUsername, Password = TestCredentials.Password });
            last = response.StatusCode;
        }

        Assert.Equal((HttpStatusCode)429, last);
    }
}
