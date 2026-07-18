using System;
using System.IO;
using System.Runtime.CompilerServices;
using Pulse.Edge.Storage.Services;
using Pulse.Edge.Tests.Integration;

namespace Pulse.Edge.Tests;

/// <summary>
/// Assembly-wide test-database isolation. Runs before ANY test code: pins
/// PULSE_EDGE_DATA_DIR to the suite's isolated directory so no test can ever
/// touch the real device DB (~/.pulse/edge.db), and initializes the schema
/// once so concurrent first-use InitializeAsync calls stop racing.
/// PulseEdgeAppFactory's static ctor sets the same value, so ordering no
/// longer matters.
/// </summary>
internal static class TestDatabaseBootstrap
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        Directory.CreateDirectory(PulseEdgeAppFactory.DataDir);
        Environment.SetEnvironmentVariable("PULSE_EDGE_DATA_DIR", PulseEdgeAppFactory.DataDir);
        new QueueStorageService().InitializeAsync().GetAwaiter().GetResult();
    }
}
