using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Protocols.OpcUa;
using Pulse.Edge.Protocols.LibPlcTag;
using Pulse.Edge.Protocols.S7Net;
using Pulse.Edge.Protocols.RestApi;
using Pulse.Edge.Protocols.Bacnet;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace Pulse.Edge.Api.Endpoints;

public static class AdapterEndpoints
{
    public static void MapAdapterEndpoints(this IEndpointRouteBuilder routes)
    {
        // GET /api/adapters - Returns connection adapters from database
        routes.MapGet("/api/adapters", async () =>
        {
            using var db = new QueueDbContext();
            var list = await db.DriverAdapters.ToListAsync();
            return Results.Ok(list);
        });

        // POST /api/adapters - Updates or inserts a connection adapter configuration
        routes.MapPost("/api/adapters", async (DriverAdapter updated) =>
        {
            using var db = new QueueDbContext();
            var existing = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == updated.Id);
            if (existing == null)
            {
                db.DriverAdapters.Add(updated);
                await db.SaveChangesAsync();
                return Results.Created($"/api/adapters/{updated.Id}", updated);
            }
            
            existing.Name = updated.Name;
            existing.Protocol = updated.Protocol;
            existing.Host = updated.Host;
            existing.Port = updated.Port;
            existing.ConfigJson = updated.ConfigJson;
            existing.IsEnabled = updated.IsEnabled;
            
            db.DriverAdapters.Update(existing);
            await db.SaveChangesAsync();
            return Results.Ok(existing);
        });

        // POST /api/adapters/test-connection - Tests IP and Port connectivity
        routes.MapPost("/api/adapters/test-connection", async (TestConnectionRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.Host))
            {
                return Results.BadRequest(new { success = false, message = "Host/IP is required." });
            }
            if (request.Host.Equals("simulator", StringComparison.OrdinalIgnoreCase))
            {
                return Results.Ok(new { success = true, message = "Successfully connected to Simulator." });
            }
            if (request.Port <= 0 || request.Port > 65535)
            {
                return Results.BadRequest(new { success = false, message = "Invalid port number. Port must be between 1 and 65535." });
            }

            string targetHost = request.Host;
            int targetPort = request.Port;

            // Handle host strings that contain a port suffix (e.g. 192.168.1.51:502)
            if (targetHost.Contains(':'))
            {
                var parts = targetHost.Split(':');
                targetHost = parts[0];
                if (parts.Length > 1 && int.TryParse(parts[1], out var parsedPort))
                {
                    targetPort = parsedPort;
                }
            }

            try
            {
                using var client = new TcpClient();
                // Use a 2-second timeout for testing connection
                var connectTask = client.ConnectAsync(targetHost, targetPort);
                var delayTask = Task.Delay(2000);

                var completedTask = await Task.WhenAny(connectTask, delayTask);
                if (completedTask == connectTask)
                {
                    await connectTask; // Throws if failed
                    return Results.Ok(new { success = true, message = $"Successfully connected to {targetHost}:{targetPort}." });
                }
                else
                {
                    return Results.Ok(new { success = false, message = $"Connection timed out after 2000ms attempting to reach {targetHost}:{targetPort}." });
                }
            }
            catch (SocketException ex)
            {
                return Results.Ok(new { 
                    success = false, 
                    message = $"Socket error: {ex.Message} (Error Code: {ex.SocketErrorCode}). Verify that the IP/host is correct and reachable, and that the remote server is active." 
                });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { 
                    success = false, 
                    message = $"Failed to connect: {ex.Message}" 
                });
            }
        });

        // POST /api/adapters/opcua/discover - Discover OPC UA endpoints for a host URL
        routes.MapPost("/api/adapters/opcua/discover", async (DiscoverEndpointsRequest request, OpcUaDriver opcUaDriver) =>
        {
            if (string.IsNullOrWhiteSpace(request.DiscoveryUrl))
            {
                return Results.BadRequest(new { success = false, message = "Discovery URL is required." });
            }

            try
            {
                var endpoints = await opcUaDriver.DiscoverEndpointsAsync(request.DiscoveryUrl);
                return Results.Ok(new { success = true, endpoints });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Discovery failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/discover-hosts - Discover active hosts on the network for a given port
        routes.MapPost("/api/adapters/discover-hosts", async (DiscoverHostsRequest request) =>
        {
            if (request.Port <= 0 || request.Port > 65535)
            {
                return Results.BadRequest(new { success = false, message = "Invalid port number. Port must be between 1 and 65535." });
            }

            var ipListToScan = new List<string>();
            ipListToScan.Add("127.0.0.1");
            ipListToScan.Add("localhost");

            try
            {
                foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus == System.Net.NetworkInformation.OperationalStatus.Up && 
                        ni.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
                    {
                        var props = ni.GetIPProperties();
                        foreach (var ip in props.UnicastAddresses)
                        {
                            if (ip.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                            {
                                var mask = ip.IPv4Mask;
                                if (mask != null)
                                {
                                    byte[] ipBytes = ip.Address.GetAddressBytes();
                                    byte[] maskBytes = mask.GetAddressBytes();
                                    if (ipBytes.Length == 4 && maskBytes.Length == 4)
                                    {
                                        for (int host = 1; host <= 254; host++)
                                        {
                                            var targetIp = $"{ipBytes[0]}.{ipBytes[1]}.{ipBytes[2]}.{host}";
                                            if (!ipListToScan.Contains(targetIp))
                                            {
                                                ipListToScan.Add(targetIp);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error scanning network interfaces: {ex.Message}");
            }

            var activeHosts = new System.Collections.Concurrent.ConcurrentBag<string>();
            
            using (var semaphore = new SemaphoreSlim(50))
            {
                var tasks = ipListToScan.Select(async ip =>
                {
                    await semaphore.WaitAsync();
                    try
                    {
                        using var client = new TcpClient();
                        var connectTask = client.ConnectAsync(ip, request.Port);
                        var delayTask = Task.Delay(500); // 500ms timeout
                        
                        var completedTask = await Task.WhenAny(connectTask, delayTask);
                        if (completedTask == connectTask)
                        {
                            await connectTask; // verify no socket exception is thrown
                            activeHosts.Add(ip);
                        }
                    }
                    catch
                    {
                        // Ignore connection failures
                    }
                    finally
                    {
                        semaphore.Release();
                    }
                });
                
                await Task.WhenAll(tasks);
            }

            var resultList = activeHosts.Distinct().OrderBy(h => h).ToList();
            return Results.Ok(new { success = true, hosts = resultList });
        });

        // POST /api/adapters/opcua/browse - Browse OPC UA nodes hierarchically
        routes.MapPost("/api/adapters/opcua/browse", async (BrowseNodesRequest request, OpcUaDriver opcUaDriver) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "OPC_UA")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not an OPC UA adapter." });
                }

                string securityMode = "None";
                string securityPolicy = "http://opcfoundation.org/UA/SecurityPolicy#None";
                string username = "";
                string password = "";

                if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("SecurityMode", out var smProp)) securityMode = smProp.GetString() ?? "None";
                        if (root.TryGetProperty("SecurityPolicy", out var spProp)) securityPolicy = spProp.GetString() ?? "http://opcfoundation.org/UA/SecurityPolicy#None";
                        if (root.TryGetProperty("Username", out var uProp)) username = uProp.GetString() ?? "";
                        if (root.TryGetProperty("Password", out var pProp)) password = pProp.GetString() ?? "";
                    }
                    catch (Exception)
                    {
                        // Fallback to default
                    }
                }

                string endpointUrl = adapter.Host;
                if (!endpointUrl.StartsWith("opc.tcp://", StringComparison.OrdinalIgnoreCase))
                {
                    endpointUrl = $"opc.tcp://{adapter.Host}:{adapter.Port}";
                }

                var nodes = await opcUaDriver.BrowseNodesAsync(
                    endpointUrl,
                    securityMode,
                    securityPolicy,
                    username,
                    password,
                    request.NodeId);

                return Results.Ok(new { success = true, nodes });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/mqtt/browse - Browse seen MQTT topics and their JSON paths
        routes.MapPost("/api/adapters/mqtt/browse", async (MqttBrowseRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "MQTT")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not an MQTT adapter." });
                }

                var conn = db.Database.GetDbConnection();
                bool wasClosed = conn.State == System.Data.ConnectionState.Closed;
                if (wasClosed) await conn.OpenAsync();

                var topics = new List<MqttBrowseItem>();

                try
                {
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = "SELECT Topic, Payload, LastSeen FROM MqttSeenTopics ORDER BY Topic ASC;";
                    using var reader = await cmd.ExecuteReaderAsync();
                    while (await reader.ReadAsync())
                    {
                        string topic = reader.GetString(0);
                        string payload = reader.GetString(1);
                        string lastSeen = reader.GetString(2);

                        var keys = new List<MqttJsonKeyItem>();
                        if (!string.IsNullOrWhiteSpace(payload))
                        {
                            try
                            {
                                using var doc = System.Text.Json.JsonDocument.Parse(payload);
                                ExtractJsonPaths(doc.RootElement, "", keys);
                            }
                            catch
                            {
                                // Payload is not JSON or invalid
                            }
                        }

                        // If no JSON keys were extracted, add a default key for the raw payload
                        if (keys.Count == 0)
                        {
                            keys.Add(new MqttJsonKeyItem("$", "String", payload));
                        }

                        topics.Add(new MqttBrowseItem(topic, payload, lastSeen, keys));
                    }
                }
                finally
                {
                    if (wasClosed) await conn.CloseAsync();
                }

                return Results.Ok(new { success = true, topics });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/webhook/browse - Browse webhook last payload keys
        routes.MapPost("/api/adapters/webhook/browse", async (WebhookBrowseRequest request) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "WEBHOOK")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not a Webhook adapter." });
                }

                string lastPayload = "";
                string lastSeen = "";
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson ?? "{}");
                    if (doc.RootElement.TryGetProperty("LastPayload", out var payloadProp))
                    {
                        lastPayload = payloadProp.GetString() ?? "";
                    }
                    if (doc.RootElement.TryGetProperty("LastSeen", out var seenProp))
                    {
                        lastSeen = seenProp.GetString() ?? "";
                    }
                }
                catch {}

                var keys = new List<MqttJsonKeyItem>();
                if (!string.IsNullOrWhiteSpace(lastPayload))
                {
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(lastPayload);
                        ExtractJsonPaths(doc.RootElement, "", keys);
                    }
                    catch
                    {
                        // Payload is not JSON or invalid
                    }
                }

                // If no JSON keys were extracted, add a default key for the raw payload
                if (keys.Count == 0)
                {
                    keys.Add(new MqttJsonKeyItem("$", "String", lastPayload));
                }

                var topics = new List<MqttBrowseItem>
                {
                    new MqttBrowseItem("webhook-payload", lastPayload, lastSeen, keys)
                };

                return Results.Ok(new { success = true, topics });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/restapi/browse - Browse REST API response payload keys
        routes.MapPost("/api/adapters/restapi/browse", async (RestApiBrowseRequest request, RestApiDriver restApiDriver, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId, cancellationToken);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "REST_API")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not a REST_API adapter." });
                }

                // Connect the driver to configure the endpoint
                await restApiDriver.ConnectAsync(adapter.Host, adapter.Port, adapter.ConfigJson ?? "{}", cancellationToken);

                // Fetch the live payload in real-time
                string payload = await restApiDriver.FetchPayloadAsync(cancellationToken);
                string lastSeen = DateTime.UtcNow.ToString("o");

                // Update LastPayload and LastSeen in ConfigJson
                try
                {
                    var configObj = new Dictionary<string, object>();
                    try
                    {
                        if (!string.IsNullOrEmpty(adapter.ConfigJson))
                        {
                            configObj = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, object>>(adapter.ConfigJson) ?? new Dictionary<string, object>();
                        }
                    }
                    catch {}

                    configObj["LastPayload"] = payload;
                    configObj["LastSeen"] = lastSeen;

                    adapter.ConfigJson = System.Text.Json.JsonSerializer.Serialize(configObj);
                    db.DriverAdapters.Update(adapter);
                    await db.SaveChangesAsync(cancellationToken);
                }
                catch {}

                // Extract JSON keys/paths
                var keys = new List<MqttJsonKeyItem>();
                if (!string.IsNullOrWhiteSpace(payload))
                {
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(payload);
                        ExtractJsonPaths(doc.RootElement, "", keys);
                    }
                    catch
                    {
                        // Payload is not JSON or invalid
                    }
                }

                // If no JSON keys were extracted, add a default key for the raw payload
                if (keys.Count == 0)
                {
                    keys.Add(new MqttJsonKeyItem("$", "String", payload));
                }

                var topics = new List<MqttBrowseItem>
                {
                    new MqttBrowseItem("rest-api-payload", payload, lastSeen, keys)
                };

                return Results.Ok(new { success = true, topics });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/ethernetip/browse - Browse Ethernet/IP PLC tags
        routes.MapPost("/api/adapters/ethernetip/browse", async (EthernetIpBrowseRequest request, LibPlcTagDriver libPlcTagDriver, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "Ethernet/IP")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not an Ethernet/IP adapter." });
                }

                string plcType = "ControlLogix";
                string protocol = "ab_eip";
                string path = "1,0";
                int timeoutMs = 5000;

                if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("PlcType", out var ptProp)) plcType = ptProp.GetString() ?? plcType;
                        if (root.TryGetProperty("Protocol", out var protoProp)) protocol = protoProp.GetString() ?? protocol;
                        if (root.TryGetProperty("Path", out var pathProp)) path = pathProp.GetString() ?? path;
                        if (root.TryGetProperty("TimeoutMs", out var toProp)) timeoutMs = toProp.GetInt32();
                    }
                    catch (Exception) { }
                }

                if (!libPlcTagDriver.IsConnected)
                {
                    libPlcTagDriver.Connect(adapter.Host, plcType, protocol, path, timeoutMs);
                }

                var tags = await libPlcTagDriver.BrowseTagsAsync(cancellationToken);
                return Results.Ok(new { success = true, tags });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/ethernetip/template - Retrieve Logix UDT structure template members
        routes.MapPost("/api/adapters/ethernetip/template", async (EthernetIpTemplateRequest request, LibPlcTagDriver libPlcTagDriver, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "Ethernet/IP")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not an Ethernet/IP adapter." });
                }

                string plcType = "ControlLogix";
                string protocol = "ab_eip";
                string path = "1,0";
                int timeoutMs = 5000;

                if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("PlcType", out var ptProp)) plcType = ptProp.GetString() ?? plcType;
                        if (root.TryGetProperty("Protocol", out var protoProp)) protocol = protoProp.GetString() ?? protocol;
                        if (root.TryGetProperty("Path", out var pathProp)) path = pathProp.GetString() ?? path;
                        if (root.TryGetProperty("TimeoutMs", out var toProp)) timeoutMs = toProp.GetInt32();
                    }
                    catch (Exception) { }
                }

                if (!libPlcTagDriver.IsConnected)
                {
                    libPlcTagDriver.Connect(adapter.Host, plcType, protocol, path, timeoutMs);
                }

                var members = await libPlcTagDriver.GetStructureTemplateAsync(request.TemplateId, cancellationToken);
                return Results.Ok(new { success = true, members });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Failed to read UDT template: {ex.Message}" });
            }
        });

        // POST /api/adapters/ethernetip/program-tags - Retrieve Logix program-scoped tags
        routes.MapPost("/api/adapters/ethernetip/program-tags", async (EthernetIpProgramTagsRequest request, LibPlcTagDriver libPlcTagDriver, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            if (string.IsNullOrWhiteSpace(request.ProgramName))
            {
                return Results.BadRequest(new { success = false, message = "ProgramName is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "Ethernet/IP")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not an Ethernet/IP adapter." });
                }

                string plcType = "ControlLogix";
                string protocol = "ab_eip";
                string path = "1,0";
                int timeoutMs = 5000;

                if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("PlcType", out var ptProp)) plcType = ptProp.GetString() ?? plcType;
                        if (root.TryGetProperty("Protocol", out var protoProp)) protocol = protoProp.GetString() ?? protocol;
                        if (root.TryGetProperty("Path", out var pathProp)) path = pathProp.GetString() ?? path;
                        if (root.TryGetProperty("TimeoutMs", out var toProp)) timeoutMs = toProp.GetInt32();
                    }
                    catch (Exception) { }
                }

                if (!libPlcTagDriver.IsConnected)
                {
                    libPlcTagDriver.Connect(adapter.Host, plcType, protocol, path, timeoutMs);
                }

                var tags = await libPlcTagDriver.BrowseProgramTagsAsync(request.ProgramName, cancellationToken);
                return Results.Ok(new { success = true, tags });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Failed to read program tags: {ex.Message}" });
            }
        });

        // POST /api/adapters/siemens-s7/browse - Browse Siemens S7 PLC tags
        routes.MapPost("/api/adapters/siemens-s7/browse", async (SiemensS7BrowseRequest request, S7NetDriver s7NetDriver, CancellationToken cancellationToken) =>
        {
            if (string.IsNullOrWhiteSpace(request.AdapterId))
            {
                return Results.BadRequest(new { success = false, message = "AdapterId is required." });
            }

            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "Siemens S7")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not a Siemens S7 adapter." });
                }

                string cpuType = "S71200";
                short rack = 0;
                short slot = 1;
                int timeoutMs = 5000;

                if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("CpuType", out var cpuProp)) cpuType = cpuProp.GetString() ?? cpuType;
                        if (root.TryGetProperty("Rack", out var rackProp)) rack = rackProp.GetInt16();
                        if (root.TryGetProperty("Slot", out var slotProp)) slot = slotProp.GetInt16();
                        if (root.TryGetProperty("TimeoutMs", out var toProp)) timeoutMs = toProp.GetInt32();
                    }
                    catch (Exception) { }
                }

                if (!s7NetDriver.IsConnected)
                {
                    await s7NetDriver.ConnectAsync(adapter.Host, cpuType, rack, slot, timeoutMs, cancellationToken);
                }

                var tags = await s7NetDriver.BrowseTagsAsync(cancellationToken);
                return Results.Ok(new { success = true, tags });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/adapters/bacnet/browse - Browse BACnet PLC/device objects
        routes.MapPost("/api/adapters/bacnet/browse", async (BacnetBrowseRequest request, BacnetDriver bacnetDriver, CancellationToken cancellationToken) =>
        {
            try
            {
                using var db = new QueueDbContext();
                var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == request.AdapterId, cancellationToken);
                if (adapter == null)
                {
                    return Results.NotFound(new { success = false, message = "Adapter not found." });
                }

                if (adapter.Protocol != "BACnet")
                {
                    return Results.BadRequest(new { success = false, message = "Selected adapter is not a BACnet adapter." });
                }

                int deviceId = 123;
                int port = adapter.Port > 0 ? adapter.Port : 47808;

                if (!string.IsNullOrWhiteSpace(adapter.ConfigJson))
                {
                    try
                    {
                        var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                        var root = doc.RootElement;
                        if (root.TryGetProperty("DeviceId", out var devProp)) deviceId = devProp.GetInt32();
                    }
                    catch (Exception) { }
                }

                if (!bacnetDriver.IsConnected)
                {
                    await bacnetDriver.ConnectAsync(adapter.Host, deviceId, port, cancellationToken);
                }

                var tags = await bacnetDriver.BrowseTagsAsync(cancellationToken);
                return Results.Ok(new { success = true, tags });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { success = false, message = $"Browse failed: {ex.Message}" });
            }
        });

        // POST /api/webhooks/receive/{adapterId} - Receive REST Webhook payloads from clients
        routes.MapPost("/api/webhooks/receive/{adapterId}", async (
            string adapterId,
            [Microsoft.AspNetCore.Mvc.FromQuery] string token,
            HttpRequest request,
            QueueStorageService storageService) =>
        {
            using var reader = new StreamReader(request.Body);
            string payload = await reader.ReadToEndAsync();

            // Check if adapter exists
            using var db = new QueueDbContext();
            var adapter = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == adapterId);
            if (adapter == null)
            {
                return Results.Json(new { success = false, message = "Adapter not found." }, statusCode: 404);
            }

            if (adapter.Protocol != "WEBHOOK")
            {
                return Results.Json(new { success = false, message = "Selected adapter is not a WEBHOOK adapter." }, statusCode: 400);
            }

            if (!adapter.IsEnabled)
            {
                return Results.Json(new { success = false, message = "Adapter is disabled." }, statusCode: 400);
            }

            // Parse ConfigJson to validate Token
            string configToken = "";
            try
            {
                using var configDoc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson ?? "{}");
                if (configDoc.RootElement.TryGetProperty("Token", out var tokenProp))
                {
                    configToken = tokenProp.GetString() ?? "";
                }
            }
            catch {}

            if (string.IsNullOrEmpty(configToken) || configToken != token)
            {
                return Results.Json(new { success = false, message = "Unauthorized: invalid token." }, statusCode: 401);
            }

            // Update last payload/seen in ConfigJson
            try
            {
                var configObj = new Dictionary<string, string>();
                try
                {
                    if (!string.IsNullOrEmpty(adapter.ConfigJson))
                    {
                        configObj = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, string>>(adapter.ConfigJson) ?? new Dictionary<string, string>();
                    }
                }
                catch {}

                configObj["LastPayload"] = payload;
                configObj["LastSeen"] = DateTime.UtcNow.ToString("o");

                adapter.ConfigJson = System.Text.Json.JsonSerializer.Serialize(configObj);
                adapter.Status = "Connected"; // Mark as connected since we received data
                db.DriverAdapters.Update(adapter);
                await db.SaveChangesAsync();
            }
            catch {}

            // Parse payload to check for ts/timestamp
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(payload);
                var root = doc.RootElement;

                var elements = new List<System.Text.Json.JsonElement>();
                if (root.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    foreach (var item in root.EnumerateArray())
                    {
                        if (item.ValueKind == System.Text.Json.JsonValueKind.Object)
                        {
                            elements.Add(item);
                        }
                    }
                }
                else if (root.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    elements.Add(root);
                }
                else
                {
                    return Results.BadRequest(new { success = false, message = "Invalid JSON structure. Root must be a JSON object or JSON array of objects." });
                }

                // Find bound datapoints for this adapter
                var dps = await db.DataPoints
                    .Where(x => x.AdapterId == adapterId && x.IsEnabled)
                    .ToListAsync();

                foreach (var element in elements)
                {
                    DateTime receivedAt = DateTime.UtcNow;
                    bool hasPayloadTime = false;

                    // 1. Try "ts"
                    if (element.TryGetProperty("ts", out var tsProp))
                    {
                        if (tsProp.ValueKind == System.Text.Json.JsonValueKind.Number && tsProp.TryGetDouble(out double tsVal))
                        {
                            receivedAt = tsVal > 9999999999 ? DateTimeOffset.FromUnixTimeMilliseconds((long)tsVal).UtcDateTime : DateTimeOffset.FromUnixTimeSeconds((long)tsVal).UtcDateTime;
                            hasPayloadTime = true;
                        }
                        else if (tsProp.ValueKind == System.Text.Json.JsonValueKind.String)
                        {
                            string tsStr = tsProp.GetString() ?? "";
                            if (double.TryParse(tsStr, out double tsParsedVal))
                            {
                                receivedAt = tsParsedVal > 9999999999 ? DateTimeOffset.FromUnixTimeMilliseconds((long)tsParsedVal).UtcDateTime : DateTimeOffset.FromUnixTimeSeconds((long)tsParsedVal).UtcDateTime;
                                hasPayloadTime = true;
                            }
                            else if (DateTime.TryParse(tsStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out DateTime parsedDt))
                            {
                                receivedAt = parsedDt.ToUniversalTime();
                                hasPayloadTime = true;
                            }
                        }
                    }

                    // 2. Try "timestamp" if "ts" not found/parsed
                    if (!hasPayloadTime && element.TryGetProperty("timestamp", out var timestampProp))
                    {
                        if (timestampProp.ValueKind == System.Text.Json.JsonValueKind.Number && timestampProp.TryGetDouble(out double tsVal2))
                        {
                            receivedAt = tsVal2 > 9999999999 ? DateTimeOffset.FromUnixTimeMilliseconds((long)tsVal2).UtcDateTime : DateTimeOffset.FromUnixTimeSeconds((long)tsVal2).UtcDateTime;
                            hasPayloadTime = true;
                        }
                        else if (timestampProp.ValueKind == System.Text.Json.JsonValueKind.String)
                        {
                            string tsStr = timestampProp.GetString() ?? "";
                            if (double.TryParse(tsStr, out double tsParsedVal2))
                            {
                                receivedAt = tsParsedVal2 > 9999999999 ? DateTimeOffset.FromUnixTimeMilliseconds((long)tsParsedVal2).UtcDateTime : DateTimeOffset.FromUnixTimeSeconds((long)tsParsedVal2).UtcDateTime;
                                hasPayloadTime = true;
                            }
                            else if (DateTime.TryParse(tsStr, null, System.Globalization.DateTimeStyles.RoundtripKind, out DateTime parsedDt))
                            {
                                receivedAt = parsedDt.ToUniversalTime();
                                hasPayloadTime = true;
                            }
                        }
                    }

                    foreach (var dp in dps)
                    {
                        string? jsonPath = !string.IsNullOrEmpty(dp.MqttJsonPath) ? dp.MqttJsonPath : dp.Address;
                        string? extractedValue = GetJsonValueByElement(element, jsonPath ?? string.Empty);

                        if (extractedValue == null)
                        {
                            dp.LastError = $"JSON path '{jsonPath}' not found";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = DateTime.UtcNow; // Log when error occurred
                            db.DataPoints.Update(dp);

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    await storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                                }
                            }
                            continue;
                        }

                        // Parse value
                        bool isOfflineSignal = false;
                        var trimmed = extractedValue.Trim();
                        if (string.Equals(trimmed, "null", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "offline", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "timeout", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "none", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(trimmed, "", StringComparison.OrdinalIgnoreCase))
                        {
                            isOfflineSignal = true;
                        }

                        if (isOfflineSignal)
                        {
                            dp.LastError = "Device reported offline / timeout via Webhook payload";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = DateTime.UtcNow;
                            db.DataPoints.Update(dp);

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    string quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                                    await storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, quality);
                                }
                            }
                            continue;
                        }

                        double val;
                        bool parseSuccess = false;
                        if (double.TryParse(extractedValue, out val))
                        {
                            parseSuccess = true;
                        }
                        else if (bool.TryParse(extractedValue, out bool boolVal))
                        {
                            val = boolVal ? 1.0 : 0.0;
                            parseSuccess = true;
                        }

                        if (parseSuccess)
                        {
                            double processedVal = (val * dp.ScaleFactor) + dp.Offset;
                            dp.LastValue = processedVal.ToString("F2");
                            dp.LastError = null;
                            dp.ConsecutiveFailures = 0;
                            dp.LastUpdated = DateTime.UtcNow;
                            db.DataPoints.Update(dp);

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    await storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, processedVal, "Good");
                                }
                            }
                        }
                        else
                        {
                            dp.LastError = $"Failed to parse extracted value '{extractedValue}' as double or boolean";
                            dp.ConsecutiveFailures++;
                            dp.LastUpdated = DateTime.UtcNow;
                            db.DataPoints.Update(dp);

                            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
                            {
                                if (await storageService.IsDataSourceEnabledAsync(dp.DataSourceId))
                                {
                                    await storageService.EnqueueTelemetryAsync(dp.DataSourceId, receivedAt, dp.Metric, null, "DriverError");
                                }
                            }
                        }
                    }
                }

                await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                return Results.BadRequest(new { success = false, message = $"Failed to process JSON payload: {ex.Message}" });
            }

            return Results.Ok(new { success = true, message = "Payload processed successfully." });
        });

        // DELETE /api/adapters/{id} - Deletes a connection adapter configuration and its bound data points
        routes.MapDelete("/api/adapters/{id}", async (string id) =>
        {
            using var db = new QueueDbContext();
            var existing = await db.DriverAdapters.FirstOrDefaultAsync(x => x.Id == id);
            if (existing == null) return Results.NotFound();
            
            db.DriverAdapters.Remove(existing);
            
            // Also cascade delete any bound MQTT devices
            var boundDevices = await db.MqttDevices.Where(x => x.AdapterId == id).ToListAsync();
            if (boundDevices.Any())
            {
                db.MqttDevices.RemoveRange(boundDevices);
            }

            // Also cascade delete any bound datapoints
            var boundDataPoints = await db.DataPoints.Where(x => x.AdapterId == id).ToListAsync();
            if (boundDataPoints.Any())
            {
                db.DataPoints.RemoveRange(boundDataPoints);
            }
            
            await db.SaveChangesAsync();
            return Results.Ok(new { success = true, deletedMetricsCount = boundDataPoints.Count });
        });
    }

    private static string? GetJsonValueByElement(System.Text.Json.JsonElement element, string path) =>
        Pulse.Edge.Storage.Helpers.JsonPathHelper.GetJsonValueByElement(element, path);

    private static void ExtractJsonPaths(System.Text.Json.JsonElement element, string currentPath, List<MqttJsonKeyItem> paths)
    {
        if (element.ValueKind == System.Text.Json.JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                string path = string.IsNullOrEmpty(currentPath) ? $"$.{property.Name}" : $"{currentPath}.{property.Name}";
                
                string dataType = property.Value.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.Number => property.Value.GetRawText().Contains('.') ? "Float" : "Int32",
                    System.Text.Json.JsonValueKind.True => "Boolean",
                    System.Text.Json.JsonValueKind.False => "Boolean",
                    System.Text.Json.JsonValueKind.String => "String",
                    _ => "String"
                };

                paths.Add(new MqttJsonKeyItem(path, dataType, property.Value.ValueKind == System.Text.Json.JsonValueKind.String ? property.Value.GetString() ?? "" : property.Value.GetRawText()));
                ExtractJsonPaths(property.Value, path, paths);
            }
        }
        else if (element.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            int index = 0;
            foreach (var item in element.EnumerateArray())
            {
                string path = $"{currentPath}[{index}]";
                
                string dataType = item.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.Number => item.GetRawText().Contains('.') ? "Float" : "Int32",
                    System.Text.Json.JsonValueKind.True => "Boolean",
                    System.Text.Json.JsonValueKind.False => "Boolean",
                    System.Text.Json.JsonValueKind.String => "String",
                    _ => "String"
                };

                paths.Add(new MqttJsonKeyItem(path, dataType, item.ValueKind == System.Text.Json.JsonValueKind.String ? item.GetString() ?? "" : item.GetRawText()));
                ExtractJsonPaths(item, path, paths);
                index++;
            }
        }
    }
}

// Request and Response Records local to AdapterEndpoints
public record TestConnectionRequest(string Host, int Port);
public record DiscoverEndpointsRequest(string DiscoveryUrl);
public record DiscoverHostsRequest(int Port);
public record BrowseNodesRequest(string AdapterId, string? NodeId);
public record MqttBrowseRequest(string AdapterId);
public record MqttBrowseItem(string Topic, string Payload, string LastSeen, List<MqttJsonKeyItem> Keys);
public record MqttJsonKeyItem(string Path, string DataType, string Value);
public record WebhookBrowseRequest(string AdapterId);
public record RestApiBrowseRequest(string AdapterId);
public record EthernetIpBrowseRequest(string AdapterId);
public record SiemensS7BrowseRequest(string AdapterId);
public record BacnetBrowseRequest(string AdapterId);
public record EthernetIpTemplateRequest(string AdapterId, ushort TemplateId);
public record EthernetIpProgramTagsRequest(string AdapterId, string ProgramName);
