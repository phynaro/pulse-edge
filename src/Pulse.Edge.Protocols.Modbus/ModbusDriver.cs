using System;
using System.IO.Ports;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using FluentModbus;
using Microsoft.Extensions.Logging;

namespace Pulse.Edge.Protocols.Modbus;

public class ModbusDriver : IDisposable
{
    private readonly ILogger<ModbusDriver> _logger;
    private ModbusClient? _client;
    
    // TCP specific configuration cache
    private string _activeHost = string.Empty;
    private int _activePort = 0;

    // RTU specific configuration cache
    private string _activePortName = string.Empty;
    private int _activeBaudRate = 0;
    private Parity _activeParity = Parity.None;
    private int _activeDataBits = 8;
    private StopBits _activeStopBits = StopBits.One;
    private Handshake _activeHandshake = Handshake.None;

    public bool IsConnected => _client != null && _client.IsConnected;

    public ModbusDriver(ILogger<ModbusDriver> logger)
    {
        _logger = logger;
    }

    public void Connect(string host, int port)
    {
        ConnectAsync(host, port).GetAwaiter().GetResult();
    }

    public async Task ConnectAsync(string host, int port, CancellationToken cancellationToken = default)
    {
        // Strip out port if included in host string (e.g. "192.168.1.51:502")
        if (!string.IsNullOrEmpty(host) && host.Contains(':'))
        {
            var parts = host.Split(':');
            host = parts[0];
            if (parts.Length > 1 && int.TryParse(parts[1], out var parsedPort))
            {
                port = parsedPort;
            }
        }

        if (_client is ModbusTcpClient && _client.IsConnected && _activeHost == host && _activePort == port)
        {
            return; // Already connected to this endpoint
        }

        Disconnect();

        _logger.LogInformation("Modbus TCP Driver: Initializing connection to Modbus Server at {Host}:{Port}...", host, port);
        
        // Parse host to IP Address
        if (!IPAddress.TryParse(host, out var ipAddress))
        {
            // If hostname, resolve to IP
            try
            {
                var addresses = await Dns.GetHostAddressesAsync(host, cancellationToken);
                if (addresses.Length > 0)
                {
                    // Prefer IPv4 for Modbus/industrial compatibility
                    ipAddress = addresses.FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork) 
                                ?? addresses[0];
                }
                else
                {
                    throw new Exception($"Could not resolve host IP: {host}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to resolve IP for host: {Host}", host);
                throw;
            }
        }

        var tcpClient = new ModbusTcpClient();
        await Task.Run(() => tcpClient.Connect(new IPEndPoint(ipAddress, port)), cancellationToken);
        _client = tcpClient;
        _activeHost = host;
        _activePort = port;
        _logger.LogInformation("Modbus TCP Driver: Connected successfully to {Host}:{Port}.", host, port);
    }

    public void ConnectRtu(string portName, int baudRate, Parity parity = Parity.None, int dataBits = 8, StopBits stopBits = StopBits.One, Handshake handshake = Handshake.None)
    {
        if (_client is ModbusRtuClient && _client.IsConnected && 
            _activePortName == portName && 
            _activeBaudRate == baudRate && 
            _activeParity == parity && 
            _activeDataBits == dataBits && 
            _activeStopBits == stopBits && 
            _activeHandshake == handshake)
        {
            return; // Already configured and connected
        }

        Disconnect();

        _logger.LogInformation("Modbus RTU Driver: Initializing serial port {PortName} at {BaudRate} baud...", portName, baudRate);
        
        var rtuClient = new ModbusRtuClient();
        rtuClient.BaudRate = baudRate;
        rtuClient.Parity = parity;
        rtuClient.StopBits = stopBits;
        rtuClient.Handshake = handshake;
        
        rtuClient.Connect(portName);
        _client = rtuClient;
        
        _activePortName = portName;
        _activeBaudRate = baudRate;
        _activeParity = parity;
        _activeDataBits = dataBits;
        _activeStopBits = stopBits;
        _activeHandshake = handshake;
        
        _logger.LogInformation("Modbus RTU Driver: Connected successfully to serial port {PortName}.", portName);
    }

    public void Disconnect()
    {
        if (_client != null)
        {
            _logger.LogInformation("Modbus Driver: Disconnecting...");
            try
            {
                if (_client.IsConnected)
                {
                    if (_client is ModbusTcpClient tcp)
                    {
                        tcp.Disconnect();
                    }
                    else if (_client is ModbusRtuClient rtu)
                    {
                        rtu.Close();
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Exception thrown while disconnecting Modbus client");
            }
            if (_client is IDisposable disp)
            {
                disp.Dispose();
            }
            _client = null;
            _activeHost = string.Empty;
            _activePort = 0;
            _activePortName = string.Empty;
            _activeBaudRate = 0;
        }
    }

    public double ReadRegister(string address, string dataType, byte unitId = 1, string byteOrder = "ABCD")
    {
        return ReadRegisterAsync(address, dataType, unitId, byteOrder).GetAwaiter().GetResult();
    }

    public async Task<double> ReadRegisterAsync(string address, string dataType, byte unitId = 1, string byteOrder = "ABCD", CancellationToken cancellationToken = default)
    {
        if (_client == null || !_client.IsConnected)
        {
            throw new InvalidOperationException("Modbus client is not connected.");
        }

        var (registerType, offset) = ParseAddress(address);

        switch (registerType)
        {
            case RegisterType.HoldingRegister:
                return await ReadHoldingAsync(offset, dataType, unitId, byteOrder, cancellationToken);
            case RegisterType.InputRegister:
                return await ReadInputAsync(offset, dataType, unitId, byteOrder, cancellationToken);
            case RegisterType.Coil:
                return await ReadCoilAsync(offset, unitId, cancellationToken);
            case RegisterType.DiscreteInput:
                return await ReadDiscreteAsync(offset, unitId, cancellationToken);
            default:
                throw new NotSupportedException($"Register type {registerType} is not supported.");
        }
    }

    private double ReadHolding(int offset, string dataType, byte unitId, string byteOrder)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        int numRegisters = GetNumRegisters(dataType);
        var span = _client.ReadHoldingRegisters<ushort>(unitId, offset, numRegisters);
        var registers = span.ToArray();
        var result = ConvertRegistersToDouble(registers, dataType, byteOrder);
        LogRegisterDebug("HR", offset, registers, dataType, byteOrder, result);
        return result;
    }

    private async Task<double> ReadHoldingAsync(int offset, string dataType, byte unitId, string byteOrder, CancellationToken cancellationToken)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        int numRegisters = GetNumRegisters(dataType);
        var memory = await _client.ReadHoldingRegistersAsync<ushort>(unitId, offset, numRegisters, cancellationToken);
        var registers = memory.ToArray();
        var result = ConvertRegistersToDouble(registers, dataType, byteOrder);
        LogRegisterDebug("HR", offset, registers, dataType, byteOrder, result);
        return result;
    }

    private double ReadInput(int offset, string dataType, byte unitId, string byteOrder)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        int numRegisters = GetNumRegisters(dataType);
        var span = _client.ReadInputRegisters<ushort>(unitId, offset, numRegisters);
        var registers = span.ToArray();
        var result = ConvertRegistersToDouble(registers, dataType, byteOrder);
        LogRegisterDebug("IR", offset, registers, dataType, byteOrder, result);
        return result;
    }

    private async Task<double> ReadInputAsync(int offset, string dataType, byte unitId, string byteOrder, CancellationToken cancellationToken)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        int numRegisters = GetNumRegisters(dataType);
        var memory = await _client.ReadInputRegistersAsync<ushort>(unitId, offset, numRegisters, cancellationToken);
        var registers = memory.ToArray();
        var result = ConvertRegistersToDouble(registers, dataType, byteOrder);
        LogRegisterDebug("IR", offset, registers, dataType, byteOrder, result);
        return result;
    }

    private double ReadCoil(int offset, byte unitId)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        var span = _client.ReadCoils(unitId, offset, 1);
        double result = span[0] != 0 ? 1.0 : 0.0;
        _logger.LogDebug("[Modbus] Coil @{Offset} | Raw: 0x{Raw:X2} | Processed: {Result}",
            offset, (byte)span[0], result);
        return result;
    }

    private async Task<double> ReadCoilAsync(int offset, byte unitId, CancellationToken cancellationToken)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        var memory = await _client.ReadCoilsAsync(unitId, offset, 1, cancellationToken);
        var span = memory.Span;
        double result = span[0] != 0 ? 1.0 : 0.0;
        _logger.LogDebug("[Modbus] Coil @{Offset} | Raw: 0x{Raw:X2} | Processed: {Result}",
            offset, (byte)span[0], result);
        return result;
    }

    private double ReadDiscrete(int offset, byte unitId)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        var span = _client.ReadDiscreteInputs(unitId, offset, 1);
        double result = span[0] != 0 ? 1.0 : 0.0;
        _logger.LogDebug("[Modbus] DI @{Offset} | Raw: 0x{Raw:X2} | Processed: {Result}",
            offset, (byte)span[0], result);
        return result;
    }

    private async Task<double> ReadDiscreteAsync(int offset, byte unitId, CancellationToken cancellationToken)
    {
        if (_client == null) throw new InvalidOperationException("Client is null");
        var memory = await _client.ReadDiscreteInputsAsync(unitId, offset, 1, cancellationToken);
        var span = memory.Span;
        double result = span[0] != 0 ? 1.0 : 0.0;
        _logger.LogDebug("[Modbus] DI @{Offset} | Raw: 0x{Raw:X2} | Processed: {Result}",
            offset, (byte)span[0], result);
        return result;
    }

    // ─── Block-Read API (used by the polling loop for contiguous tag groups) ─────

    /// <summary>
    /// Reads a contiguous block of holding registers in a single TCP round-trip.
    /// The caller slices the returned buffer per tag using <see cref="ConvertToDouble"/>.
    /// </summary>
    public ushort[] ReadBlockHolding(int startOffset, int wordCount, byte unitId = 1)
    {
        if (_client == null || !_client.IsConnected)
            throw new InvalidOperationException("Modbus client is not connected.");

        var span = _client.ReadHoldingRegisters<ushort>(unitId, startOffset, wordCount);
        var buf = span.ToArray();

        _logger.LogDebug("[Modbus Block] HR @{Start}..{End} ({Count} word(s)) → {Bytes} bytes read",
            startOffset, startOffset + wordCount - 1, wordCount, wordCount * 2);
        return buf;
    }

    public async Task<ushort[]> ReadBlockHoldingAsync(int startOffset, int wordCount, byte unitId = 1, CancellationToken cancellationToken = default)
    {
        if (_client == null || !_client.IsConnected)
            throw new InvalidOperationException("Modbus client is not connected.");

        var memory = await _client.ReadHoldingRegistersAsync<ushort>(unitId, startOffset, wordCount, cancellationToken);
        var buf = memory.ToArray();

        _logger.LogDebug("[Modbus Block] HR @{Start}..{End} ({Count} word(s)) → {Bytes} bytes read",
            startOffset, startOffset + wordCount - 1, wordCount, wordCount * 2);
        return buf;
    }

    /// <summary>
    /// Reads a contiguous block of input registers in a single TCP round-trip.
    /// </summary>
    public ushort[] ReadBlockInput(int startOffset, int wordCount, byte unitId = 1)
    {
        if (_client == null || !_client.IsConnected)
            throw new InvalidOperationException("Modbus client is not connected.");

        var span = _client.ReadInputRegisters<ushort>(unitId, startOffset, wordCount);
        var buf = span.ToArray();

        _logger.LogDebug("[Modbus Block] IR @{Start}..{End} ({Count} word(s)) → {Bytes} bytes read",
            startOffset, startOffset + wordCount - 1, wordCount, wordCount * 2);
        return buf;
    }

    public async Task<ushort[]> ReadBlockInputAsync(int startOffset, int wordCount, byte unitId = 1, CancellationToken cancellationToken = default)
    {
        if (_client == null || !_client.IsConnected)
            throw new InvalidOperationException("Modbus client is not connected.");

        var memory = await _client.ReadInputRegistersAsync<ushort>(unitId, startOffset, wordCount, cancellationToken);
        var buf = memory.ToArray();

        _logger.LogDebug("[Modbus Block] IR @{Start}..{End} ({Count} word(s)) → {Bytes} bytes read",
            startOffset, startOffset + wordCount - 1, wordCount, wordCount * 2);
        return buf;
    }

    /// <summary>
    /// Public wrapper — converts a pre-sliced register buffer to a double.
    /// Used by the block-read polling path after slicing the block buffer.
    /// </summary>
    public double ConvertToDouble(ushort[] registers, string dataType, string byteOrder)
        => ConvertRegistersToDouble(registers, dataType, byteOrder);

    /// <summary>
    /// Returns the number of 16-bit Modbus registers (words) required to hold the given data type.
    /// </summary>
    public int GetWordCount(string dataType) => GetNumRegisters(dataType);

    /// <summary>
    /// Logs a per-byte debug breakdown: register words as hex pairs, then final converted value.
    /// Format: [Modbus] HR @40001 | Type: Float (2 words) | ByteOrder: ABCD
    ///          Raw:       [Word0: 0x41 0xC8] [Word1: 0x00 0x00]
    ///          Processed: 25
    /// </summary>
    private void LogRegisterDebug(string regType, int offset, ushort[] registers, string dataType, string byteOrder, double result)
    {
        // Build per-word raw hex string showing each byte separately
        var wordParts = new System.Text.StringBuilder();
        for (int i = 0; i < registers.Length; i++)
        {
            // Each ushort in network order: high byte first, then low byte
            byte hi = (byte)(registers[i] >> 8);
            byte lo = (byte)(registers[i] & 0xFF);
            wordParts.Append($"[W{i}: 0x{hi:X2} 0x{lo:X2}] ");
        }

        // Also emit a flat hex dump of all bytes for easy comparison
        var allBytes = new System.Text.StringBuilder();
        foreach (var reg in registers)
        {
            allBytes.Append($"0x{(byte)(reg >> 8):X2} 0x{(byte)(reg & 0xFF):X2} ");
        }

        _logger.LogDebug(
            "[Modbus] {RegType} @{Offset} | Type: {DataType} ({NumWords} word(s)) | ByteOrder: {ByteOrder}\n" +
            "         Raw:       {Words}\n" +
            "         Bytes:     {Bytes}\n" +
            "         Processed: {Result}",
            regType, offset, dataType, registers.Length, byteOrder,
            wordParts.ToString().TrimEnd(),
            allBytes.ToString().TrimEnd(),
            result);
    }

    private int GetNumRegisters(string dataType)
    {
        switch (dataType.ToLowerInvariant())
        {
            case "int16":
            case "uint16":
            case "boolean":
                return 1;
            case "int32":
            case "uint32":
            case "float":
            case "single":
                return 2;
            case "double":
            case "int64":
            case "uint64":
                return 4;
            case "string":
                _logger.LogWarning("[Modbus] DataType 'String' is not supported on Modbus TCP — defaulting to 1 register (raw UInt16). Use Int16/UInt16 or a dedicated string register block.");
                return 1;
            default:
                _logger.LogWarning("[Modbus] Unknown DataType '{DataType}' — defaulting to 1 register.", dataType);
                return 1;
        }
    }

    private double ConvertRegistersToDouble(ushort[] registers, string dataType, string byteOrder)
    {
        if (registers == null || registers.Length == 0) return 0;

        byte[] bytes = new byte[registers.Length * 2];
        for (int i = 0; i < registers.Length; i++)
        {
            byte[] regBytes = BitConverter.GetBytes(registers[i]);
            // High byte, then low byte (Big-Endian network format: A, B, C, D...)
            bytes[i * 2] = regBytes[1];
            bytes[i * 2 + 1] = regBytes[0];
        }

        string order = (byteOrder ?? "").Trim().ToUpperInvariant();

        switch (dataType.ToLowerInvariant())
        {
            case "int16":
            {
                byte[] ordered = order == "BA" 
                    ? new byte[] { bytes[0], bytes[1] } // Swapped BA order: A, B -> B, A
                    : new byte[] { bytes[1], bytes[0] }; // Default AB order: A, B -> A, B
                return BitConverter.ToInt16(ordered, 0);
            }
            case "uint16":
            {
                byte[] ordered = order == "BA"
                    ? new byte[] { bytes[0], bytes[1] }
                    : new byte[] { bytes[1], bytes[0] };
                return BitConverter.ToUInt16(ordered, 0);
            }
            case "int32":
            case "uint32":
            case "float":
            case "single":
            {
                // bytes[0]=A, bytes[1]=B, bytes[2]=C, bytes[3]=D
                byte[] ordered;
                if (order == "CDAB") // Word Swap (C, D, A, B) -> BitConverter LE expects [B, A, D, C]
                {
                    ordered = new byte[] { bytes[1], bytes[0], bytes[3], bytes[2] };
                }
                else if (order == "BADC") // Byte Swap (B, A, D, C) -> BitConverter LE expects [C, D, A, B]
                {
                    ordered = new byte[] { bytes[2], bytes[3], bytes[0], bytes[1] };
                }
                else if (order == "DCBA") // Byte and Word Swap (D, C, B, A) -> BitConverter LE expects [A, B, C, D]
                {
                    ordered = new byte[] { bytes[0], bytes[1], bytes[2], bytes[3] };
                }
                else // Default ABCD -> BitConverter LE expects [D, C, B, A]
                {
                    ordered = new byte[] { bytes[3], bytes[2], bytes[1], bytes[0] };
                }

                if (dataType.Equals("int32", StringComparison.OrdinalIgnoreCase))
                    return BitConverter.ToInt32(ordered, 0);
                if (dataType.Equals("uint32", StringComparison.OrdinalIgnoreCase))
                    return BitConverter.ToUInt32(ordered, 0);
                return BitConverter.ToSingle(ordered, 0);
            }
            case "double":
            case "int64":
            case "uint64":
            {
                // bytes[0..7] (A, B, C, D, E, F, G, H)
                byte[] ordered;
                if (order == "DCBA") // Complete reverse swap
                {
                    ordered = new byte[] { bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7] };
                }
                else if (order == "CDAB") // Word-level swap
                {
                    ordered = new byte[] { bytes[1], bytes[0], bytes[3], bytes[2], bytes[5], bytes[4], bytes[7], bytes[6] };
                }
                else if (order == "BADC") // Byte swap within words
                {
                    ordered = new byte[] { bytes[6], bytes[7], bytes[4], bytes[5], bytes[2], bytes[3], bytes[0], bytes[1] };
                }
                else // Default ABCD
                {
                    ordered = new byte[] { bytes[7], bytes[6], bytes[5], bytes[4], bytes[3], bytes[2], bytes[1], bytes[0] };
                }

                if (dataType.Equals("int64", StringComparison.OrdinalIgnoreCase))
                    return BitConverter.ToInt64(ordered, 0);
                if (dataType.Equals("uint64", StringComparison.OrdinalIgnoreCase))
                    return BitConverter.ToUInt64(ordered, 0);
                return BitConverter.ToDouble(ordered, 0);
            }
            default:
                return registers[0];
        }
    }

    public enum RegisterType
    {
        Coil,
        DiscreteInput,
        HoldingRegister,
        InputRegister
    }

    public (RegisterType Type, int Offset) ParseAddress(string address)
    {
        if (string.IsNullOrWhiteSpace(address))
        {
            return (RegisterType.HoldingRegister, 0);
        }

        address = address.Trim();

        if (address.StartsWith("4") && address.Length >= 5 && int.TryParse(address, out int holdingVal))
        {
            int index = holdingVal - 40001;
            return (RegisterType.HoldingRegister, index >= 0 ? index : 0);
        }
        
        if (address.StartsWith("3") && address.Length >= 5 && int.TryParse(address, out int inputVal))
        {
            int index = inputVal - 30001;
            return (RegisterType.InputRegister, index >= 0 ? index : 0);
        }

        if (address.StartsWith("0") && address.Length >= 5 && int.TryParse(address, out int coilVal))
        {
            int index = coilVal - 1;
            return (RegisterType.Coil, index >= 0 ? index : 0);
        }

        if (address.StartsWith("1") && address.Length >= 5 && int.TryParse(address, out int discreteVal))
        {
            int index = discreteVal - 10001;
            return (RegisterType.DiscreteInput, index >= 0 ? index : 0);
        }

        if (int.TryParse(address, out int directOffset))
        {
            return (RegisterType.HoldingRegister, directOffset);
        }

        if (address.StartsWith("HR", StringComparison.OrdinalIgnoreCase) && int.TryParse(address[2..], out int hrOffset))
        {
            return (RegisterType.HoldingRegister, hrOffset);
        }
        if (address.StartsWith("IR", StringComparison.OrdinalIgnoreCase) && int.TryParse(address[2..], out int irOffset))
        {
            return (RegisterType.InputRegister, irOffset);
        }
        if (address.StartsWith("C", StringComparison.OrdinalIgnoreCase) && int.TryParse(address[1..], out int cOffset))
        {
            return (RegisterType.Coil, cOffset);
        }
        if (address.StartsWith("DI", StringComparison.OrdinalIgnoreCase) && int.TryParse(address[2..], out int diOffset))
        {
            return (RegisterType.DiscreteInput, diOffset);
        }

        return (RegisterType.HoldingRegister, 0);
    }

    public void Dispose()
    {
        Disconnect();
    }
}
