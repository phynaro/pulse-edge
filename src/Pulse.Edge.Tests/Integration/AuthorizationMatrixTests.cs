using System.Net;
using System.Net.Http.Json;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class AuthorizationMatrixTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    // Admin-only mutating endpoints that must reject anonymous (401) and ReadOnly (403).
    public static IEnumerable<object[]> AdminOnlyMutations() =>
    [
        ["/api/settings/factory-reset"],
        ["/api/settings/soft-reset"],
        ["/api/settings/toggle-sync"],
        ["/api/restores/configuration/inspect"],
        ["/api/restores/configuration/apply"],
    ];

    [Theory]
    [MemberData(nameof(AdminOnlyMutations))]
    public async Task Anonymous_cannot_call_admin_mutation(string path)
    {
        await factory.ResetDatabaseAsync();
        // Make the app operational so anonymous mutations are not treated as initial setup.
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var anonymous = factory.CreateClient();
        var response = await anonymous.PostAsJsonAsync(path, new { });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(AdminOnlyMutations))]
    public async Task ReadOnly_cannot_call_admin_mutation(string path)
    {
        await factory.ResetDatabaseAsync();
        // An Admin must exist first (the ReadOnly seed only adds a ReadOnly user).
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var readOnly = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);

        var response = await readOnly.PostAsJsonAsync(path, new { });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
