using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using S7.Net;

namespace Pulse.Edge.Protocols.S7Net;

public class S7NetDriver : IDisposable
{
    private readonly ILogger<S7NetDriver> _logger;
    private Plc? _plc;
    private string _host = string.Empty;
    private CpuType _cpuType = CpuType.S71200;
    private short _rack = 0;
    private short _slot = 1;
    private int _timeoutMs = 5000;
    private bool _isConnected = false;
    private readonly object _lock = new();

    public bool IsConnected => _isConnected && _plc != null && _plc.IsConnected;

    public S7NetDriver(ILogger<S7NetDriver> logger)
    {
        _logger = logger;
    }

    public void Connect(string host, string cpuTypeStr, short rack, short slot, int timeoutMs = 5000)
    {
        lock (_lock)
        {
            var parsedCpuType = ParseCpuType(cpuTypeStr);
            if (_isConnected && _plc != null &&
                _host == host &&
                _cpuType == parsedCpuType &&
                _rack == rack &&
                _slot == slot &&
                _timeoutMs == timeoutMs)
            {
                return; // Already configured with identical parameters
            }

            Disconnect();

            _host = host;
            _cpuType = parsedCpuType;
            _rack = rack;
            _slot = slot;
            _timeoutMs = timeoutMs;

            _logger.LogInformation("S7Net Driver: Initializing connection. Host: {Host}, CpuType: {CpuType}, Rack: {Rack}, Slot: {Slot}, Timeout: {Timeout}ms", 
                host, _cpuType, rack, slot, timeoutMs);

            _plc = new Plc(_cpuType, _host, _rack, _slot);
            _plc.ReadTimeout = _timeoutMs;
            _plc.WriteTimeout = _timeoutMs;
            
            _plc.Open();
            _isConnected = _plc.IsConnected;
        }
    }

    public async Task ConnectAsync(string host, string cpuTypeStr, short rack, short slot, int timeoutMs = 5000, CancellationToken cancellationToken = default)
    {
        var parsedCpuType = ParseCpuType(cpuTypeStr);
        Plc? plcToOpen = null;

        lock (_lock)
        {
            if (_isConnected && _plc != null &&
                _host == host &&
                _cpuType == parsedCpuType &&
                _rack == rack &&
                _slot == slot &&
                _timeoutMs == timeoutMs)
            {
                return;
            }

            Disconnect();

            _host = host;
            _cpuType = parsedCpuType;
            _rack = rack;
            _slot = slot;
            _timeoutMs = timeoutMs;

            _logger.LogInformation("S7Net Driver: Initializing connection asynchronously. Host: {Host}, CpuType: {CpuType}, Rack: {Rack}, Slot: {Slot}, Timeout: {Timeout}ms", 
                host, _cpuType, rack, slot, timeoutMs);

            _plc = new Plc(_cpuType, _host, _rack, _slot);
            _plc.ReadTimeout = _timeoutMs;
            _plc.WriteTimeout = _timeoutMs;
            plcToOpen = _plc;
        }

        await plcToOpen.OpenAsync(cancellationToken);
        
        lock (_lock)
        {
            _isConnected = plcToOpen.IsConnected;
        }
    }

    public void Disconnect()
    {
        lock (_lock)
        {
            if (_plc != null)
            {
                _logger.LogInformation("S7Net Driver: Closing connection...");
                try
                {
                    _plc.Close();
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "S7Net Driver: Error closing PLC connection");
                }
                _plc = null;
            }
            _isConnected = false;
        }
    }

    public async Task<double> ReadTagAsync(string address, string dataType, CancellationToken cancellationToken = default)
    {
        Plc? plc;
        lock (_lock)
        {
            plc = _plc;
        }

        if (plc == null || !plc.IsConnected)
        {
            throw new InvalidOperationException("S7Net Driver is not connected.");
        }

        object? rawVal = await plc.ReadAsync(address, cancellationToken);
        if (rawVal == null)
        {
            throw new InvalidOperationException($"Failed to read value from address '{address}'.");
        }

        return ConvertToDouble(rawVal);
    }

    private double ConvertToDouble(object val)
    {
        if (val is bool b)
            return b ? 1.0 : 0.0;
        if (val is string s)
        {
            if (double.TryParse(s, out var d))
                return d;
            return 0.0;
        }
        return Convert.ToDouble(val);
    }

    private CpuType ParseCpuType(string typeStr)
    {
        if (string.IsNullOrEmpty(typeStr)) return CpuType.S71200;
        
        typeStr = typeStr.Replace("-", "").Replace(" ", "").ToLowerInvariant();
        if (typeStr.Contains("s7200")) return CpuType.S7200;
        if (typeStr.Contains("s7300")) return CpuType.S7300;
        if (typeStr.Contains("s7400")) return CpuType.S7400;
        if (typeStr.Contains("s71200")) return CpuType.S71200;
        if (typeStr.Contains("s71500")) return CpuType.S71500;

        if (Enum.TryParse<CpuType>(typeStr, true, out var cpuType))
            return cpuType;
        
        return CpuType.S71200;
    }

    public class DiscoveredTag
    {
        public string Name { get; set; } = string.Empty;
        public string DataType { get; set; } = string.Empty;
        public string TypeHex { get; set; } = string.Empty;
        public uint[] Dimensions { get; set; } = Array.Empty<uint>();
    }

    public async Task<List<DiscoveredTag>> BrowseTagsAsync(CancellationToken cancellationToken = default)
    {
        Plc? plc;
        lock (_lock)
        {
            plc = _plc;
        }

        if (plc == null || !plc.IsConnected)
        {
            throw new InvalidOperationException("S7Net Driver is not connected.");
        }

        var mockTags = new List<DiscoveredTag>
        {
            new() { Name = "DB1.DBX0.0", DataType = "BOOL", TypeHex = "0x01" },
            new() { Name = "DB1.DBX0.1", DataType = "BOOL", TypeHex = "0x01" },
            new() { Name = "DB1.DBW2", DataType = "INT16", TypeHex = "0x02" },
            new() { Name = "DB1.DBD4", DataType = "INT32", TypeHex = "0x04" },
            new() { Name = "DB1.DBD8", DataType = "REAL", TypeHex = "0x08" },
            new() { Name = "DB2.DBX0.0", DataType = "BOOL", TypeHex = "0x01" },
            new() { Name = "DB2.DBW2", DataType = "INT16", TypeHex = "0x02" },
            new() { Name = "DB2.DBD4", DataType = "REAL", TypeHex = "0x08" },
            new() { Name = "DB10.DBW0", DataType = "INT16", TypeHex = "0x02" },
            new() { Name = "DB10.DBD2", DataType = "INT32", TypeHex = "0x04" }
        };

        return await Task.FromResult(mockTags);
    }

    public void Dispose()
    {
        Disconnect();
    }
}
