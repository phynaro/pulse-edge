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

    [Fact]
    public void TestTagPropertiesCompile()
    {
        using var tag = new libplctag.Tag
        {
            Name = "@udt/1",
            Gateway = "127.0.0.1",
            Path = "1,0",
            PlcType = libplctag.PlcType.ControlLogix,
            Protocol = libplctag.Protocol.ab_eip,
            ElementSize = 1,
            ElementCount = 2048
        };
        
        var type = tag.GetType();
        foreach (var prop in type.GetProperties())
        {
            Console.WriteLine($"[PROP] {prop.Name} : {prop.PropertyType}");
        }
        foreach (var method in type.GetMethods())
        {
            Console.WriteLine($"[METHOD] {method.Name}");
        }
    }

    [Fact]
    public void TestParseTemplatePayload_UDT969()
    {
        string hex = "C90358000000DC0300000D00759C0000CE8F000000000000C400580000000000C4005C0000000000C400600000000000C400640000000000CA00680000000000CA006C0000000000C400700000000A00C420740000000000C2009C0000000000C1009C0000000100C1009C00000000002B87A00000004D414348494E455F5245434950453B6E41414541454145414541484148414541454145424543454341410050726F647563744E616D650054797065005061636B506572426F78005061636B5065725069636B005063735065725061636B005061636B5065724D696E00426F785065724D696E004C61796572005061636B506572537461636B005A5A5A5A5A5A5A5A5A5A4D414348494E455F52453900466C69704F6E4C617374526F7700466C69704F6E4669727374526F77004D616368696E6553657474696E670000000D697C808F8B36D2A13240B0C32653826A7836E9A14D86941A11";
        byte[] rawBytes = ConvertHexToBytes(hex);
        
        var members = LibPlcTagDriver.ParseTemplatePayload(rawBytes, 969, NullLogger<LibPlcTagDriver>.Instance);
        
        Assert.Equal(13, members.Count);
        
        Assert.Equal("ProductName", members[0].Name);
        Assert.Equal("Structure", members[0].DataType);
        Assert.Equal(0u, members[0].Offset);
        
        Assert.Equal("Type", members[1].Name);
        Assert.Equal("INT32", members[1].DataType);
        Assert.Equal(88u, members[1].Offset);
        
        Assert.Equal("PackPerBox", members[2].Name);
        Assert.Equal("INT32", members[2].DataType);
        Assert.Equal(92u, members[2].Offset);
        
        Assert.Equal("PackPerPick", members[3].Name);
        Assert.Equal("INT32", members[3].DataType);
        Assert.Equal(96u, members[3].Offset);
        
        Assert.Equal("PcsPerPack", members[4].Name);
        Assert.Equal("INT32", members[4].DataType);
        Assert.Equal(100u, members[4].Offset);
        
        Assert.Equal("PackPerMin", members[5].Name);
        Assert.Equal("REAL", members[5].DataType);
        Assert.Equal(104u, members[5].Offset);
        
        Assert.Equal("BoxPerMin", members[6].Name);
        Assert.Equal("REAL", members[6].DataType);
        Assert.Equal(108u, members[6].Offset);
        
        Assert.Equal("Layer", members[7].Name);
        Assert.Equal("INT32", members[7].DataType);
        Assert.Equal(112u, members[7].Offset);
        
        Assert.Equal("PackPerStack", members[8].Name);
        Assert.Equal("INT32", members[8].DataType);
        Assert.Equal(116u, members[8].Offset);
        
        Assert.Equal("ZZZZZZZZZZMACHINE_RE9", members[9].Name);
        Assert.Equal("SINT", members[9].DataType);
        Assert.Equal(156u, members[9].Offset);
        
        Assert.Equal("FlipOnLastRow", members[10].Name);
        Assert.Equal("BOOL", members[10].DataType);
        Assert.Equal(156u, members[10].Offset);
        
        Assert.Equal("FlipOnFirstRow", members[11].Name);
        Assert.Equal("BOOL", members[11].DataType);
        Assert.Equal(156u, members[11].Offset);
        
        Assert.Equal("MachineSetting", members[12].Name);
        Assert.Equal("Structure", members[12].DataType);
        Assert.Equal(160u, members[12].Offset);
    }

    private byte[] ConvertHexToBytes(string hex)
    {
        byte[] bytes = new byte[hex.Length / 2];
        for (int i = 0; i < bytes.Length; i++)
        {
            bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
        }
        return bytes;
    }
}

