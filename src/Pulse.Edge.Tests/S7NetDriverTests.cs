using System;
using Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Protocols.S7Net;

namespace Pulse.Edge.Tests;

public class S7NetDriverTests
{
    [Fact]
    public void TestDriver_InitialState()
    {
        using var driver = new S7NetDriver(NullLogger<S7NetDriver>.Instance);
        Assert.False(driver.IsConnected);
    }

    [Fact]
    public void TestDriver_ConnectToInvalidHostThrows()
    {
        using var driver = new S7NetDriver(NullLogger<S7NetDriver>.Instance);
        // Connect should fail immediately on a non-existent IP
        Assert.ThrowsAny<Exception>(() => driver.Connect("192.0.2.1", "S7-1200", 0, 1, 100));
    }
}
