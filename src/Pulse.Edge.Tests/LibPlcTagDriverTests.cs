using System;
using Xunit;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.Edge.Protocols.LibPlcTag;

namespace Pulse.Edge.Tests;

public class LibPlcTagDriverTests
{
    [Fact]
    public void TestDriver_InitialState()
    {
        using var driver = new LibPlcTagDriver(NullLogger<LibPlcTagDriver>.Instance);
        Assert.False(driver.IsConnected);
    }

    [Fact]
    public void TestDriver_ConnectConfiguresState()
    {
        using var driver = new LibPlcTagDriver(NullLogger<LibPlcTagDriver>.Instance);
        driver.Connect("192.168.1.50", "ControlLogix", "Ethernet/IP", "1,0", 3000);
        
        Assert.True(driver.IsConnected);
        
        driver.Disconnect();
        Assert.False(driver.IsConnected);
    }

    [Fact]
    public void TestDriver_InvalidDataTypeThrows()
    {
        using var driver = new LibPlcTagDriver(NullLogger<LibPlcTagDriver>.Instance);
        driver.Connect("192.168.1.50", "ControlLogix", "Ethernet/IP", "1,0", 3000);

        Assert.Throws<NotSupportedException>(() => driver.ReadTag("SomeTag", "InvalidType"));
    }
}
