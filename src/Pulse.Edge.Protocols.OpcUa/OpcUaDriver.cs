using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Opc.Ua;
using Opc.Ua.Client;
using Opc.Ua.Configuration;

namespace Pulse.Edge.Protocols.OpcUa;

public class OpcUaDriver : IDisposable
{
    private readonly ILogger<OpcUaDriver> _logger;
    private Session? _session;
    private string _activeEndpoint = string.Empty;

    public bool IsConnected => _session != null && _session.Connected;

    public OpcUaDriver(ILogger<OpcUaDriver> logger)
    {
        _logger = logger;
    }

    public void Connect(string endpointUrl)
    {
        ConnectAsync(endpointUrl).GetAwaiter().GetResult();
    }

    public async Task ConnectAsync(string endpointUrl)
    {
        string formattedUrl = endpointUrl;
        if (!formattedUrl.StartsWith("opc.tcp://", StringComparison.OrdinalIgnoreCase))
        {
            if (endpointUrl.Contains(":"))
            {
                formattedUrl = $"opc.tcp://{endpointUrl}";
            }
            else
            {
                formattedUrl = $"opc.tcp://{endpointUrl}:4840";
            }
        }

        if (_session != null && _session.Connected && _activeEndpoint == formattedUrl)
        {
            return; // Already connected to this endpoint
        }

        Disconnect();

        try
        {
            _activeEndpoint = formattedUrl;
            _logger.LogInformation("OPC UA Driver: Connecting to OPC UA Endpoint at {Endpoint}...", formattedUrl);
            await ConnectInternalAsync(formattedUrl);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OPC UA Driver: Failed to connect to {Endpoint}", formattedUrl);
            throw;
        }
    }

    #pragma warning disable CS0618
    private async Task ConnectInternalAsync(string endpointUrl)
    {
        string baseDir = AppContext.BaseDirectory;
        string certsDir = Path.Combine(baseDir, "certs");

        var config = new ApplicationConfiguration
        {
            ApplicationName = "Pulse Edge Agent",
            ApplicationUri = "urn:localhost:Pulse:Edge:Agent",
            ApplicationType = ApplicationType.Client,
            SecurityConfiguration = new SecurityConfiguration
            {
                ApplicationCertificate = new CertificateIdentifier
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(certsDir, "own"),
                    SubjectName = "CN=Pulse Edge Agent, DC=localhost"
                },
                TrustedPeerCertificates = new CertificateTrustList
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(certsDir, "trusted")
                },
                TrustedIssuerCertificates = new CertificateTrustList
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(certsDir, "issuer")
                },
                RejectedCertificateStore = new CertificateTrustList
                {
                    StoreType = "Directory",
                    StorePath = Path.Combine(certsDir, "rejected")
                },
                AutoAcceptUntrustedCertificates = true,
                RejectSHA1SignedCertificates = false
            },
            TransportQuotas = new TransportQuotas { OperationTimeout = 10000 },
            ClientConfiguration = new ClientConfiguration()
        };

        var application = new ApplicationInstance(config, null)
        {
            ApplicationName = "Pulse Edge Agent",
            ApplicationType = ApplicationType.Client
        };

        bool hasCertificate = await application.CheckApplicationInstanceCertificatesAsync(
            silent: true,
            lifeTimeInMonths: 240,
            ct: default
        );

        if (!hasCertificate)
        {
            throw new Exception("Application instance certificate could not be created or validated.");
        }

        await config.ValidateAsync(ApplicationType.Client);

        var selectedEndpoint = CoreClientUtils.SelectEndpoint(config, endpointUrl, useSecurity: false);
        var endpointConfiguration = EndpointConfiguration.Create(config);
        var endpoint = new ConfiguredEndpoint(null, selectedEndpoint, endpointConfiguration);

        _session = await Session.Create(
            config,
            endpoint,
            updateBeforeConnect: false,
            checkDomain: false,
            sessionName: "Pulse Edge Agent Client Session",
            sessionTimeout: 10000,
            identity: new UserIdentity(new AnonymousIdentityToken()),
            preferredLocales: null);
    }
    #pragma warning disable CS0618 // Disable obsolete warnings for Session.Create, browser.Browse, SelectEndpoint, ReadValue, and Close

    public async Task<Dictionary<string, OpcUaReadResult>> ReadMetricsBatchAsync(IReadOnlyList<string> nodeIds, CancellationToken cancellationToken = default)
    {
        var result = new Dictionary<string, OpcUaReadResult>(nodeIds.Count);

        if (_session == null || !_session.Connected)
        {
            throw new InvalidOperationException("OPC UA Driver is not connected.");
        }

        try
        {
            var nodesToRead = new ReadValueIdCollection(nodeIds.Count);
            foreach (var id in nodeIds)
            {
                nodesToRead.Add(new ReadValueId
                {
                    NodeId = new NodeId(id),
                    AttributeId = Attributes.Value
                });
            }

            var readResponse = await _session.ReadAsync(
                null,
                0,
                TimestampsToReturn.Neither,
                nodesToRead,
                cancellationToken);

            var values = readResponse.Results;

            for (int i = 0; i < nodeIds.Count; i++)
            {
                var id = nodeIds[i];
                var dv = values[i];

                if (StatusCode.IsGood(dv.StatusCode) && dv.Value != null)
                {
                    double rawVal = dv.Value is bool b ? (b ? 1.0 : 0.0) : Convert.ToDouble(dv.Value);
                    result[id] = new OpcUaReadResult { Value = rawVal, Success = true };
                }
                else
                {
                    string errMsg = dv.Value == null ? "Node value is null" : $"Bad status: {dv.StatusCode}";
                    _logger.LogWarning("OPC UA Driver: Bad status {Status} for node {NodeId}", dv.StatusCode, id);
                    result[id] = new OpcUaReadResult { Value = 0.0, Success = false, ErrorMessage = errMsg };
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OPC UA Driver: Batch read failed.");
            throw;
        }

        return result;
    }

    public Dictionary<string, OpcUaReadResult> ReadMetricsBatch(IReadOnlyList<string> nodeIds)
    {
        var result = new Dictionary<string, OpcUaReadResult>(nodeIds.Count);

        if (_session == null || !_session.Connected)
        {
            throw new InvalidOperationException("OPC UA Driver is not connected.");
        }

        try
        {
            var nodesToRead = new ReadValueIdCollection(nodeIds.Count);
            foreach (var id in nodeIds)
            {
                nodesToRead.Add(new ReadValueId
                {
                    NodeId = new NodeId(id),
                    AttributeId = Attributes.Value
                });
            }

            _session.Read(
                requestHeader: null,
                maxAge: 0,
                timestampsToReturn: TimestampsToReturn.Neither,
                nodesToRead: nodesToRead,
                results: out DataValueCollection values,
                diagnosticInfos: out _);

            for (int i = 0; i < nodeIds.Count; i++)
            {
                var id = nodeIds[i];
                var dv = values[i];

                if (StatusCode.IsGood(dv.StatusCode) && dv.Value != null)
                {
                    double rawVal = dv.Value is bool b ? (b ? 1.0 : 0.0) : Convert.ToDouble(dv.Value);
                    result[id] = new OpcUaReadResult { Value = rawVal, Success = true };
                }
                else
                {
                    string errMsg = dv.Value == null ? "Node value is null" : $"Bad status: {dv.StatusCode}";
                    _logger.LogWarning("OPC UA Driver: Bad status {Status} for node {NodeId}", dv.StatusCode, id);
                    result[id] = new OpcUaReadResult { Value = 0.0, Success = false, ErrorMessage = errMsg };
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "OPC UA Driver: Batch read failed.");
            throw;
        }

        return result;
    }

    public void Disconnect()
    {
        if (_session != null)
        {
            try
            {
                _session.Close();
                _session.Dispose();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "OPC UA Driver: Error closing session.");
            }
            _session = null;
        }
    }
    #pragma warning restore CS0618

    public void Dispose()
    {
        Disconnect();
    }

    // Discovers available endpoints on an OPC UA server/host
    public async Task<List<OpcUaEndpointInfo>> DiscoverEndpointsAsync(string discoveryUrl)
    {
        _logger.LogInformation("OPC UA Driver: Querying discovery endpoints at {DiscoveryUrl}...", discoveryUrl);
        var endpoints = new List<OpcUaEndpointInfo>();

        try
        {
            var uri = new Uri(discoveryUrl);
            string baseDir = AppContext.BaseDirectory;
            string certsDir = Path.Combine(baseDir, "certs");

            // Configure default client application settings
            var config = new ApplicationConfiguration
            {
                ApplicationName = "Pulse Edge Agent",
                ApplicationUri = "urn:localhost:Pulse:Edge:Agent",
                ApplicationType = ApplicationType.Client,
                SecurityConfiguration = new SecurityConfiguration
                {
                    ApplicationCertificate = new CertificateIdentifier
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "own"),
                        SubjectName = "CN=Pulse Edge Agent, DC=localhost"
                    },
                    TrustedPeerCertificates = new CertificateTrustList
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "trusted")
                    },
                    TrustedIssuerCertificates = new CertificateTrustList
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "issuer")
                    },
                    RejectedCertificateStore = new CertificateTrustList
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "rejected")
                    },
                    AutoAcceptUntrustedCertificates = true,
                    RejectSHA1SignedCertificates = false
                },
                TransportQuotas = new TransportQuotas { OperationTimeout = 10000 },
                ClientConfiguration = new ClientConfiguration()
            };

            // Use ApplicationInstance to manage certificate generation/verification
            var application = new ApplicationInstance(config, null)
            {
                ApplicationName = "Pulse Edge Agent",
                ApplicationType = ApplicationType.Client
            };

            bool hasCertificate = await application.CheckApplicationInstanceCertificatesAsync(
                silent: true,
                lifeTimeInMonths: 240,
                ct: default
            );

            if (!hasCertificate)
            {
                throw new Exception("Application instance certificate could not be created or validated.");
            }

            await config.ValidateAsync(ApplicationType.Client);

            // Query endpoints using DiscoveryClient
            using (var client = await DiscoveryClient.CreateAsync(config, uri))
            {
                var endpointCollection = await client.GetEndpointsAsync(null);
                foreach (var ep in endpointCollection)
                {
                    endpoints.Add(new OpcUaEndpointInfo
                    {
                        EndpointUrl = ep.EndpointUrl,
                        SecurityMode = ep.SecurityMode.ToString(),
                        SecurityPolicyUri = ep.SecurityPolicyUri
                    });
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OPC UA Driver: Discovery failed for {DiscoveryUrl}", discoveryUrl);
            throw;
        }

        return endpoints;
    }

    // Browses node children hierarchically on an OPC UA server
    #pragma warning disable CS0618 // Disable obsolete warnings for Session.Create, browser.Browse, and SelectEndpoint
    public async Task<List<OpcUaNodeDto>> BrowseNodesAsync(
        string endpointUrl,
        string securityMode,
        string securityPolicy,
        string username,
        string password,
        string? parentNodeId)
    {
        _logger.LogInformation("OPC UA Driver: Browsing children of node {ParentNodeId} at {EndpointUrl}...", parentNodeId, endpointUrl);
        var nodes = new List<OpcUaNodeDto>();

        try
        {
            string baseDir = AppContext.BaseDirectory;
            string certsDir = Path.Combine(baseDir, "certs");

            // Configure default client application settings
            var config = new ApplicationConfiguration
            {
                ApplicationName = "Pulse Edge Agent",
                ApplicationUri = "urn:localhost:Pulse:Edge:Agent",
                ApplicationType = ApplicationType.Client,
                SecurityConfiguration = new SecurityConfiguration
                {
                    ApplicationCertificate = new CertificateIdentifier
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "own"),
                        SubjectName = "CN=Pulse Edge Agent, DC=localhost"
                    },
                    TrustedPeerCertificates = new CertificateTrustList
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "trusted")
                    },
                    TrustedIssuerCertificates = new CertificateTrustList
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "issuer")
                    },
                    RejectedCertificateStore = new CertificateTrustList
                    {
                        StoreType = "Directory",
                        StorePath = Path.Combine(certsDir, "rejected")
                    },
                    AutoAcceptUntrustedCertificates = true,
                    RejectSHA1SignedCertificates = false
                },
                TransportQuotas = new TransportQuotas { OperationTimeout = 10000 },
                ClientConfiguration = new ClientConfiguration()
            };

            // Use ApplicationInstance to manage certificate generation/verification
            var application = new ApplicationInstance(config, null)
            {
                ApplicationName = "Pulse Edge Agent",
                ApplicationType = ApplicationType.Client
            };

            bool hasCertificate = await application.CheckApplicationInstanceCertificatesAsync(
                silent: true,
                lifeTimeInMonths: 240,
                ct: default
            );

            if (!hasCertificate)
            {
                throw new Exception("Application instance certificate could not be created or validated.");
            }

            await config.ValidateAsync(ApplicationType.Client);

            // Select matching endpoint or fallback
            EndpointDescription? selectedEndpoint = null;
            try
            {
                using (var discoveryClient = await DiscoveryClient.CreateAsync(config, new Uri(endpointUrl)))
                {
                    var endpointCollection = await discoveryClient.GetEndpointsAsync(null);
                    selectedEndpoint = endpointCollection.FirstOrDefault(ep =>
                        ep.SecurityMode.ToString().Equals(securityMode, StringComparison.OrdinalIgnoreCase) &&
                        ep.SecurityPolicyUri.Equals(securityPolicy, StringComparison.OrdinalIgnoreCase));
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to query discovery endpoints. Falling back to CoreClientUtils.SelectEndpoint");
            }

            if (selectedEndpoint == null)
            {
                selectedEndpoint = CoreClientUtils.SelectEndpoint(config, endpointUrl, useSecurity: securityMode != "None");
            }

            if (selectedEndpoint == null)
            {
                throw new InvalidOperationException($"No OPC UA endpoint could be selected for '{endpointUrl}'.");
            }

            IUserIdentity userIdentity;
            if (!string.IsNullOrWhiteSpace(username))
            {
                userIdentity = new UserIdentity(new UserNameIdentityToken
                {
                    UserName = username,
                    DecryptedPassword = System.Text.Encoding.UTF8.GetBytes(password ?? string.Empty)
                });
            }
            else
            {
                userIdentity = new UserIdentity(new AnonymousIdentityToken());
            }

            var endpointConfiguration = EndpointConfiguration.Create(config);
            var endpoint = new ConfiguredEndpoint(null, selectedEndpoint, endpointConfiguration);

            using (var session = await Session.Create(
                config,
                endpoint,
                updateBeforeConnect: false,
                checkDomain: false,
                sessionName: "Pulse Edge Agent Node Browser",
                sessionTimeout: 10000,
                identity: userIdentity,
                preferredLocales: null))
            {
                NodeId startNode = string.IsNullOrWhiteSpace(parentNodeId) 
                    ? ObjectIds.ObjectsFolder 
                    : new NodeId(parentNodeId);

                var browser = new Browser(session)
                {
                    BrowseDirection = BrowseDirection.Forward,
                    ReferenceTypeId = ReferenceTypeIds.HierarchicalReferences,
                    IncludeSubtypes = true,
                    NodeClassMask = (int)NodeClass.Object | (int)NodeClass.Variable,
                    ContinueUntilDone = true
                };

                var references = await Task.Run(() => browser.Browse(startNode));

                var variables = references.Where(r => r.NodeClass == NodeClass.Variable).ToList();
                var dataTypes = new Dictionary<string, string>();

                if (variables.Any())
                {
                    try
                    {
                        var nodesToRead = new ReadValueIdCollection();
                        foreach (var v in variables)
                        {
                            nodesToRead.Add(new ReadValueId
                            {
                                NodeId = ExpandedNodeId.ToNodeId(v.NodeId, session.NamespaceUris),
                                AttributeId = Attributes.DataType
                            });
                        }

                        var readResponse = await session.ReadAsync(
                            null,
                            0,
                            TimestampsToReturn.Neither,
                            nodesToRead,
                            default);
                        var results = readResponse.Results;

                        for (int i = 0; i < variables.Count; i++)
                        {
                            var v = variables[i];
                            var result = results[i];
                            string mappedType = "Double";
                            if (StatusCode.IsGood(result.StatusCode) && result.Value is NodeId typeNodeId)
                            {
                                mappedType = MapDataTypeNodeId(typeNodeId);
                            }
                            var fullNodeId = ExpandedNodeId.ToNodeId(v.NodeId, session.NamespaceUris).ToString();
                            dataTypes[fullNodeId] = mappedType;
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to read DataTypes for variable nodes.");
                    }
                }

                foreach (var rd in references)
                {
                    var fullNodeId = ExpandedNodeId.ToNodeId(rd.NodeId, session.NamespaceUris).ToString();
                    nodes.Add(new OpcUaNodeDto
                    {
                        NodeId = fullNodeId,
                        DisplayName = rd.DisplayName?.ToString() ?? rd.BrowseName?.Name ?? string.Empty,
                        NodeClass = rd.NodeClass.ToString(),
                        DataType = dataTypes.ContainsKey(fullNodeId) ? dataTypes[fullNodeId] : string.Empty
                    });
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "OPC UA Driver: Browse failed for {EndpointUrl}", endpointUrl);
            throw;
        }

        return nodes;
    }
    #pragma warning restore CS0618

    private string MapDataTypeNodeId(NodeId dataTypeNodeId)
    {
        if (dataTypeNodeId == DataTypeIds.Boolean) return "Boolean";
        if (dataTypeNodeId == DataTypeIds.Int16) return "Int16";
        if (dataTypeNodeId == DataTypeIds.UInt16) return "UInt16";
        if (dataTypeNodeId == DataTypeIds.Int32) return "Int32";
        if (dataTypeNodeId == DataTypeIds.UInt32) return "UInt32";
        if (dataTypeNodeId == DataTypeIds.Int64) return "Int64";
        if (dataTypeNodeId == DataTypeIds.UInt64) return "UInt64";
        if (dataTypeNodeId == DataTypeIds.Float) return "Float";
        if (dataTypeNodeId == DataTypeIds.Double) return "Double";
        if (dataTypeNodeId == DataTypeIds.String) return "String";
        if (dataTypeNodeId == DataTypeIds.Byte || dataTypeNodeId == DataTypeIds.SByte) return "Int16";
        return "Double"; // Default fallback
    }
}

public class OpcUaEndpointInfo
{
    public string EndpointUrl { get; set; } = string.Empty;
    public string SecurityMode { get; set; } = string.Empty;
    public string SecurityPolicyUri { get; set; } = string.Empty;
}

public class OpcUaNodeDto
{
    public string NodeId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string NodeClass { get; set; } = string.Empty; // "Object", "Variable"
    public string DataType { get; set; } = string.Empty;  // "Boolean", "Double", etc.
}

public class OpcUaReadResult
{
    public double Value { get; set; }
    public bool Success { get; set; }
    public string? ErrorMessage { get; set; }
}
