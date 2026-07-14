using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class BackupHardeningTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
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
