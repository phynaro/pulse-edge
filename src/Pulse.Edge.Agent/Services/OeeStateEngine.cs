using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Services;

/// <summary>
/// The contract's "dumb, reliable observer" (know-how/cloud_oee_ingestion.md):
/// turns polled tag values into debounced state transitions and 60-second syncs,
/// appended to the durable outbox. No network access, no business logic.
/// Worker calls EvaluateAsync once per poll loop tick with the freshly polled DataPoints.
/// </summary>
public class OeeStateEngine
{
    private static readonly TimeSpan SyncInterval = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan ChannelCacheTtl = TimeSpan.FromSeconds(5);
    private const int MaxCodeLength = 64;

    private readonly ILogger<OeeStateEngine> _logger;
    private readonly OeeStorageService _storage;

    private List<OeeChannel> _channels = new();
    private DateTime _channelsLoadedAt = DateTime.MinValue;
    private readonly Dictionary<int, ChannelRuntime> _runtime = new();

    private sealed class ChannelRuntime
    {
        public string? CommittedState;
        public string? CandidateState;
        public DateTime CandidateFirstSeen;
        public string? LastCode;
        public DateTime LastSyncUtc = DateTime.MinValue;
    }

    public OeeStateEngine(ILogger<OeeStateEngine> logger, OeeStorageService storage)
    {
        _logger = logger;
        _storage = storage;
    }

    public async Task EvaluateAsync(IReadOnlyList<DataPoint> polledDataPoints, DateTime nowUtc)
    {
        if (nowUtc - _channelsLoadedAt >= ChannelCacheTtl)
        {
            _channels = await _storage.GetChannelsAsync();
            _channelsLoadedAt = nowUtc;
            // Forget runtime state for channels that no longer exist (or were disabled),
            // so a re-enabled channel does a fresh boot sync.
            var liveIds = _channels.Where(c => c.Enabled).Select(c => c.Id).ToHashSet();
            foreach (var stale in _runtime.Keys.Where(id => !liveIds.Contains(id)).ToList())
            {
                _runtime.Remove(stale);
            }
        }

        var byId = polledDataPoints
            .GroupBy(dp => dp.Id)
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var channel in _channels.Where(c => c.Enabled))
        {
            try
            {
                await EvaluateChannelAsync(channel, byId, nowUtc);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OEE evaluation failed for channel {ExternalId}", channel.ExternalId);
            }
        }
    }

    private async Task EvaluateChannelAsync(
        OeeChannel channel, Dictionary<string, DataPoint> byId, DateTime nowUtc)
    {
        if (!_runtime.TryGetValue(channel.Id, out var rt))
        {
            rt = new ChannelRuntime();
            _runtime[channel.Id] = rt;
        }

        // ── Derive candidate state from the bound signals ─────────────────────
        string? candidate = null;
        string? code = null;

        bool runValid = TryReadSignal(byId, channel.RunDataPointId, out var runValue);
        bool faultBound = !string.IsNullOrEmpty(channel.FaultDataPointId);
        bool faultValid = !faultBound || TryReadSignal(byId, channel.FaultDataPointId!, out _);

        if (runValid && faultValid)
        {
            double faultValue = 0;
            if (faultBound)
            {
                TryReadSignal(byId, channel.FaultDataPointId!, out faultValue);
            }
            // fault only from a real bound fault signal; fault wins over running. Never inferred.
            candidate = faultValue != 0 ? "fault" : (runValue != 0 ? "running" : "stopped");
        }
        // else: signal invalid (comms lost / unparsable) → hold last committed state,
        // change nothing. A dead cable is not a machine stop.

        if (!string.IsNullOrEmpty(channel.CodeDataPointId)
            && byId.TryGetValue(channel.CodeDataPointId!, out var codeDp)
            && codeDp.LastError == null
            && !string.IsNullOrEmpty(codeDp.LastValue))
        {
            code = codeDp.LastValue!.Length > MaxCodeLength
                ? codeDp.LastValue.Substring(0, MaxCodeLength)
                : codeDp.LastValue;
        }

        // ── Counters (cumulative totalizers; omit when the read failed) ───────
        long? good = null, reject = null;
        if (!string.IsNullOrEmpty(channel.GoodDataPointId)
            && TryReadSignal(byId, channel.GoodDataPointId!, out var goodValue))
        {
            good = (long)Math.Round(goodValue);
            if (!string.IsNullOrEmpty(channel.RejectDataPointId)
                && TryReadSignal(byId, channel.RejectDataPointId!, out var rejectValue))
            {
                reject = (long)Math.Round(rejectValue);
            }
        }

        // ── Debounced commit (on-delay-timer semantics) ───────────────────────
        if (candidate != null)
        {
            if (candidate != rt.CandidateState)
            {
                rt.CandidateState = candidate;
                rt.CandidateFirstSeen = nowUtc;
            }

            if (rt.CommittedState == null)
            {
                // First valid observation: commit silently; the boot sync below asserts it.
                rt.CommittedState = candidate;
                rt.LastCode = code;
            }
            else if (candidate != rt.CommittedState
                     && (nowUtc - rt.CandidateFirstSeen).TotalSeconds >= channel.DebounceSeconds)
            {
                rt.CommittedState = candidate;
                rt.LastCode = code;
                // ts = when the candidate was FIRST observed — honest interval boundary.
                await _storage.EnqueueMessageAsync(
                    channel.Id, "state", rt.CandidateFirstSeen, candidate, code, good, reject);
                _logger.LogInformation("[OEE] {ExternalId} → {State}{Code}",
                    channel.ExternalId, candidate, code != null ? $" (code {code})" : "");
            }
            else if (candidate == rt.CommittedState)
            {
                rt.LastCode = code; // keep code fresh while the state holds
            }
        }

        // ── Sync: boot + every 60 s, asserting the committed state ────────────
        if (rt.CommittedState != null && nowUtc - rt.LastSyncUtc >= SyncInterval)
        {
            rt.LastSyncUtc = nowUtc;
            await _storage.EnqueueMessageAsync(
                channel.Id, "sync", nowUtc, rt.CommittedState, rt.LastCode, good, reject);
        }
    }

    private static bool TryReadSignal(Dictionary<string, DataPoint> byId, string dataPointId, out double value)
    {
        value = 0;
        if (!byId.TryGetValue(dataPointId, out var dp)) return false;
        if (dp.LastError != null) return false;
        return TryParseSignal(dp.LastValue, out value);
    }

    /// <summary>
    /// Pollers format LastValue as "True"/"False" for booleans, "123" for integers,
    /// "85.30" for floats (see SimulatorDriverPoller.cs:100-114 — all pollers share the pattern).
    /// </summary>
    public static bool TryParseSignal(string? lastValue, out double value)
    {
        value = 0;
        if (string.IsNullOrEmpty(lastValue)) return false;
        if (lastValue.Equals("True", StringComparison.OrdinalIgnoreCase)) { value = 1; return true; }
        if (lastValue.Equals("False", StringComparison.OrdinalIgnoreCase)) { value = 0; return true; }
        return double.TryParse(lastValue, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}
