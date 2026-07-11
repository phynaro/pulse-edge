using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using System.Security.Claims;

namespace Pulse.Edge.Api.Security;

public sealed class CurrentUserValidationMiddleware(RequestDelegate next)
{
    private static readonly string[] AnonymousApiPaths =
    [
        "/api/auth/login", "/api/auth/setup-status", "/api/auth/first-admin",
        "/api/settings", "/api/settings/validate-cloud", "/api/dashboard", "/api/webhooks/receive/",
        "/api/diagnostic-logs/ingest"
    ];

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/api"))
        {
            await next(context);
            return;
        }

        var path = context.Request.Path.Value ?? "";
        var isAnonymousCandidate = AnonymousApiPaths.Any(p => p.EndsWith('/') ? path.StartsWith(p, StringComparison.OrdinalIgnoreCase) : path.Equals(p, StringComparison.OrdinalIgnoreCase));
        var isInternalIngest = path.Equals("/api/diagnostic-logs/ingest", StringComparison.OrdinalIgnoreCase);

        using var db = new QueueDbContext();
        var hasUsers = await db.LocalUsers.AnyAsync();

        if (context.User.Identity?.IsAuthenticated == true)
        {
            var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = await db.LocalUsers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.IsEnabled);
            var claimedRole = context.User.FindFirstValue(ClaimTypes.Role);
            if (user == null || !string.Equals(user.Role, claimedRole, StringComparison.Ordinal))
            {
                await context.SignOutAsync();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }

        if (!isAnonymousCandidate && context.User.Identity?.IsAuthenticated != true)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (isAnonymousCandidate && hasUsers && context.User.Identity?.IsAuthenticated != true &&
            !path.Equals("/api/auth/login", StringComparison.OrdinalIgnoreCase) &&
            !path.Equals("/api/auth/setup-status", StringComparison.OrdinalIgnoreCase) &&
            !isInternalIngest &&
            !path.StartsWith("/api/webhooks/receive/", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var isMutation = !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method);
        var isAuthAction = path.StartsWith("/api/auth/", StringComparison.OrdinalIgnoreCase);
        var isWebhook = path.StartsWith("/api/webhooks/receive/", StringComparison.OrdinalIgnoreCase);
        var isInitialSetup = !hasUsers && isAnonymousCandidate;
        if (isMutation && !isAuthAction && !isWebhook && !isInternalIngest && !isInitialSetup && !context.User.IsInRole("Admin"))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }
}
