using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Cloud.Services;
using Xunit;

namespace Pulse.Edge.Tests;

/// <summary>Scripted HttpMessageHandler: records the request, returns a canned response.</summary>
internal sealed class ScriptedHandler : HttpMessageHandler
{
    private readonly HttpStatusCode _status;
    private readonly string _body;
    public HttpRequestMessage? LastRequest;
    public string? LastRequestBody;

    public ScriptedHandler(HttpStatusCode status, string body = "{}")
    {
        _status = status;
        _body = body;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        LastRequest = request;
        LastRequestBody = request.Content == null ? null : await request.Content.ReadAsStringAsync(ct);
        return new HttpResponseMessage(_status)
        {
            Content = new StringContent(_body, System.Text.Encoding.UTF8, "application/json"),
        };
    }
}

public class CloudClientOeeTests
{
    private const string BaseUrl = "http://localhost:3000"; // loopback http is an acceptable endpoint

    private static CloudClient MakeClient(ScriptedHandler handler) =>
        new(NullLogger<CloudClient>.Instance, handler);

    [Fact]
    public async Task Declare_PostsCamelCaseArray_WithBearerAuth_And201IsSuccess()
    {
        var handler = new ScriptedHandler(HttpStatusCode.Created, "[]");
        var client = MakeClient(handler);

        var result = await client.DeclareOeeChannelsAsync(BaseUrl, "key-123", new List<CloudClient.OeeChannelDeclarationDto>
        {
            new("line1.filler", "Line 1 — Filler", new[] { "state", "counters" }),
        });

        Assert.Equal(OeeSyncResult.Success, result);
        Assert.Equal("/edge/oee/channels", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.Equal("Bearer", handler.LastRequest.Headers.Authorization!.Scheme);
        Assert.Equal("key-123", handler.LastRequest.Headers.Authorization.Parameter);

        using var doc = JsonDocument.Parse(handler.LastRequestBody!);
        var item = doc.RootElement[0];
        Assert.Equal("line1.filler", item.GetProperty("externalId").GetString());
        Assert.Equal("state", item.GetProperty("capabilities")[0].GetString());
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, OeeSyncResult.EnvelopeError)]
    [InlineData(HttpStatusCode.Unauthorized, OeeSyncResult.Unauthorized)]
    [InlineData(HttpStatusCode.Conflict, OeeSyncResult.NotPaired)]
    [InlineData(HttpStatusCode.ServiceUnavailable, OeeSyncResult.TransientError)]
    public async Task Declare_MapsStatusCodes(HttpStatusCode status, OeeSyncResult expected)
    {
        var client = MakeClient(new ScriptedHandler(status));
        var result = await client.DeclareOeeChannelsAsync(BaseUrl, "k", new List<CloudClient.OeeChannelDeclarationDto>
        {
            new("x", "X", new[] { "state" }),
        });
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, OeeSyncResult.EnvelopeError)]
    [InlineData(HttpStatusCode.Unauthorized, OeeSyncResult.Unauthorized)]
    [InlineData(HttpStatusCode.Conflict, OeeSyncResult.NotPaired)]
    [InlineData(HttpStatusCode.ServiceUnavailable, OeeSyncResult.TransientError)]
    public async Task Events_MapsStatusCodes(HttpStatusCode status, OeeSyncResult expected)
    {
        var client = MakeClient(new ScriptedHandler(status));
        var (result, response) = await client.SendOeeEventsBatchAsync(BaseUrl, "k", new List<CloudClient.OeeEventMessageDto>
        {
            new() { Type = "sync", Channel = "c", Seq = 0, Ts = "2026-07-18T00:00:00.000Z", State = "running" },
        });
        Assert.Equal(expected, result);
        Assert.Null(response);
    }

    [Fact]
    public async Task SendEvents_SerializesContract_OmitsNulls_ParsesPerMessageErrors()
    {
        var handler = new ScriptedHandler(HttpStatusCode.Accepted,
            "{\"accepted\":1,\"rejected\":1,\"duplicates\":1,\"errors\":[{\"index\":1,\"reason\":\"unknown channel 'ghost'\"}]}");
        var client = MakeClient(handler);

        var messages = new List<CloudClient.OeeEventMessageDto>
        {
            new()
            {
                Type = "state", Channel = "line1.filler", Seq = 4102,
                Ts = "2026-07-18T06:14:03.250Z", State = "fault", Code = "E17",
                Counters = new CloudClient.OeeCountersDto { Good = 182440, Reject = 3121 },
            },
            new() { Type = "sync", Channel = "ghost", Seq = 0, Ts = "2026-07-18T06:15:00.000Z", State = "running" },
        };

        var (result, response) = await client.SendOeeEventsBatchAsync(BaseUrl, "k", messages);

        Assert.Equal(OeeSyncResult.Success, result);
        Assert.Equal("/edge/oee/events", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.Equal(1, response!.Accepted);
        Assert.Equal(1, response.Duplicates);
        Assert.Equal("unknown channel 'ghost'", response.Errors![0].Reason);
        Assert.Equal(1, response.Errors[0].Index);

        using var doc = JsonDocument.Parse(handler.LastRequestBody!);
        var first = doc.RootElement[0];
        Assert.Equal("state", first.GetProperty("type").GetString());
        Assert.Equal(4102, first.GetProperty("seq").GetInt64());
        Assert.Equal(182440, first.GetProperty("counters").GetProperty("good").GetInt64());
        // Null fields must be omitted entirely (contract: unknown/absent, not null).
        var second = doc.RootElement[1];
        Assert.False(second.TryGetProperty("code", out _));
        Assert.False(second.TryGetProperty("counters", out _));
    }

    [Fact]
    public async Task SendEvents_NetworkFailure_IsTransient()
    {
        var throwingHandler = new ThrowingHandler();
        var client = new CloudClient(NullLogger<CloudClient>.Instance, throwingHandler);
        var (result, response) = await client.SendOeeEventsBatchAsync(BaseUrl, "k",
            new List<CloudClient.OeeEventMessageDto>
            {
                new() { Type = "sync", Channel = "c", Seq = 0, Ts = "2026-07-18T00:00:00.000Z", State = "running" },
            });
        Assert.Equal(OeeSyncResult.TransientError, result);
        Assert.Null(response);
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => throw new HttpRequestException("connection refused");
    }
}
