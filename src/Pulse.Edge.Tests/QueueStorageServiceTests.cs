using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
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

    // Regression coverage for the follow-up hardening after the guarded-drop fix: a device
    // whose QueueTelemetry already has MetricsJson (so it's past the legacy-schema drop) but is
    // missing QualitiesJson (a partially-merged schema — e.g. an interrupted upgrade) must be
    // patched in place, not silently left broken and not dropped. Uses an isolated temp-path
    // QueueDbContext (not the shared default-path DB every other test in this suite hits) and
    // calls the extracted QueueStorageService.EnsureTelemetrySchemaAsync(db) migration helper
    // directly, rather than the full InitializeAsync(), because InitializeAsync() always targets
    // the shared default-path database and process-wide locks/guards that would make this
    // partial-schema simulation racy against the rest of the suite.
    [Fact]
    public async Task EnsureTelemetrySchemaAsync_PatchesMissingQualitiesJson_PreservingExistingRows()
    {
        var tempDbPath = Path.Combine(
            Path.GetTempPath(),
            $"pulse-edge-queue-schema-tests-{Guid.NewGuid():N}",
            "edge.db");

        await using var db = new QueueDbContext(tempDbPath);
        await db.Database.EnsureCreatedAsync();

        // Simulate a partial merged-metrics schema: MetricsJson exists, QualitiesJson does not.
        // (EnsureCreatedAsync above creates the FULL current-model QueueTelemetry, so replace it
        // with the deliberately-incomplete legacy shape before exercising the patch.)
        await db.Database.ExecuteSqlRawAsync("DROP TABLE IF EXISTS QueueTelemetry;");
        await db.Database.ExecuteSqlRawAsync(@"
            CREATE TABLE QueueTelemetry (
                Id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                DataSourceId TEXT    NOT NULL,
                Timestamp    TEXT    NOT NULL,
                MetricsJson  TEXT    NOT NULL DEFAULT '{{}}',
                RetryCount   INTEGER NOT NULL DEFAULT 0,
                IsSending    INTEGER NOT NULL DEFAULT 0,
                UNIQUE (DataSourceId, Timestamp)
            );
        ");
        // ExecuteSqlRawAsync treats { and } as composite-format placeholders (same reason the
        // CREATE TABLE DEFAULTs above use '{{}}' for a literal '{}') — so literal braces in this
        // JSON value must be doubled too.
        await db.Database.ExecuteSqlRawAsync(
            "INSERT INTO QueueTelemetry (DataSourceId, Timestamp, MetricsJson) " +
            "VALUES ('DS-partial-schema', '2026-07-19T00:00:00Z', '{{\"temperature\":85.3}}');");

        // Run the same migration InitializeAsync() runs, directly against the temp DB.
        await QueueStorageService.EnsureTelemetrySchemaAsync(db);

        var hasQualitiesJson = (await db.Database
            .SqlQueryRaw<long>("SELECT COUNT(*) AS Value FROM pragma_table_info('QueueTelemetry') WHERE name = 'QualitiesJson'")
            .ToListAsync())
            .Single() > 0;
        Assert.True(hasQualitiesJson);

        var row = (await db.Database
            .SqlQueryRaw<PartialSchemaRow>(
                "SELECT DataSourceId, MetricsJson, QualitiesJson FROM QueueTelemetry WHERE DataSourceId = 'DS-partial-schema'")
            .ToListAsync())
            .Single();

        // Pre-existing row survives the patch untouched, and QualitiesJson backfills to the
        // column default rather than the row being dropped or the insert throwing.
        Assert.Equal("{\"temperature\":85.3}", row.MetricsJson);
        Assert.Equal("{}", row.QualitiesJson);
    }

    private sealed class PartialSchemaRow
    {
        public string DataSourceId { get; set; } = string.Empty;
        public string MetricsJson { get; set; } = string.Empty;
        public string QualitiesJson { get; set; } = string.Empty;
    }
}
