using System;
using System.Collections.Generic;
using System.Linq;

namespace Pulse.Edge.Agent.Drivers;

public class DriverPollerRegistry
{
    private readonly Dictionary<string, IProtocolDriver> _drivers;
    private readonly CustomSimulatedDriverPoller _fallbackDriver;

    public DriverPollerRegistry(
        IEnumerable<IProtocolDriver> drivers,
        CustomSimulatedDriverPoller fallbackDriver)
    {
        _drivers = drivers
            .Where(x => x.ProtocolName != "CUSTOM_SIMULATED")
            .ToDictionary(
                x => x.ProtocolName.ToUpperInvariant(),
                x => x);
        _fallbackDriver = fallbackDriver;
    }

    public IProtocolDriver GetPoller(string protocol)
    {
        if (string.IsNullOrWhiteSpace(protocol)) return _fallbackDriver;

        var normalized = protocol.ToUpperInvariant();

        // Map Modbus variations to MODBUS_TCP poller
        if (normalized == "MODBUS_TCP" || normalized == "MODBUS_RTU")
        {
            normalized = "MODBUS_TCP";
        }

        return _drivers.TryGetValue(normalized, out var driver) ? driver : _fallbackDriver;
    }
}
