using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class BackupHardeningTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private async Task<HttpClient> AdminClientAsync()
    {
        await factory.ResetDatabaseAsync();
        return await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
    }

    private static async Task<JsonNode> ExportAsync(HttpClient admin)
    {
        var response = await admin.GetAsync("/api/backups/configuration");
        response.EnsureSuccessStatusCode();
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
    }

    private static StringContent AsJson(JsonNode document) =>
        new(document.ToJsonString(), Encoding.UTF8, "application/json");

    private static async Task AssertRejectedAsync(HttpClient admin, HttpContent content, string expectedError)
    {
        var response = await admin.PostAsync("/api/restores/configuration/apply", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        if (expectedError.Length > 0)
            Assert.Contains(expectedError, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Backup_export_contains_no_cloud_credentials()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => { c.ApiKey = "cloud-key-xyz"; c.ClaimSecret = "claim-xyz"; c.PairingToken = "pair-xyz"; });
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.GetAsync("/api/backups/configuration");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync();

        Assert.DoesNotContain("cloud-key-xyz", body);
        Assert.DoesNotContain("claim-xyz", body);
        Assert.DoesNotContain("pair-xyz", body);
    }

    [Fact]
    public async Task Oversized_restore_body_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        // 6 MB of JSON, over the 5 MB cap.
        var huge = "{\"junk\":\"" + new string('a', 6 * 1024 * 1024) + "\"}";
        var content = new StringContent(huge, Encoding.UTF8, "application/json");
        var response = await admin.PostAsync("/api/restores/configuration/apply", content);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode); // 413
    }

    [Fact]
    public async Task Oversized_chunked_restore_body_without_content_length_is_rejected()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.SendAsync(BuildChunkedOversizedRequest("/api/restores/configuration/apply"));

        // No Content-Length header is present (Transfer-Encoding: chunked), so a check that only
        // inspects Content-Length would let this through. The body still exceeds the cap and must
        // be rejected before it is buffered/parsed.
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode); // 413
    }

    [Fact]
    public async Task Oversized_chunked_restore_body_is_rejected_on_inspect()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await admin.SendAsync(BuildChunkedOversizedRequest("/api/restores/configuration/inspect"));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode); // 413
    }

    [Fact]
    public async Task Valid_restore_body_round_trips_successfully()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        // A real, well-under-cap backup document exported from the running instance -- confirms
        // the size-guard middleware buffers small bodies correctly and hands them on to normal
        // model binding rather than only ever rejecting.
        var exportResponse = await admin.GetAsync("/api/backups/configuration");
        exportResponse.EnsureSuccessStatusCode();
        var backupJson = await exportResponse.Content.ReadAsStringAsync();

        var content = new StringContent(backupJson, Encoding.UTF8, "application/json");
        var response = await admin.PostAsync("/api/restores/configuration/apply", content);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("/api/backups/configuration")]
    [InlineData("/api/restores/configuration/inspect")]
    [InlineData("/api/restores/configuration/apply")]
    public void Backup_and_restore_endpoints_declare_authorization_metadata(string path)
    {
        // Defense in depth: CurrentUserValidationMiddleware already rejects anonymous /api calls,
        // but these endpoints must also carry their own authorization requirement so a future
        // change to the middleware's path handling cannot silently expose them.
        var endpoint = factory.Services.GetServices<EndpointDataSource>()
            .SelectMany(s => s.Endpoints)
            .OfType<RouteEndpoint>()
            .Single(e => string.Equals("/" + (e.RoutePattern.RawText ?? "").TrimStart('/'), path, StringComparison.OrdinalIgnoreCase));

        Assert.NotNull(endpoint.Metadata.GetMetadata<IAuthorizeData>());
    }

    [Fact]
    public async Task Non_json_restore_body_is_rejected_as_bad_request()
    {
        var admin = await AdminClientAsync();
        // Declared as JSON but unparseable — must be a clean 400 from model binding, not a 500.
        var content = new StringContent("this is not json", Encoding.UTF8, "application/json");
        await AssertRejectedAsync(admin, content, expectedError: "");
    }

    [Fact]
    public async Task Document_with_wrong_format_is_rejected()
    {
        var admin = await AdminClientAsync();
        var document = await ExportAsync(admin);
        document["format"] = "some-other-file-format";
        await AssertRejectedAsync(admin, AsJson(document), "not a PULSE Edge configuration backup");
    }

    [Fact]
    public async Task Document_with_unsupported_format_version_is_rejected()
    {
        var admin = await AdminClientAsync();
        var document = await ExportAsync(admin);
        document["formatVersion"] = 99;
        await AssertRejectedAsync(admin, AsJson(document), "Unsupported backup format version");
    }

    [Fact]
    public async Task Document_with_missing_configuration_payload_is_rejected()
    {
        var admin = await AdminClientAsync();
        var document = await ExportAsync(admin);
        document["configuration"] = null;
        await AssertRejectedAsync(admin, AsJson(document), "configuration payload is missing");
    }

    [Fact]
    public async Task Document_with_missing_collection_is_rejected()
    {
        var admin = await AdminClientAsync();
        var document = await ExportAsync(admin);
        document["configuration"]!["adapters"] = null;
        await AssertRejectedAsync(admin, AsJson(document), "required configuration collections are missing");
    }

    private static JsonNode TamperedExport(JsonNode export)
    {
        // Mutate the configuration payload but keep the exported (now stale) checksum.
        // The checksum only covers the configuration payload, so this simulates an attacker
        // or corruption editing the backup contents.
        var tampered = export.DeepClone();
        tampered["configuration"]!["adapters"] = new JsonArray(new JsonObject
        {
            ["id"] = "tampered-adapter",
            ["name"] = "Tampered",
            ["protocol"] = "Simulator",
            ["host"] = "localhost",
            ["port"] = 0,
            ["configJson"] = "{}",
            ["isEnabled"] = false,
            ["status"] = "Disconnected",
        });
        return tampered;
    }

    [Fact]
    public async Task Tampered_configuration_with_stale_checksum_is_rejected()
    {
        var admin = await AdminClientAsync();
        var tampered = TamperedExport(await ExportAsync(admin));
        await AssertRejectedAsync(admin, AsJson(tampered), "checksum does not match");
    }

    [Fact]
    public async Task Document_with_dangling_reference_is_rejected()
    {
        var admin = await AdminClientAsync();
        var document = (await ExportAsync(admin)).DeepClone();
        // A data point that references an adapter which is not in the backup. (The mutation also
        // invalidates the checksum; Validate accumulates errors, so the referential error is
        // still reported and is what this test asserts.)
        document["configuration"]!["dataPoints"] = new JsonArray(new JsonObject
        {
            ["id"] = "dangling-tag",
            ["adapterId"] = "no-such-adapter",
            ["metric"] = "m1",
            ["address"] = "a1",
            ["dataType"] = "Float",
        });
        await AssertRejectedAsync(admin, AsJson(document), "references missing adapter");
    }

    [Fact]
    public async Task Rejected_apply_performs_no_partial_write_and_matches_inspect()
    {
        var admin = await AdminClientAsync();
        var before = await (await admin.GetAsync("/api/adapters")).Content.ReadAsStringAsync();
        var tampered = TamperedExport(await ExportAsync(admin));

        var inspect = await admin.PostAsync("/api/restores/configuration/inspect", AsJson(tampered));
        var apply = await admin.PostAsync("/api/restores/configuration/apply", AsJson(tampered));

        // Both endpoints validate identically and reject identically.
        Assert.Equal(HttpStatusCode.BadRequest, inspect.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, apply.StatusCode);
        Assert.Equal(await inspect.Content.ReadAsStringAsync(), await apply.Content.ReadAsStringAsync());

        // The rejected apply must not have written anything.
        var after = await (await admin.GetAsync("/api/adapters")).Content.ReadAsStringAsync();
        Assert.Equal(before, after);
    }

    private static HttpRequestMessage BuildChunkedOversizedRequest(string path)
    {
        // 6 MB of JSON, over the 5 MB cap. StreamContent + TransferEncodingChunked means the
        // request carries no Content-Length header at all -- the server only learns the size by
        // reading the body stream, same as a real chunked upload.
        var huge = "{\"junk\":\"" + new string('a', 6 * 1024 * 1024) + "\"}";
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(huge));
        var content = new StreamContent(stream);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = content };
        request.Headers.TransferEncodingChunked = true;
        return request;
    }
}
