using System.Linq;
using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class HarnessSmokeTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    [Fact]
    public async Task Health_endpoint_responds_over_the_test_host()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Protected_endpoint_rejects_anonymous_after_a_user_exists()
    {
        await factory.ResetDatabaseAsync();
        // Seed one user so the app is "operational" (hasUsers == true).
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var anonymous = factory.CreateClient();
        var response = await anonymous.GetAsync("/api/adapters");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Security_headers_are_present_on_responses()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/health");

        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
    }

    [Fact]
    public async Task Security_headers_survive_an_unauthorized_short_circuit()
    {
        await factory.ResetDatabaseAsync();
        // Seed one user so the app is "operational" (hasUsers == true).
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var anon = factory.CreateClient();
        var response = await anon.GetAsync("/api/adapters");

        // CurrentUserValidationMiddleware short-circuits (sets 401 and returns without
        // calling next) before reaching the endpoint. SecurityHeadersMiddleware is
        // registered earlier in the pipeline, so its headers must still be on the
        // response even though the request never reached the protected endpoint.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
    }

    [Fact]
    public async Task Login_issues_a_secure_session_cookie()
    {
        await factory.ResetDatabaseAsync();
        // CreateClientLoggedInAsync seeds the user; log in again to inspect Set-Cookie.
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.Password });

        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies));
        Assert.Contains(cookies!, c =>
            c.Contains("pulse.edge.session") && c.Contains("secure", StringComparison.OrdinalIgnoreCase));
    }
}
