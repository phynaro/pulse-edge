using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Agent.Drivers;

public interface IProtocolDriver
{
    string ProtocolName { get; }
    bool IsConnected { get; }
    Task ConnectAsync(DriverAdapter adapter, CancellationToken ct);
    Task DisconnectAsync(CancellationToken ct);
    Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct);
}
