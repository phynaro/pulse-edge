using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Pulse.Edge.Protocols.Modbus;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Storage.Services;

namespace Pulse.Edge.Agent.Drivers;

public class ModbusDriverPoller : IProtocolDriver
{
    private readonly ILogger<ModbusDriverPoller> _logger;
    private readonly ModbusDriver _modbusDriver;
    private readonly QueueStorageService _storageService;
    private readonly ConcurrentDictionary<string, DateTime> _lastDbWriteTimes = new();

    public string ProtocolName => "MODBUS_TCP"; // This matches either MODBUS_TCP or MODBUS_RTU since both are handled by the same ModbusDriver
    public bool IsConnected => _modbusDriver.IsConnected;

    public ModbusDriverPoller(
        ILogger<ModbusDriverPoller> logger,
        ModbusDriver modbusDriver,
        QueueStorageService storageService)
    {
        _logger = logger;
        _modbusDriver = modbusDriver;
        _storageService = storageService;
    }

    public async Task ConnectAsync(DriverAdapter adapter, CancellationToken ct)
    {
        if (adapter.Protocol == "MODBUS_RTU")
        {
            var portName = adapter.Host;
            var baudRate = adapter.Port;
            
            var parity = System.IO.Ports.Parity.None;
            var dataBits = 8;
            var stopBits = System.IO.Ports.StopBits.One;
            var handshake = System.IO.Ports.Handshake.None;

            try
            {
                if (!string.IsNullOrEmpty(adapter.ConfigJson))
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("Parity", out var parityProp))
                    {
                        Enum.TryParse(parityProp.GetString(), true, out parity);
                    }
                    if (root.TryGetProperty("DataBits", out var dbProp))
                    {
                        dataBits = dbProp.GetInt32();
                    }
                    if (root.TryGetProperty("StopBits", out var sbProp))
                    {
                        Enum.TryParse(sbProp.GetString(), true, out stopBits);
                    }
                    if (root.TryGetProperty("Handshake", out var hsProp))
                    {
                        Enum.TryParse(hsProp.GetString(), true, out handshake);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse Modbus RTU serial configurations from ConfigJson. Using defaults.");
            }

            _modbusDriver.ConnectRtu(portName, baudRate, parity, dataBits, stopBits, handshake);
        }
        else
        {
            await _modbusDriver.ConnectAsync(adapter.Host, adapter.Port, ct);
        }
    }

    public Task DisconnectAsync(CancellationToken ct)
    {
        _modbusDriver.Dispose(); // ModbusDriver implements IDisposable
        return Task.CompletedTask;
    }

    public async Task PollGroupAsync(
        List<DataPoint> group, 
        DriverAdapter adapter, 
        DateTime now, 
        List<DataPoint> dirtyDps, 
        CancellationToken ct)
    {
        if (!_modbusDriver.IsConnected)
        {
            return;
        }

        byte unitId = GetModbusUnitId(adapter);
        await PollModbusGroupAsync(group, unitId, now, dirtyDps, ct);
    }

    private record ModbusTagMeta(
        DataPoint Dp,
        ModbusDriver.RegisterType RegType,
        int Offset,
        int WordCount);

    private async Task PollModbusGroupAsync(
        IEnumerable<DataPoint> allTags,
        byte unitId,
        DateTime now,
        List<DataPoint> dirtyDps,
        CancellationToken ct)
    {
        // Step 1 — filter due tags and parse addresses
        var dueMetas = new List<ModbusTagMeta>();
        var readingsByDataSource = new Dictionary<string, Dictionary<string, (double? Value, string Quality)>>();

        void AddReading(DataPoint dp, double? value, string quality)
        {
            if (!string.IsNullOrEmpty(dp.DataSourceId) && !string.IsNullOrEmpty(dp.Metric))
            {
                if (!readingsByDataSource.TryGetValue(dp.DataSourceId, out var dict))
                {
                    dict = new Dictionary<string, (double? Value, string Quality)>();
                    readingsByDataSource[dp.DataSourceId] = dict;
                }
                dict[dp.Metric] = (value, quality);
            }
        }

        foreach (var dp in allTags)
        {
            var parseTimer = Stopwatch.StartNew();
            int baseInterval = Math.Max(dp.ScanIntervalMs > 0 ? dp.ScanIntervalMs : 1000, 100);
            int effectiveInterval = baseInterval;
            if (dp.ConsecutiveFailures > 0)
            {
                // Tier 2 Exponential Backoff
                int multiplier = (int)Math.Pow(2, Math.Min(dp.ConsecutiveFailures, 6));
                effectiveInterval = baseInterval * multiplier;
            }

            if (dp.LastUpdated != null && (now - dp.LastUpdated.Value).TotalMilliseconds < effectiveInterval)
                continue;

            try
            {
                var (regType, offset) = _modbusDriver.ParseAddress(dp.Address);
                // Only HR and IR support block reads; Coil/DI fall back to single reads
                if (regType == ModbusDriver.RegisterType.Coil || regType == ModbusDriver.RegisterType.DiscreteInput)
                {
                    var (val, qual) = await PollSingleModbusTagAsync(dp, unitId, now, dirtyDps, ct);
                    AddReading(dp, val, qual);
                    continue;
                }
                int words = _modbusDriver.GetWordCount(dp.DataType);
                dueMetas.Add(new ModbusTagMeta(dp, regType, offset, words));
            }
            catch (Exception ex)
            {
                parseTimer.Stop();
                dp.LastLatencyMs = Math.Round(parseTimer.Elapsed.TotalMilliseconds, 1);
                _logger.LogWarning("[Modbus Block] Could not parse address '{Addr}': {Msg}", dp.Address, ex.Message);
                dp.LastError = $"Address parse error: {ex.Message}";
                dp.ConsecutiveFailures++;
                dp.LastUpdated = now;
                AddDirtyIfNeeded(dp, now, dirtyDps);
                AddReading(dp, null, "DriverError");
            }
        }

        if (dueMetas.Count > 0)
        {
            // Step 2 — group by (ScanIntervalMs, RegisterType) then sort by offset
            var rateRegGroups = dueMetas
                .GroupBy(m => (m.Dp.ScanIntervalMs, m.RegType))
                .ToList();

            foreach (var rateGroup in rateRegGroups)
            {
                var sorted = rateGroup.OrderBy(m => m.Offset).ToList();

                // Step 3 — split into perfectly contiguous blocks (gap = 0)
                var blocks = new List<List<ModbusTagMeta>>();
                foreach (var meta in sorted)
                {
                    var lastBlock = blocks.LastOrDefault();
                    var lastMeta  = lastBlock?.LastOrDefault();

                    if (lastMeta == null || meta.Offset != lastMeta.Offset + lastMeta.WordCount)
                    {
                        // Gap detected (or first tag) — start a new block
                        blocks.Add(new List<ModbusTagMeta> { meta });
                    }
                    else
                    {
                        // Perfectly adjacent — extend current block
                        lastBlock!.Add(meta);
                    }
                }

                // Step 4 — execute one read per block
                foreach (var block in blocks)
                {
                    int blockStart = block.First().Offset;
                    int blockWords = block.Last().Offset + block.Last().WordCount - blockStart;
                    var regType   = block.First().RegType;
                    string regLabel = regType == ModbusDriver.RegisterType.HoldingRegister ? "HR" : "IR";

                    _logger.LogDebug(
                        "[Modbus Block] {Reg} @{Start}..{End} ({Words} words, {Count} tag(s) merged)",
                        regLabel, blockStart, blockStart + blockWords - 1, blockWords, block.Count);

                    ushort[] buffer;
                    var blockReadTimer = Stopwatch.StartNew();
                    try
                    {
                        buffer = regType == ModbusDriver.RegisterType.HoldingRegister
                            ? await _modbusDriver.ReadBlockHoldingAsync(blockStart, blockWords, unitId, ct)
                            : await _modbusDriver.ReadBlockInputAsync(blockStart, blockWords, unitId, ct);
                        blockReadTimer.Stop();
                    }
                    catch (Exception ex)
                    {
                        blockReadTimer.Stop();
                        // Block read failed — degrade to individual reads with retries!
                        _logger.LogWarning(ex,
                            "[Modbus Block] {Reg} block read failed @{Start} ({Words} words). Degrading to individual tag reads...",
                            regLabel, blockStart, blockWords);

                        foreach (var meta in block)
                        {
                            var dp = meta.Dp;
                            var degradedReadTimer = Stopwatch.StartNew();
                            int maxRetries = 3;
                            double rawVal = 0;
                            bool readSuccess = false;
                            string lastOpError = "";

                            for (int attempt = 1; attempt <= maxRetries; attempt++)
                            {
                                try
                                {
                                    rawVal = await _modbusDriver.ReadRegisterAsync(dp.Address, dp.DataType, unitId, dp.ByteOrder, ct);
                                    readSuccess = true;
                                    break;
                                }
                                catch (Exception ex2)
                                {
                                    lastOpError = ex2.Message;
                                    if (attempt < maxRetries)
                                        await Task.Delay(150, ct);
                                }
                            }

                            double? processedVal = null;
                            string quality = "Good";
                            degradedReadTimer.Stop();
                            dp.LastLatencyMs = Math.Round(degradedReadTimer.Elapsed.TotalMilliseconds, 1);

                            if (readSuccess)
                            {
                                try
                                {
                                    double val = (rawVal * dp.ScaleFactor) + dp.Offset;
                                    _logger.LogInformation(
                                        "[Modbus Degraded Success] Tag {Addr} read successfully after degradation. Raw: {Raw} Processed: {Proc}",
                                        dp.Address, rawVal, val);
                                    dp.LastValue = val.ToString("F2");
                                    dp.LastError = null;
                                    dp.ConsecutiveFailures = 0;
                                    dp.LastUpdated = now;
                                    processedVal = val;
                                }
                                catch (Exception ex3)
                                {
                                    _logger.LogError(ex3, "[Modbus Degraded] Error processing telemetry for tag {Addr}", dp.Address);
                                    dp.LastError = ex3.Message;
                                    quality = "DriverError";
                                }
                            }
                            else
                            {
                                _logger.LogError(
                                    "[Modbus Degraded Failure] Tag {Addr} failed all {Retries} individual read retries. Last error: {Error}",
                                    dp.Address, maxRetries, lastOpError);
                                dp.LastError = lastOpError;
                                dp.ConsecutiveFailures++;
                                dp.LastUpdated = now;
                                quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
                            }

                            AddReading(dp, processedVal, quality);
                            AddDirtyIfNeeded(dp, now, dirtyDps);
                        }
                        continue;
                    }

                    // Step 5 — slice buffer and convert each tag
                    var blockReadLatencyMs = Math.Round(blockReadTimer.Elapsed.TotalMilliseconds, 1);
                    foreach (var meta in block)
                    {
                        meta.Dp.LastLatencyMs = blockReadLatencyMs;
                        double? processedVal = null;
                        string quality = "Good";

                        try
                        {
                            int sliceStart = meta.Offset - blockStart;
                            var slice = buffer.Skip(sliceStart).Take(meta.WordCount).ToArray();

                            double rawVal      = _modbusDriver.ConvertToDouble(slice, meta.Dp.DataType, meta.Dp.ByteOrder);
                            double val = (rawVal * meta.Dp.ScaleFactor) + meta.Dp.Offset;

                            _logger.LogDebug(
                                "[Modbus Block]   └─ {Addr} ({Type}) slice[{S}..{E}] Raw:{Raw} → Processed:{Proc}",
                                meta.Dp.Address, meta.Dp.DataType,
                                sliceStart, sliceStart + meta.WordCount - 1,
                                rawVal, val);

                            meta.Dp.LastValue  = val.ToString("F2");
                            meta.Dp.LastError  = null;
                            meta.Dp.ConsecutiveFailures = 0;
                            meta.Dp.LastUpdated = now;
                            processedVal = val;
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "[Modbus Block] Conversion error for tag {Addr}", meta.Dp.Address);
                            meta.Dp.LastError  = ex.Message;
                            meta.Dp.ConsecutiveFailures++;
                            meta.Dp.LastUpdated = now;
                            quality = "DriverError";
                        }

                        AddReading(meta.Dp, processedVal, quality);
                        AddDirtyIfNeeded(meta.Dp, now, dirtyDps);
                    }
                }
            }
        }

        // Enqueue readings in batch per DataSourceId
        foreach (var kvp in readingsByDataSource)
        {
            var dataSourceId = kvp.Key;
            var metrics = kvp.Value;

            if (await _storageService.IsDataSourceEnabledAsync(dataSourceId))
            {
                await _storageService.EnqueueTelemetryBatchAsync(dataSourceId, now, metrics);
                foreach (var metricKvp in metrics)
                {
                    _logger.LogDebug("[Queue Buffer] Enqueued Modbus telemetry | Stream: {Source} Metric: {Metric}", dataSourceId, metricKvp.Key);
                }
            }
        }
    }

    private async Task<(double? Value, string Quality)> PollSingleModbusTagAsync(
        DataPoint dp, byte unitId, DateTime now,
        List<DataPoint> dirtyDps,
        CancellationToken ct)
    {
        var readTimer = Stopwatch.StartNew();
        int maxRetries = 3;
        double rawVal = 0;
        bool readSuccess = false;
        string lastOpError = "";

        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                rawVal = await _modbusDriver.ReadRegisterAsync(dp.Address, dp.DataType, unitId, dp.ByteOrder, ct);
                readSuccess = true;
                break;
            }
            catch (Exception ex)
            {
                lastOpError = ex.Message;
                if (attempt < maxRetries)
                    await Task.Delay(150, ct);
            }
        }

        double? processedVal = null;
        string quality = "Good";
        readTimer.Stop();
        dp.LastLatencyMs = Math.Round(readTimer.Elapsed.TotalMilliseconds, 1);

        if (readSuccess)
        {
            try
            {
                double val = (rawVal * dp.ScaleFactor) + dp.Offset;
                _logger.LogDebug("[Modbus] {Addr} Raw:{Raw} → Processed:{Proc}", dp.Address, rawVal, val);
                dp.LastValue = val.ToString("F2");
                dp.LastError = null;
                dp.ConsecutiveFailures = 0;
                dp.LastUpdated = now;
                processedVal = val;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Modbus] Error processing telemetry for {Addr}", dp.Address);
                dp.LastError = ex.Message;
                quality = "DriverError";
            }
        }
        else
        {
            _logger.LogError("[Modbus] Single read failed for {Addr} after {Retries} retries. Last error: {Error}", dp.Address, maxRetries, lastOpError);
            dp.LastError = lastOpError;
            dp.ConsecutiveFailures++;
            dp.LastUpdated = now;
            quality = dp.ConsecutiveFailures >= 3 ? "CommunicationLost" : "DeviceTimeout";
        }
        AddDirtyIfNeeded(dp, now, dirtyDps);
        return (processedVal, quality);
    }

    private void AddDirtyIfNeeded(DataPoint dp, DateTime now, List<DataPoint> dirtyDps)
    {
        bool shouldWrite = !_lastDbWriteTimes.TryGetValue(dp.Id, out var lastWrite)
                          || (now - lastWrite).TotalSeconds >= 1;
        if (shouldWrite)
        {
            _lastDbWriteTimes[dp.Id] = now;
            lock (dirtyDps)
            {
                dirtyDps.Add(dp);
            }
        }
    }

    private static byte GetModbusUnitId(DriverAdapter adapter)
    {
        try
        {
            if (!string.IsNullOrEmpty(adapter.ConfigJson))
            {
                using var doc = System.Text.Json.JsonDocument.Parse(adapter.ConfigJson);
                if (doc.RootElement.TryGetProperty("UnitId", out var prop))
                    return prop.GetByte();
            }
        }
        catch {}
        return 1;
    }
}
