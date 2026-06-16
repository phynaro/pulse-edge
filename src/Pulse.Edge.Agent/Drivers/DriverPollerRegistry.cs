using System;
using System.Collections.Generic;
using System.Linq;

namespace Pulse.Edge.Agent.Drivers;

public class DriverPollerRegistry
{
    private readonly Dictionary<string, IProtocolDriver> _drivers;

    public DriverPollerRegistry(IEnumerable<IProtocolDriver> drivers)
    {
        _drivers = drivers
            .ToDictionary(
                x => x.ProtocolName.ToUpperInvariant(),
                x => x);
    }

    public IProtocolDriver? GetPoller(string protocol)
    {
        if (string.IsNullOrWhiteSpace(protocol)) return null;

        var normalized = protocol.ToUpperInvariant();

        // Map Modbus variations to MODBUS_TCP poller
        if (normalized == "MODBUS_TCP" || normalized == "MODBUS_RTU")
        {
            normalized = "MODBUS_TCP";
        }

        return _drivers.TryGetValue(normalized, out var driver) ? driver : null;
    }
}
