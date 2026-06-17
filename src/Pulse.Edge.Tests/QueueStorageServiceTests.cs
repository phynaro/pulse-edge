using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Tests;

public class QueueStorageServiceTests
{
    [Fact]
    public async Task TestEnqueueTelemetryBatchAsync_MergesMetricsCorrectly()
    {
        var service = new QueueStorageService();
        await service.InitializeAsync();

        var dataSourceId = "test-batch-ds-" + Guid.NewGuid().ToString("N");
        var now = DateTime.UtcNow;

        var metrics = new Dictionary<string, (double? Value, string Quality)>
        {
            ["metric1"] = (12.34, "Good"),
            ["metric2"] = (56.78, "Good"),
            ["metric3"] = (null, "Bad")
        };

        // Enqueue batch
        await service.EnqueueTelemetryBatchAsync(dataSourceId, now, metrics);

        // Retrieve batch
        var batch = await service.GetPendingTelemetryBatchAsync(batchSize: 100);
        
        try
        {
            // Verify
            var row = batch.FirstOrDefault(x => x.DataSourceId == dataSourceId);
            Assert.NotNull(row);

            // Verify MetricsJson
            var metricsDict = JsonSerializer.Deserialize<Dictionary<string, double>>(row.MetricsJson);
            Assert.NotNull(metricsDict);
            Assert.Equal(12.34, metricsDict["metric1"]);
            Assert.Equal(56.78, metricsDict["metric2"]);
            Assert.False(metricsDict.ContainsKey("metric3")); // Null values are ignored or removed

            // Verify QualitiesJson
            var qualitiesDict = JsonSerializer.Deserialize<Dictionary<string, string>>(row.QualitiesJson);
            Assert.NotNull(qualitiesDict);
            Assert.Equal("Good", qualitiesDict["metric1"]);
            Assert.Equal("Good", qualitiesDict["metric2"]);
            Assert.Equal("Bad", qualitiesDict["metric3"]);
        }
        finally
        {
            // Clean up database
            var idsToDelete = batch.Where(x => x.DataSourceId == dataSourceId).Select(x => x.Id).ToList();
            if (idsToDelete.Any())
            {
                await service.CompleteTelemetryBatchAsync(idsToDelete);
            }
        }
    }
}
