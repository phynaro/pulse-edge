using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using Microsoft.Extensions.DependencyInjection;

namespace Pulse.Edge.Agent.Drivers;

public class DriverPollerRegistry
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ConcurrentDictionary<string, IProtocolDriver> _activePollers = new();

    private static readonly Dictionary<string, Type> _pollerTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        { "OPC_UA", typeof(OpcUaDriverPoller) },
        { "MODBUS_TCP", typeof(ModbusDriverPoller) },
        { "MODBUS_RTU", typeof(ModbusDriverPoller) },
        { "MQTT", typeof(MqttDriverPoller) },
        { "BACNET", typeof(BacnetDriverPoller) },
        { "S7", typeof(S7DriverPoller) },
        { "REST_API", typeof(RestApiDriverPoller) },
        { "LIBPLCTAG", typeof(LibPlcTagDriverPoller) },
        { "SIMULATOR", typeof(SimulatorDriverPoller) }
    };

    public DriverPollerRegistry(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public IProtocolDriver? GetPoller(string adapterId, string protocol)
    {
        if (string.IsNullOrWhiteSpace(protocol) || string.IsNullOrWhiteSpace(adapterId))
            return null;

        var normalized = protocol.ToUpperInvariant();
        if (normalized == "MODBUS_TCP" || normalized == "MODBUS_RTU")
        {
            normalized = "MODBUS_TCP";
        }

        return _activePollers.GetOrAdd(adapterId, id =>
        {
            if (!_pollerTypes.TryGetValue(normalized, out var type))
            {
                return null!;
            }
            return (IProtocolDriver)ActivatorUtilities.CreateInstance(_serviceProvider, type);
        });
    }
}
