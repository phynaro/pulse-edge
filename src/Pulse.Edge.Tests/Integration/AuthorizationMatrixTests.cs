using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class AuthorizationMatrixTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private enum Access
    {
        AdminMutation,      // anonymous 401; ReadOnly 403 (middleware mutation rule or handler)
        AdminRead,          // anonymous 401; ReadOnly 403 (handler IsInRole check)
        AuthenticatedRead,  // anonymous 401; ReadOnly must not be blocked (not 401/403)
        AuthenticatedAction,// anonymous 401; ReadOnly allowed; probed with a dedicated client (logout kills the session)
        StreamRead,         // anonymous 401; ReadOnly probe skipped (SSE response never completes)
        SetupWindowClosed,  // anonymous 401 once users exist; ReadOnly 409 (setup already completed)
        AnonymousLogin,     // wrong credentials -> handler 401 with error body (proves the endpoint is reachable anonymously)
        AnonymousReachable, // must not be blocked by authentication/authorization (any non-401/403 status)
    }

    // Every mapped endpoint must have exactly one row here ("METHOD /pattern").
    // The completeness guard fails when this table and the live route set diverge.
    private static readonly Dictionary<string, Access> Matrix = new(StringComparer.OrdinalIgnoreCase)
    {
        ["POST /api/settings/factory-reset"] = Access.AdminMutation,
        ["POST /api/settings/soft-reset"] = Access.AdminMutation,
        ["POST /api/settings/toggle-sync"] = Access.AdminMutation,
        ["POST /api/restores/configuration/inspect"] = Access.AdminMutation,
        ["POST /api/restores/configuration/apply"] = Access.AdminMutation,

        // --- Admin-only mutations (middleware: non-GET outside /api/auth, webhooks, ingest => Admin) ---
        ["POST /api/adapters"] = Access.AdminMutation,
        ["POST /api/adapters/power-meter"] = Access.AdminMutation,
        ["POST /api/adapters/test-connection"] = Access.AdminMutation,
        ["POST /api/adapters/opcua/discover"] = Access.AdminMutation,
        ["POST /api/adapters/opcua/browse"] = Access.AdminMutation,
        ["POST /api/adapters/discover-hosts"] = Access.AdminMutation,
        ["POST /api/adapters/mqtt/browse"] = Access.AdminMutation,
        ["POST /api/adapters/webhook/browse"] = Access.AdminMutation,
        ["POST /api/adapters/restapi/browse"] = Access.AdminMutation,
        ["POST /api/adapters/ethernetip/browse"] = Access.AdminMutation,
        ["POST /api/adapters/ethernetip/template"] = Access.AdminMutation,
        ["POST /api/adapters/ethernetip/program-tags"] = Access.AdminMutation,
        ["POST /api/adapters/siemens-s7/browse"] = Access.AdminMutation,
        ["POST /api/adapters/bacnet/browse"] = Access.AdminMutation,
        ["DELETE /api/adapters/{id}"] = Access.AdminMutation,
        ["POST /api/datasources"] = Access.AdminMutation,
        ["DELETE /api/datasources/{id}"] = Access.AdminMutation,
        ["POST /api/stream-templates"] = Access.AdminMutation,
        ["DELETE /api/stream-templates/{id}"] = Access.AdminMutation,
        ["POST /api/datapoints"] = Access.AdminMutation,
        ["DELETE /api/datapoints/{id}"] = Access.AdminMutation,
        ["DELETE /api/datapoints/hard/{id}"] = Access.AdminMutation,
        ["POST /api/datapoints/bulk-bind"] = Access.AdminMutation,
        ["POST /api/datapoints/poll/{id}"] = Access.AdminMutation,
        ["POST /api/mqtt-devices"] = Access.AdminMutation,
        ["DELETE /api/mqtt-devices/{id}"] = Access.AdminMutation,
        ["POST /api/diagnostic-logs/debug-capture"] = Access.AdminMutation,
        ["DELETE /api/diagnostic-logs/debug-capture"] = Access.AdminMutation,
        ["DELETE /api/diagnostic-logs"] = Access.AdminMutation,
        ["POST /api/settings"] = Access.AdminMutation,
        ["POST /api/settings/validate-cloud"] = Access.AdminMutation,
        ["POST /api/users"] = Access.AdminMutation,
        ["PUT /api/users/{id}"] = Access.AdminMutation,
        ["DELETE /api/users/{id}"] = Access.AdminMutation,
        ["POST /api/oee/channels"] = Access.AdminMutation,
        ["PUT /api/oee/channels/{id}"] = Access.AdminMutation,
        ["DELETE /api/oee/channels/{id}"] = Access.AdminMutation,

        // --- Admin-only reads (handler IsInRole check) ---
        ["GET /api/users"] = Access.AdminRead,
        ["GET /api/backups/configuration"] = Access.AdminRead,

        // --- Authenticated reads (ReadOnly allowed) ---
        ["GET /api/buffer/telemetry"] = Access.AuthenticatedRead,
        ["GET /api/adapters"] = Access.AuthenticatedRead,
        ["GET /api/adapters/templates/modbus-power-meters"] = Access.AuthenticatedRead,
        ["GET /api/auth/me"] = Access.AuthenticatedRead,
        ["GET /api/dashboard"] = Access.AuthenticatedRead,
        ["GET /api/diagnostics"] = Access.AuthenticatedRead,
        ["GET /api/datasources"] = Access.AuthenticatedRead,
        ["GET /api/stream-templates"] = Access.AuthenticatedRead,
        ["GET /api/datapoints"] = Access.AuthenticatedRead,
        ["GET /api/mqtt-devices"] = Access.AuthenticatedRead,
        ["GET /api/diagnostic-logs/debug-capture"] = Access.AuthenticatedRead,
        ["GET /api/diagnostic-logs/recent"] = Access.AuthenticatedRead,
        ["GET /api/diagnostic-logs/history"] = Access.AuthenticatedRead,
        ["GET /api/settings"] = Access.AuthenticatedRead,
        ["GET /api/settings/sync-status"] = Access.AuthenticatedRead,
        ["GET /api/oee/channels"] = Access.AuthenticatedRead,
        ["GET /api/oee/status"] = Access.AuthenticatedRead,
        ["GET /api/oee/outbox"] = Access.AuthenticatedRead,

        // --- Special cases ---
        ["POST /api/auth/logout"] = Access.AuthenticatedAction,
        ["GET /api/diagnostic-logs/stream"] = Access.StreamRead,
        ["POST /api/auth/first-admin"] = Access.SetupWindowClosed,
        ["POST /api/auth/login"] = Access.AnonymousLogin,
        ["GET /api/auth/setup-status"] = Access.AnonymousReachable,
        ["POST /api/webhooks/receive/{adapterId}"] = Access.AnonymousReachable,
        ["POST /api/diagnostic-logs/ingest"] = Access.AnonymousReachable, // loopback+key guarded in-handler; TestServer has no remote IP -> 404
        ["GET /health"] = Access.AnonymousReachable,
    };

    // Route patterns that are infrastructure, not API surface (filled in only if the
    // enumeration surfaces them; each entry needs a comment saying what it is).
    // Note: the test host runs MultiPort mode (PulseEdgeAppFactory), which maps the shared
    // /api route table but not SinglePort's SPA fallback/static files — the guard therefore
    // covers the security-relevant API surface; SinglePort adds no additional API endpoints.
    private static readonly string[] ExcludedPatterns = [];

    private List<(string Method, string Pattern)> LiveEndpoints()
    {
        var endpoints = new List<(string, string)>();
        foreach (var endpoint in factory.Services.GetServices<EndpointDataSource>()
                     .SelectMany(s => s.Endpoints).OfType<RouteEndpoint>())
        {
            var pattern = "/" + (endpoint.RoutePattern.RawText ?? "").TrimStart('/');
            if (ExcludedPatterns.Contains(pattern, StringComparer.OrdinalIgnoreCase)) continue;
            var methods = endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"];
            foreach (var method in methods) endpoints.Add((method, pattern));
        }
        return endpoints;
    }

    private static string Key(string method, string pattern) => $"{method.ToUpperInvariant()} {pattern}";

    // "/api/adapters/{id}" -> "/api/adapters/matrix-probe"
    private static string ProbeUrl(string pattern) => Regex.Replace(pattern, "\\{[^}]+\\}", "matrix-probe");

    [Fact]
    public void Every_endpoint_is_classified_and_every_classification_is_live()
    {
        var live = LiveEndpoints().Select(e => Key(e.Method, e.Pattern)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var unclassified = live.Except(Matrix.Keys, StringComparer.OrdinalIgnoreCase).Order().ToList();
        var dead = Matrix.Keys.Except(live, StringComparer.OrdinalIgnoreCase).Order().ToList();

        Assert.True(unclassified.Count == 0 && dead.Count == 0,
            (unclassified.Count > 0 ? "Endpoints with no authorization classification:\n  " + string.Join("\n  ", unclassified) + "\n" : "") +
            (dead.Count > 0 ? "Classified endpoints that no longer exist:\n  " + string.Join("\n  ", dead) : ""));
    }

    [Fact]
    public async Task Anonymous_requests_are_rejected_on_every_protected_endpoint()
    {
        await factory.ResetDatabaseAsync();
        // Seed a user so the app is operational (the anonymous setup window is closed).
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var anonymous = factory.CreateClient();

        var failures = new List<string>();
        foreach (var (method, pattern) in LiveEndpoints())
        {
            var access = Matrix[Key(method, pattern)];
            using var request = new HttpRequestMessage(new HttpMethod(method), ProbeUrl(pattern));
            if (method is "POST" or "PUT") request.Content = JsonContent.Create(new { });
            if (access == Access.AnonymousLogin)
                request.Content = JsonContent.Create(new { Username = TestCredentials.NonexistentUsername, Password = TestCredentials.Password });

            var response = await anonymous.SendAsync(request);
            var ok = access switch
            {
                Access.AnonymousReachable => response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden),
                Access.AnonymousLogin => response.StatusCode == HttpStatusCode.Unauthorized &&
                    (await response.Content.ReadAsStringAsync()).Contains("Invalid username or password"),
                _ => response.StatusCode == HttpStatusCode.Unauthorized,
            };
            if (!ok) failures.Add($"{Key(method, pattern)} [{access}] -> {(int)response.StatusCode}");
        }

        Assert.True(failures.Count == 0, "Anonymous matrix failures:\n  " + string.Join("\n  ", failures));
    }

    [Fact]
    public async Task ReadOnly_users_cannot_mutate_or_read_admin_data_on_any_endpoint()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var readOnly = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);

        var failures = new List<string>();
        foreach (var (method, pattern) in LiveEndpoints())
        {
            var access = Matrix[Key(method, pattern)];
            // Not meaningful for ReadOnly (anonymous-only semantics or non-terminating stream).
            if (access is Access.AnonymousLogin or Access.AnonymousReachable or Access.StreamRead) continue;

            // Logout terminates the session it runs on — give it its own client.
            var client = access == Access.AuthenticatedAction
                ? await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyActionUsername, TestCredentials.Password)
                : readOnly;

            using var request = new HttpRequestMessage(new HttpMethod(method), ProbeUrl(pattern));
            if (method is "POST" or "PUT") request.Content = JsonContent.Create(new { });

            var response = await client.SendAsync(request);
            var ok = access switch
            {
                Access.AdminMutation or Access.AdminRead => response.StatusCode == HttpStatusCode.Forbidden,
                Access.SetupWindowClosed => response.StatusCode == HttpStatusCode.Conflict, // first admin already exists
                _ => response.StatusCode is not (HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden),
            };
            if (!ok) failures.Add($"{Key(method, pattern)} [{access}] -> {(int)response.StatusCode}");
        }

        Assert.True(failures.Count == 0, "ReadOnly matrix failures:\n  " + string.Join("\n  ", failures));
    }
}
