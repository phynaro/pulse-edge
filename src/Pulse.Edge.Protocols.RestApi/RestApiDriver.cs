using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Pulse.Edge.Protocols.RestApi;

public class RestApiDriver : IDisposable
{
    private readonly ILogger<RestApiDriver> _logger;
    private readonly HttpClient _httpClient = new();
    
    private string _host = string.Empty;
    private int _port = 80;
    private string _configJson = string.Empty;
    private bool _isConnected = false;
    private readonly object _lock = new();

    // Configuration properties
    private string _method = "GET";
    private string _path = "/";
    private readonly Dictionary<string, string> _headers = new();
    private string _body = string.Empty;
    private int _timeoutMs = 5000;

    public bool IsConnected => _isConnected;

    public RestApiDriver(ILogger<RestApiDriver> logger)
    {
        _logger = logger;
    }

    public void Connect(string host, int port, string configJson)
    {
        ConnectAsync(host, port, configJson).GetAwaiter().GetResult();
    }

    public async Task ConnectAsync(string host, int port, string configJson, CancellationToken cancellationToken = default)
    {
        lock (_lock)
        {
            if (_isConnected && _host == host && _port == port && _configJson == configJson)
            {
                return;
            }

            Disconnect();

            _host = host;
            _port = port;
            _configJson = configJson;
        }

        ParseConfigJson(configJson);

        // Validate server reachability with a lightweight TCP probe first
        try
        {
            var testHost = host;
            if (testHost.Contains("://"))
            {
                // Strip scheme
                testHost = new Uri(testHost).Host;
            }

            _logger.LogInformation("REST API Driver: Testing reachability of base server {Host}:{Port}...", testHost, port);

            using var tcpClient = new TcpClient();
            var connectTask = tcpClient.ConnectAsync(testHost, port, cancellationToken).AsTask();
            var delayTask = Task.Delay(Math.Min(_timeoutMs, 2000), cancellationToken);

            var completedTask = await Task.WhenAny(connectTask, delayTask);
            if (completedTask == connectTask)
            {
                await connectTask; // Throws if connection failed
                lock (_lock)
                {
                    _isConnected = true;
                }
                _logger.LogInformation("REST API Driver: Server {Host}:{Port} is reachable.", testHost, port);
            }
            else
            {
                throw new TimeoutException($"TCP connection to {testHost}:{port} timed out.");
            }
        }
        catch (Exception ex)
        {
            lock (_lock)
            {
                _isConnected = false;
            }
            _logger.LogWarning(ex, "REST API Driver: Server connectivity check failed for {Host}:{Port}", host, port);
            throw;
        }
    }

    public void Disconnect()
    {
        lock (_lock)
        {
            _isConnected = false;
        }
    }

    public async Task<string> FetchPayloadAsync(CancellationToken cancellationToken = default)
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("REST API Driver is not connected.");
        }

        var baseUrl = BuildBaseUrl(_host, _port);
        var fullUrl = new Uri(new Uri(baseUrl), _path).ToString();
        
        _logger.LogDebug("REST API Driver: Fetching data from {Method} {Url}...", _method, fullUrl);

        var httpMethod = new HttpMethod(_method.ToUpperInvariant());
        
        // Create request
        var request = new HttpRequestMessage(httpMethod, fullUrl);

        // Add custom headers
        foreach (var header in _headers)
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        // Add body if POST/PUT
        if ((httpMethod == HttpMethod.Post || httpMethod == HttpMethod.Put) && !string.IsNullOrEmpty(_body))
        {
            request.Content = new StringContent(_body, Encoding.UTF8, "application/json");
        }

        // Apply timeout
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromMilliseconds(_timeoutMs));

        var response = await _httpClient.SendAsync(request, cts.Token);
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadAsStringAsync(cts.Token);
        return payload;
    }

    private string BuildBaseUrl(string host, int port)
    {
        var cleanHost = host.Trim();
        if (!cleanHost.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && 
            !cleanHost.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            cleanHost = "http://" + cleanHost;
        }

        var uriBuilder = new UriBuilder(cleanHost);
        if (port > 0 && port != 80 && port != 443)
        {
            uriBuilder.Port = port;
        }

        return uriBuilder.Uri.ToString();
    }

    private void ParseConfigJson(string configJson)
    {
        if (string.IsNullOrWhiteSpace(configJson)) return;

        try
        {
            using var doc = JsonDocument.Parse(configJson);
            var root = doc.RootElement;

            if (root.TryGetProperty("Method", out var methodProp))
            {
                _method = methodProp.GetString() ?? "GET";
            }
            if (root.TryGetProperty("Path", out var pathProp))
            {
                _path = pathProp.GetString() ?? "/";
            }
            if (root.TryGetProperty("Body", out var bodyProp))
            {
                _body = bodyProp.GetString() ?? string.Empty;
            }
            if (root.TryGetProperty("TimeoutMs", out var timeoutProp))
            {
                _timeoutMs = timeoutProp.GetInt32();
            }

            _headers.Clear();
            if (root.TryGetProperty("Headers", out var headersProp) && headersProp.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in headersProp.EnumerateObject())
                {
                    _headers[prop.Name] = prop.Value.GetString() ?? string.Empty;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "REST API Driver: Failed to parse ConfigJson. Using defaults.");
        }
    }

    public void Dispose()
    {
        Disconnect();
        _httpClient.Dispose();
    }
}
