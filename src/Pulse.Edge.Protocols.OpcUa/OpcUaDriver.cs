using System;
using Microsoft.Extensions.Logging;

namespace Pulse.Edge.Protocols.OpcUa;

public class OpcUaDriver
{
    private readonly ILogger<OpcUaDriver> _logger;

    public OpcUaDriver(ILogger<OpcUaDriver> logger)
    {
        _logger = logger;
    }

    public void Connect(string endpointUrl)
    {
        _logger.LogInformation("OPC UA Driver: Initializing connection to OPC UA Endpoint at {Endpoint}...", endpointUrl);
    }

    public double ReadMetric(string nodeId)
    {
        // Simulates polling an OPC UA node for data
        double mockValue = Math.Round(Random.Shared.NextDouble() * 100.0, 2);
        return mockValue;
    }
}
