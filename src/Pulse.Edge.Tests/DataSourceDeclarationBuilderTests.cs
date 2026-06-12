using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Tests;

public class DataSourceDeclarationBuilderTests
{
    private static DriverAdapter Adapter(string id, string protocol) => new()
    {
        Id = id,
        Name = id,
        Protocol = protocol,
        Host = "127.0.0.1",
        Port = 1,
    };

    private static DataPoint Point(
        string metric,
        string adapterId,
        string dataSourceId,
        string address = "addr",
        string dataType = "Float") => new()
    {
        Id = $"{metric}-dp",
        AdapterId = adapterId,
        DataSourceId = dataSourceId,
        Metric = metric,
        Address = address,
        DataType = dataType,
        ScanIntervalMs = 1000,
        ScaleFactor = 1,
        Offset = 0,
        ByteOrder = "ABCD",
        MqttParseMode = "Plaintext",
    };

    [Theory]
    [InlineData("OPC_UA", "opcua")]
    [InlineData("MODBUS_TCP", "modbus")]
    [InlineData("MODBUS_RTU", "modbus")]
    [InlineData("MQTT", "mqtt")]
    [InlineData("WEBHOOK", "mqtt")]
    [InlineData("Ethernet/IP", "opcua")]
    public void NormalizeProtocol_MapsAdapterProtocols(string adapterProtocol, string expected)
    {
        Assert.Equal(expected, DataSourceDeclarationBuilder.NormalizeProtocol(adapterProtocol));
    }

    [Fact]
    public void BuildMetricsForDataSource_SupportsMixedProtocolsInOneStream()
    {
        var dsId = "ds-1";
        var adapters = new Dictionary<string, DriverAdapter>(StringComparer.Ordinal)
        {
            ["opc"] = Adapter("opc", "OPC_UA"),
            ["mod"] = Adapter("mod", "MODBUS_TCP"),
        };

        var points = new List<DataPoint>
        {
            Point("temp_c", "opc", dsId, "ns=2;s=Temp"),
            Point("kw", "mod", dsId, "40001", "Int32"),
        };

        var metrics = DataSourceDeclarationBuilder.BuildMetricsForDataSource(dsId, points, adapters);

        Assert.Equal(2, metrics.Count);
        var temp = metrics.Single(m => m.Name == "temp_c");
        var kw = metrics.Single(m => m.Name == "kw");
        Assert.Equal("opcua", temp.Protocol);
        Assert.Equal("modbus", kw.Protocol);
        Assert.Equal("ns=2;s=Temp", temp.Metadata.Address);
        Assert.Equal("40001", kw.Metadata.Address);
    }

    [Fact]
    public void ComputeDeclarationHash_ChangesWhenMetadataChanges()
    {
        var ds = new DataSource { Id = "ds-1", Name = "Line 1", IsEnabled = true };
        var adapters = new Dictionary<string, DriverAdapter>(StringComparer.Ordinal)
        {
            ["opc"] = Adapter("opc", "OPC_UA"),
        };

        var before = DataSourceDeclarationBuilder.ComputeDeclarationHash(
            [ds],
            [Point("temp_c", "opc", ds.Id, "ns=2;s=Temp")],
            adapters);

        var after = DataSourceDeclarationBuilder.ComputeDeclarationHash(
            [ds],
            [Point("temp_c", "opc", ds.Id, "ns=2;s=TempChanged")],
            adapters);

        Assert.NotEqual(before, after);
    }
}
