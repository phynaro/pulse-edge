using Microsoft.AspNetCore.Http;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class SecurityHeadersMiddlewareTests
{
    [Fact]
    public async Task Sets_the_expected_security_headers()
    {
        var context = new DefaultHttpContext();
        var middleware = new SecurityHeadersMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(context);

        Assert.Equal("nosniff", context.Response.Headers["X-Content-Type-Options"]);
        Assert.Equal("DENY", context.Response.Headers["X-Frame-Options"]);
        Assert.Equal("no-referrer", context.Response.Headers["Referrer-Policy"]);
        Assert.Contains("default-src 'self'", context.Response.Headers["Content-Security-Policy"].ToString());
    }
}
