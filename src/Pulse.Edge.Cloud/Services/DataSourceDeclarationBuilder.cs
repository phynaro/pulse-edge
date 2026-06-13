using System.Text;
using System.Text.Json;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Cloud.Services;

public static class DataSourceDeclarationBuilder
{
    public static string? NormalizeProtocol(string? adapterProtocol)
    {
        if (string.IsNullOrWhiteSpace(adapterProtocol)) return null;

        var proto = adapterProtocol.ToLowerInvariant().Replace("_", string.Empty).Replace("/", string.Empty);
        return proto switch
        {
            "modbustcp" => "modbus",
            "modbusrtu" => "modbus",
            "modbus" => "modbus",
            "opcua" => "opcua",
            "ethernetip" => "opcua",
            "mqtt" => "mqtt",
            "webhook" => "mqtt",
            "restapi" => "mqtt",
            _ => "opcua",
        };
    }

    public static CloudClient.CloudMetricMetadataDto BuildMetadata(DataPoint dp) =>
        new(
            AdapterId: dp.AdapterId,
            MqttDeviceId: dp.MqttDeviceId,
            Address: dp.Address,
            DataType: dp.DataType,
            ScanIntervalMs: dp.ScanIntervalMs,
            ScaleFactor: dp.ScaleFactor,
            Offset: dp.Offset,
            ByteOrder: dp.ByteOrder,
            MqttParseMode: dp.MqttParseMode,
            MqttJsonPath: dp.MqttJsonPath
        );

    public static CloudClient.CloudMetricDto BuildMetricDto(DataPoint dp, DriverAdapter adapter)
    {
        var protocol = NormalizeProtocol(adapter.Protocol) ?? "opcua";
        return new CloudClient.CloudMetricDto(
            Name: dp.Metric!,
            Protocol: protocol,
            Metadata: BuildMetadata(dp)
        );
    }

    public static List<CloudClient.CloudMetricDto> BuildMetricsForDataSource(
        string dataSourceId,
        IEnumerable<DataPoint> dataPoints,
        IReadOnlyDictionary<string, DriverAdapter> adaptersById)
    {
        return dataPoints
            .Where(dp => dp.DataSourceId == dataSourceId && !string.IsNullOrEmpty(dp.Metric))
            .GroupBy(dp => dp.Metric!, StringComparer.Ordinal)
            .Select(g => g.First())
            .OrderBy(dp => dp.Metric, StringComparer.Ordinal)
            .Select(dp =>
            {
                if (!adaptersById.TryGetValue(dp.AdapterId, out var adapter))
                {
                    throw new InvalidOperationException($"Adapter {dp.AdapterId} not found for metric {dp.Metric}");
                }

                return BuildMetricDto(dp, adapter);
            })
            .ToList();
    }

    public static string ComputeDeclarationHash(
        IEnumerable<DataSource> dataSources,
        IEnumerable<DataPoint> dataPoints,
        IReadOnlyDictionary<string, DriverAdapter> adaptersById)
    {
        var sb = new StringBuilder();

        foreach (var ds in dataSources.OrderBy(x => x.Id, StringComparer.Ordinal))
        {
            var metrics = BuildMetricsForDataSource(ds.Id, dataPoints, adaptersById);
            sb.Append($"{ds.Id}:{ds.Name}:{ds.IsEnabled}:");
            foreach (var metric in metrics)
            {
                sb.Append($"{metric.Name}:{metric.Protocol}:{SerializeMetadata(metric.Metadata)};");
            }

            sb.Append('|');
        }

        return sb.ToString();
    }

    internal static string SerializeMetadata(CloudClient.CloudMetricMetadataDto metadata) =>
        JsonSerializer.Serialize(metadata, CloudClient.JsonOptions);
}
