using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Cloud.Services;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Services;

/// <summary>
/// Dedicated delivery loop for the OEE data plane (know-how/cloud_oee_ingestion.md §4).
/// Independent of the telemetry SyncService so a telemetry backlog can never starve OEE
/// liveness (the cloud records no-data after ~180 s of silence). Declares channels before
/// events; drains the outbox with exponential backoff 5 s → 5 min; rows leave the outbox
/// only on 202 acknowledgment (or terminal "invalid message" rejection).
/// </summary>
public class OeeSyncService : BackgroundService
{
    private const int MaxBatchSize = 1000;   // contract recommends ≤ 1000 (≈1 MB body limit)
    private const int MinBackoffSeconds = 5;
    private const int MaxBackoffSeconds = 300;
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(2);

    private readonly ILogger<OeeSyncService> _logger;
    private readonly QueueStorageService _queueStorage;
    private readonly OeeStorageService _oeeStorage;
    private readonly CloudClient _cloudClient;

    private int _backoffSeconds = MinBackoffSeconds;
    private int _batchSize = MaxBatchSize;
    private bool _hasDeclared;
    private DateTime _declaredThroughUtc = DateTime.MinValue;

    public OeeSyncService(
        ILogger<OeeSyncService> logger,
        QueueStorageService queueStorage,
        OeeStorageService oeeStorage,
        CloudClient cloudClient)
    {
        _logger = logger;
        _queueStorage = queueStorage;
        _oeeStorage = oeeStorage;
        _cloudClient = cloudClient;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("OEE sync loop started.");
        while (!stoppingToken.IsCancellationRequested)
        {
            bool ok;
            try
            {
                ok = await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error in OEE sync loop.");
                ok = false;
            }

            if (ok)
            {
                _backoffSeconds = MinBackoffSeconds;
                _batchSize = MaxBatchSize;
                try { await Task.Delay(IdleDelay, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
            else
            {
                var delay = TimeSpan.FromSeconds(_backoffSeconds);
                _backoffSeconds = Math.Min(_backoffSeconds * 2, MaxBackoffSeconds);
                _logger.LogWarning("[OEE Sync] Backing off {Delay}s before retry.", delay.TotalSeconds);
                try { await Task.Delay(delay, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
    }

    /// <summary>
    /// One iteration: declare if needed, then drain one batch.
    /// Returns false when a transient/auth failure occurred (caller backs off).
    /// Public (not internal) for test access — InternalsVisibleTo collides with the hosts' implicit Program types (CS0433).
    /// </summary>
    public async Task<bool> RunOnceAsync(CancellationToken ct)
    {
        var config = await _queueStorage.GetDeviceConfigAsync();
        if (config == null || !config.IsSyncEnabled || string.IsNullOrEmpty(config.ApiKey))
        {
            return true; // idle quietly; provisioning owns credential acquisition
        }

        var baseUrl = config.CloudEndpoint ?? "http://localhost:3000";
        var channels = await _oeeStorage.GetChannelsAsync();

        // Declare enabled channels PLUS any channel that still holds undelivered outbox rows.
        // A channel can be disabled while rows buffered during a cloud outage are still queued
        // (e.g. operator disables it, then the device/cloud connection recovers). If we only
        // declared enabled channels, those rows would be sent against an undeclared channel,
        // rejected as "unknown channel", released, and re-sent every ~2 s forever — an infinite
        // spin that only stops if the channel is re-enabled or deleted.
        var pendingIds = await _oeeStorage.GetChannelIdsWithPendingMessagesAsync();
        var declarable = channels.Where(c => c.Enabled || pendingIds.Contains(c.Id)).ToList();
        if (declarable.Count == 0) return true;

        // ── Declaration before events (contract §2.2) ─────────────────────────
        var latestUpdate = declarable.Max(c => c.UpdatedAt);
        if (!_hasDeclared || latestUpdate > _declaredThroughUtc)
        {
            var declarations = declarable.Select(c => new CloudClient.OeeChannelDeclarationDto(
                c.ExternalId,
                c.Name,
                string.IsNullOrEmpty(c.GoodDataPointId)
                    ? new[] { "state" }
                    : new[] { "state", "counters" })).ToList();

            var declareResult = await _cloudClient.DeclareOeeChannelsAsync(baseUrl, config.ApiKey, declarations);
            if (declareResult == OeeSyncResult.Unauthorized)
            {
                await HandleUnauthorizedAsync(config);
                return false;
            }
            if (declareResult != OeeSyncResult.Success)
            {
                return false; // includes NotPaired + EnvelopeError + Transient: no events until declared
            }
            _hasDeclared = true;
            _declaredThroughUtc = latestUpdate;
        }

        // ── Drain one batch ──────────────────────────────────────────────────
        var batch = await _oeeStorage.GetPendingBatchAsync(_batchSize);
        if (batch.Count == 0) return true;

        // Map rows to wire messages; rows whose channel disappeared are orphans → delete.
        var byId = channels.ToDictionary(c => c.Id);
        var orphanIds = batch.Where(m => !byId.ContainsKey(m.ChannelId)).Select(m => m.Id).ToList();
        if (orphanIds.Count > 0)
        {
            await _oeeStorage.CompleteBatchAsync(orphanIds);
            batch = batch.Where(m => byId.ContainsKey(m.ChannelId)).ToList();
            if (batch.Count == 0) return true;
        }

        var messages = batch.Select(m => new CloudClient.OeeEventMessageDto
        {
            Type = m.Type,
            Channel = byId[m.ChannelId].ExternalId,
            Seq = m.Seq,
            Ts = DateTime.SpecifyKind(m.Ts, DateTimeKind.Utc)
                .ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture),
            State = m.State,
            Code = m.Code,
            Counters = m.GoodCount.HasValue
                ? new CloudClient.OeeCountersDto { Good = m.GoodCount.Value, Reject = m.RejectCount }
                : null,
        }).ToList();

        var (result, response) = await _cloudClient.SendOeeEventsBatchAsync(baseUrl, config.ApiKey, messages);

        switch (result)
        {
            case OeeSyncResult.Success:
                var outcome = ClassifyResponse(batch.Count, response);

                var ackIds = outcome.AcceptedIndexes.Select(i => batch[i].Id).ToList();
                if (ackIds.Count > 0) await _oeeStorage.CompleteBatchAsync(ackIds);

                if (outcome.InvalidIndexes.Count > 0)
                {
                    // Terminal per the contract: fix the producer; retrying can never succeed.
                    await _oeeStorage.CompleteBatchAsync(outcome.InvalidIndexes.Select(i => batch[i].Id));
                    await RecordInvalidMessageDiagnosticAsync(outcome.InvalidIndexes.Count, response);
                }

                if (outcome.UnknownChannelIndexes.Count > 0)
                {
                    await _oeeStorage.ReleaseBatchAsync(outcome.UnknownChannelIndexes.Select(i => batch[i].Id));
                    _hasDeclared = false; // re-declare before the retry
                }
                _logger.LogInformation("[OEE Sync] Batch done: {Ack} acked, {Inv} invalid-dropped, {Unk} awaiting re-declaration.",
                    ackIds.Count, outcome.InvalidIndexes.Count, outcome.UnknownChannelIndexes.Count);
                return true;

            case OeeSyncResult.EnvelopeError:
                // Envelope 400 is an edge bug: never retry unchanged — halve the batch.
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                _batchSize = Math.Max(1, _batchSize / 2);
                _logger.LogError("[OEE Sync] Envelope rejected (400). Halving batch size to {Size}.", _batchSize);
                return false;

            case OeeSyncResult.Unauthorized:
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                await HandleUnauthorizedAsync(config);
                return false;

            case OeeSyncResult.NotPaired:
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                _logger.LogError("[OEE Sync] Device not paired to a site (409). Waiting for re-pairing.");
                _backoffSeconds = MaxBackoffSeconds;
                return false;

            default: // TransientError: keep the whole batch, re-send after backoff (dedup makes replay safe)
                await _oeeStorage.ReleaseBatchAsync(batch.Select(m => m.Id));
                return false;
        }
    }

    /// <summary>Public (not internal) for test access — InternalsVisibleTo collides with the hosts' implicit Program types (CS0433).</summary>
    public record BatchOutcome(
        List<int> AcceptedIndexes,
        List<int> InvalidIndexes,
        List<int> UnknownChannelIndexes);

    /// <summary>Public (not internal) for test access — InternalsVisibleTo collides with the hosts' implicit Program types (CS0433).</summary>
    public static BatchOutcome ClassifyResponse(int batchCount, CloudClient.OeeEventsResponse? response)
    {
        if (response == null)
        {
            // A 202 with an unreadable body: acknowledge nothing; the full-batch
            // re-send reconciles (duplicates are no-ops server-side).
            return new BatchOutcome(new List<int>(), new List<int>(), new List<int>());
        }

        var invalid = new List<int>();
        var unknown = new List<int>();
        var errorIndexes = new HashSet<int>();
        foreach (var err in response.Errors ?? new List<CloudClient.OeeEventsResponseError>())
        {
            if (err.Index < 0 || err.Index >= batchCount) continue;
            errorIndexes.Add(err.Index);
            if (err.Reason.StartsWith("unknown channel", StringComparison.OrdinalIgnoreCase))
                unknown.Add(err.Index);
            else
                invalid.Add(err.Index);
        }

        var accepted = Enumerable.Range(0, batchCount).Where(i => !errorIndexes.Contains(i)).ToList();
        return new BatchOutcome(accepted, invalid, unknown);
    }

    private async Task HandleUnauthorizedAsync(DeviceConfig config)
    {
        _logger.LogError("[OEE Sync] Unauthorized (401). API key revoked — stopping OEE sync until re-claimed.");
        config.ApiKey = "";
        config.SiteId = "";
        config.SiteName = "";
        config.CloudStatus = "Revoked";
        await _queueStorage.SaveDeviceConfigAsync(config);
    }

    private static async Task RecordInvalidMessageDiagnosticAsync(int count, CloudClient.OeeEventsResponse? response)
    {
        using var db = new QueueDbContext();
        db.DiagnosticEvents.Add(new DiagnosticEvent
        {
            TimestampUtc = DateTime.UtcNow,
            Level = "Error",
            Category = typeof(OeeSyncService).FullName ?? nameof(OeeSyncService),
            EventCode = "OEE_INVALID_MESSAGE",
            Message = $"{count} OEE message(s) were rejected as invalid by the cloud and dropped.",
            Details = "Terminal rejection: the message failed cloud-side validation and can never succeed on retry. This indicates an edge producer bug.",
        });
        await db.SaveChangesAsync();
    }
}
