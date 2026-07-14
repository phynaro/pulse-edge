using Microsoft.AspNetCore.Http;

namespace Pulse.Edge.Api.Security;

/// <summary>
/// Enforces a hard byte cap on the restore-endpoint request body, before Minimal API's model
/// binding gets a chance to deserialize it. Minimal API resolves a `[FromBody]` parameter as part
/// of endpoint invocation -- by the time a handler's own code runs, the JSON has already been
/// read and parsed. Running this check as middleware, ahead of routing/endpoint execution, means
/// an oversized body never reaches the JSON parser at all.
///
/// This also covers the case a `Content-Length`-only check misses: a request sent with
/// `Transfer-Encoding: chunked` carries no `Content-Length` header, so the size is only knowable
/// by reading the stream. Without this middleware such a request would be bounded only by
/// Kestrel's default `MaxRequestBodySize` (~28.6 MB, unconfigured in this repo) -- and these
/// restore endpoints check the caller's Admin role manually inside the handler, so even an
/// unauthenticated LAN client could make the server buffer/parse a body that large today.
/// </summary>
public sealed class RestoreBodySizeLimitMiddleware(RequestDelegate next)
{
    public const long MaxRestoreBodyBytes = 5 * 1024 * 1024;

    private const int ReadChunkSize = 81920;

    private static readonly string[] GuardedPaths =
    [
        "/api/restores/configuration/inspect",
        "/api/restores/configuration/apply",
    ];

    public async Task InvokeAsync(HttpContext context)
    {
        if (!IsGuardedPath(context.Request.Path))
        {
            await next(context);
            return;
        }

        // Fast path: a declared Content-Length already over the cap -- reject without reading
        // a single byte of the body.
        if (context.Request.ContentLength is > MaxRestoreBodyBytes)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            return;
        }

        // Slow path (also covers chunked requests with no Content-Length at all): copy the body
        // into a bounded buffer, reading at most cap+1 bytes total so a hostile huge upload can
        // never make us allocate more than ~5 MB before we notice and bail out.
        var buffer = new MemoryStream();
        var readBuffer = new byte[ReadChunkSize];
        while (true)
        {
            var remaining = MaxRestoreBodyBytes + 1 - buffer.Length;
            if (remaining <= 0)
            {
                context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                return;
            }

            var toRead = (int)Math.Min(readBuffer.Length, remaining);
            var bytesRead = await context.Request.Body.ReadAsync(readBuffer.AsMemory(0, toRead), context.RequestAborted);
            if (bytesRead == 0) break;

            await buffer.WriteAsync(readBuffer.AsMemory(0, bytesRead), context.RequestAborted);
        }

        if (buffer.Length > MaxRestoreBodyBytes)
        {
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            return;
        }

        buffer.Position = 0;
        context.Request.Body = buffer;
        await next(context);
    }

    private static bool IsGuardedPath(PathString path) =>
        GuardedPaths.Any(guarded => path.StartsWithSegments(guarded));
}
