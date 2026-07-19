using System;
using System.IO;
using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
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

        // The itests DB dir above is pinned for the whole suite and persists across
        // runs (it's not deleted between `dotnet test` invocations). OEE tests assume
        // a clean slate because OeeSyncService.RunOnceAsync drains the outbox and
        // declares channels GLOBALLY (not scoped to one test's channel) — a leftover
        // OeeChannel/OeeOutboxMessage row from a prior run (or a test that forgot to
        // clean up) silently breaks unrelated tests' scripted-handler assertions. Purge
        // both tables once, at the very start of the suite, before any test runs. This
        // is always the isolated test DB (PULSE_EDGE_DATA_DIR above), never the real
        // device DB.
        using var db = new QueueDbContext();
        db.Database.ExecuteSqlRaw("DELETE FROM OeeOutboxMessages;");
        db.Database.ExecuteSqlRaw("DELETE FROM OeeChannels;");

        // Same persistence problem hits QueueTelemetry: QueueStorageServiceTests is the
        // only test that ever writes to it, and GetPendingTelemetryBatchAsync returns only
        // the oldest 100 unsent rows ordered by timestamp. Any row stuck behind IsSending
        // from an earlier crashed/killed run (never cleaned up because the test only
        // deletes rows matching ITS OWN freshly-generated dataSourceId) sits in front of
        // every future run's brand-new row forever, since new rows always sort last by
        // timestamp — eventually starving that test out of its own top-100 window. Purge it
        // at the same suite-start point as the OEE tables above.
        db.Database.ExecuteSqlRaw("DELETE FROM QueueTelemetry;");
    }
}
