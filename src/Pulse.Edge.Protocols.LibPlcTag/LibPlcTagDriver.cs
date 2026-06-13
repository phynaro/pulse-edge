using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using libplctag;
using libplctag.DataTypes;

namespace Pulse.Edge.Protocols.LibPlcTag;

public class LibPlcTagDriver : IDisposable
{
    private readonly ILogger<LibPlcTagDriver> _logger;
    private readonly Dictionary<string, IPlcTag> _tags = new();
    private readonly object _lock = new();
    
    private string _host = string.Empty;
    private PlcType _plcType = PlcType.ControlLogix;
    private Protocol _protocol = Protocol.ab_eip;
    private string _path = "1,0";
    private int _timeoutMs = 5000;
    private bool _isConnected = false;

    public bool IsConnected => _isConnected;

    public LibPlcTagDriver(ILogger<LibPlcTagDriver> logger)
    {
        _logger = logger;
    }

    public void Connect(string host, string plcTypeStr, string protocolStr, string path, int timeoutMs = 5000)
    {
        lock (_lock)
        {
            if (_isConnected && 
                _host == host && 
                _plcType.ToString().Equals(plcTypeStr, StringComparison.OrdinalIgnoreCase) && 
                _protocol.ToString().Equals(protocolStr, StringComparison.OrdinalIgnoreCase) && 
                _path == path && 
                _timeoutMs == timeoutMs)
            {
                return; // Already configured with identical parameters
            }

            Disconnect();

            _host = host;
            _plcType = ParsePlcType(plcTypeStr);
            _protocol = ParseProtocol(protocolStr);
            _path = path;
            _timeoutMs = timeoutMs;
            
            _logger.LogInformation("LibPlcTag Driver: Initializing connection parameters. Host: {Host}, PlcType: {PlcType}, Protocol: {Protocol}, Path: {Path}, Timeout: {Timeout}ms", host, _plcType, _protocol, path, timeoutMs);
            
            _isConnected = true;
        }
    }

    public void Disconnect()
    {
        lock (_lock)
        {
            if (_tags.Count > 0)
            {
                _logger.LogInformation("LibPlcTag Driver: Disconnecting and cleaning up cached tags...");
                foreach (var tag in _tags.Values)
                {
                    try
                    {
                        tag.Dispose();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "LibPlcTag Driver: Error disposing tag");
                    }
                }
                _tags.Clear();
            }
            _isConnected = false;
        }
    }

    public double ReadTag(string address, string dataType)
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("LibPlcTag Driver is not connected.");
        }

        IPlcTag tag;
        lock (_lock)
        {
            string cacheKey = $"{address}_{dataType}";
            if (!_tags.TryGetValue(cacheKey, out tag!))
            {
                tag = CreateTag(address, dataType);
                _tags[cacheKey] = tag;
            }
        }

        tag.Read();
        var rawVal = tag.GetValue();
        return ConvertToDouble(rawVal);
    }

    public async Task<double> ReadTagAsync(string address, string dataType, CancellationToken cancellationToken = default)
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("LibPlcTag Driver is not connected.");
        }

        IPlcTag tag;
        lock (_lock)
        {
            string cacheKey = $"{address}_{dataType}";
            if (!_tags.TryGetValue(cacheKey, out tag!))
            {
                tag = CreateTag(address, dataType);
                _tags[cacheKey] = tag;
            }
        }

        await tag.ReadAsync(cancellationToken);
        var rawVal = tag.GetValue();
        return ConvertToDouble(rawVal);
    }

    private IPlcTag CreateTag(string address, string dataType)
    {
        var timeout = TimeSpan.FromMilliseconds(_timeoutMs);
        
        switch (dataType.ToLowerInvariant())
        {
            case "bool":
            case "boolean":
                return new PlcTagWrapper<BoolPlcMapper, bool>(new Tag<BoolPlcMapper, bool>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "int16":
            case "short":
                return new PlcTagWrapper<IntPlcMapper, short>(new Tag<IntPlcMapper, short>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "uint16":
            case "ushort":
                return new PlcTagWrapper<UintPlcMapper, ushort>(new Tag<UintPlcMapper, ushort>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "int32":
            case "dint":
            case "int":
                return new PlcTagWrapper<DintPlcMapper, int>(new Tag<DintPlcMapper, int>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "uint32":
            case "udint":
            case "uint":
                return new PlcTagWrapper<UdintPlcMapper, uint>(new Tag<UdintPlcMapper, uint>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "int64":
            case "lint":
            case "long":
                return new PlcTagWrapper<LintPlcMapper, long>(new Tag<LintPlcMapper, long>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "uint64":
            case "ulint":
            case "ulong":
                return new PlcTagWrapper<UlintPlcMapper, ulong>(new Tag<UlintPlcMapper, ulong>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "float":
            case "single":
            case "real":
                return new PlcTagWrapper<RealPlcMapper, float>(new Tag<RealPlcMapper, float>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "double":
            case "lreal":
                return new PlcTagWrapper<LrealPlcMapper, double>(new Tag<LrealPlcMapper, double>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            case "string":
                return new PlcTagWrapper<StringPlcMapper, string>(new Tag<StringPlcMapper, string>
                {
                    Name = address,
                    Gateway = _host,
                    Path = _path,
                    PlcType = _plcType,
                    Protocol = _protocol,
                    Timeout = timeout
                });

            default:
                throw new NotSupportedException($"Data type '{dataType}' is not supported by the LibPlcTag Driver.");
        }
    }

    private PlcType ParsePlcType(string typeStr)
    {
        if (Enum.TryParse<PlcType>(typeStr, true, out var plcType))
            return plcType;
        return PlcType.ControlLogix;
    }

    private Protocol ParseProtocol(string protocolStr)
    {
        if (string.Equals(protocolStr, "Ethernet/IP", StringComparison.OrdinalIgnoreCase) || 
            string.Equals(protocolStr, "EthernetIP", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(protocolStr, "ab_eip", StringComparison.OrdinalIgnoreCase))
        {
            return Protocol.ab_eip;
        }
        if (Enum.TryParse<Protocol>(protocolStr, true, out var protocol))
            return protocol;
        return Protocol.ab_eip;
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

    public class DiscoveredTag
    {
        public string Name { get; set; } = string.Empty;
        public string DataType { get; set; } = string.Empty;
        public string TypeHex { get; set; } = string.Empty;
        public uint[] Dimensions { get; set; } = Array.Empty<uint>();
        public ushort TemplateId { get; set; }
    }

    public List<DiscoveredTag> BrowseTags()
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("LibPlcTag Driver is not connected.");
        }

        var timeout = TimeSpan.FromMilliseconds(_timeoutMs);
        using var tags = new Tag<TagInfoPlcMapper, TagInfo[]>
        {
            Name = "@tags",
            Gateway = _host,
            Path = _path,
            PlcType = _plcType,
            Protocol = _protocol,
            Timeout = timeout
        };

        tags.Read();

        var result = new List<DiscoveredTag>();
        if (tags.Value != null)
        {
            foreach (var tag in tags.Value)
            {
                result.Add(new DiscoveredTag
                {
                    Name = tag.Name,
                    DataType = MapCipTypeToDataType(tag.Type),
                    TypeHex = $"0x{tag.Type:X4}",
                    Dimensions = tag.Dimensions,
                    TemplateId = (ushort)(tag.Type & 0x0FFF)
                });
            }
        }
        return result;
    }

    public async Task<List<DiscoveredTag>> BrowseTagsAsync(CancellationToken cancellationToken = default)
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("LibPlcTag Driver is not connected.");
        }

        var timeout = TimeSpan.FromMilliseconds(_timeoutMs);
        using var tags = new Tag<TagInfoPlcMapper, TagInfo[]>
        {
            Name = "@tags",
            Gateway = _host,
            Path = _path,
            PlcType = _plcType,
            Protocol = _protocol,
            Timeout = timeout
        };

        await tags.ReadAsync(cancellationToken);

        var result = new List<DiscoveredTag>();
        if (tags.Value != null)
        {
            foreach (var tag in tags.Value)
            {
                if (tag.Name.StartsWith("__"))
                {
                    continue;
                }

                var dataType = MapCipTypeToDataType(tag.Type);
                if (tag.Name.StartsWith("Program:", StringComparison.OrdinalIgnoreCase))
                {
                    dataType = "Program";
                }
                else if (dataType.Equals("Unknown", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                result.Add(new DiscoveredTag
                {
                    Name = tag.Name,
                    DataType = dataType,
                    TypeHex = $"0x{tag.Type:X4}",
                    Dimensions = tag.Dimensions,
                    TemplateId = (ushort)(tag.Type & 0x0FFF)
                });
            }
        }
        return result;
    }

    public async Task<List<DiscoveredTag>> BrowseProgramTagsAsync(string programName, CancellationToken cancellationToken = default)
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("LibPlcTag Driver is not connected.");
        }

        var timeout = TimeSpan.FromMilliseconds(_timeoutMs);
        using var tags = new Tag<TagInfoPlcMapper, TagInfo[]>
        {
            Name = $"Program:{programName}.@tags",
            Gateway = _host,
            Path = _path,
            PlcType = _plcType,
            Protocol = _protocol,
            Timeout = timeout
        };

        await tags.ReadAsync(cancellationToken);

        var result = new List<DiscoveredTag>();
        if (tags.Value != null)
        {
            foreach (var tag in tags.Value)
            {
                if (tag.Name.StartsWith("__"))
                {
                    continue;
                }

                var dataType = MapCipTypeToDataType(tag.Type);
                if (dataType.Equals("Unknown", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                result.Add(new DiscoveredTag
                {
                    Name = tag.Name,
                    DataType = dataType,
                    TypeHex = $"0x{tag.Type:X4}",
                    Dimensions = tag.Dimensions,
                    TemplateId = (ushort)(tag.Type & 0x0FFF)
                });
            }
        }
        return result;
    }

    public async Task<List<StructureMember>> GetStructureTemplateAsync(ushort templateId, CancellationToken cancellationToken = default)
    {
        if (!_isConnected)
        {
            throw new InvalidOperationException("LibPlcTag Driver is not connected.");
        }

        _logger.LogInformation("GetStructureTemplateAsync: Fetching template metadata for templateId={TemplateId} on host={Host}", templateId, _host);

        try
        {
            var timeout = TimeSpan.FromMilliseconds(_timeoutMs);
            using var tag = new Tag
            {
                Name = $"@udt/{templateId}",
                Gateway = _host,
                Path = _path,
                PlcType = _plcType,
                Protocol = _protocol,
                Timeout = timeout,
                ElementSize = 1,
                ElementCount = 32768
            };

            await tag.ReadAsync(cancellationToken);

            int totalSize = tag.GetSize();
            var rawBytes = new byte[totalSize];
            for (int j = 0; j < totalSize; j++)
            {
                rawBytes[j] = tag.GetUInt8(j);
            }

            if (_logger.IsEnabled(LogLevel.Debug))
            {
                var byteList = new List<string>();
                for (int j = 0; j < totalSize; j++)
                {
                    byteList.Add($"{rawBytes[j]:X2}");
                }
                _logger.LogDebug("Raw template bytes (all {Size}): {Bytes}", totalSize, string.Join(" ", byteList));
            }

            var members = ParseTemplatePayload(rawBytes, templateId, _logger);

            _logger.LogInformation("GetStructureTemplateAsync finished: returned {Count} members for templateId={TemplateId}", members.Count, templateId);
            return members;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "GetStructureTemplateAsync failed for templateId {TemplateId}", templateId);
            throw;
        }
    }

    public static List<StructureMember> ParseTemplatePayload(byte[] rawBytes, ushort templateId, Microsoft.Extensions.Logging.ILogger logger)
    {
        int totalSize = rawBytes.Length;
        if (totalSize < 16)
        {
            throw new ArgumentException($"Raw template bytes size {totalSize} is too small for header.");
        }

        ushort memberCount = (ushort)BitConverter.ToInt16(rawBytes, 10);
        logger.LogDebug("ParseTemplatePayload: templateId={TemplateId}, totalSize={TotalSize}, memberCount={MemberCount}", templateId, totalSize, memberCount);

        var members = new List<StructureMember>();
        if (memberCount == 0)
        {
            return members;
        }

        int lastMemberHeaderOffset = 16 + (memberCount - 1) * 8;
        if (lastMemberHeaderOffset >= totalSize)
        {
            throw new ArgumentException($"Raw template bytes size {totalSize} is too small for {memberCount} member headers.");
        }

        // Find udtNameOffset
        int udtNameOffset = lastMemberHeaderOffset + 8; // Default if no truncation
        for (int o = lastMemberHeaderOffset + 4; o <= lastMemberHeaderOffset + 8; o++)
        {
            if (o < totalSize && IsValidUdtNameStartCharacter(rawBytes[o]) && IsValidStringsBlockStart(rawBytes, o, memberCount + 1))
            {
                udtNameOffset = o;
                break;
            }
        }

        logger.LogDebug("Found UDT name offset: {Offset}", udtNameOffset);

        // Parse all strings from strings block
        var strings = new List<string>();
        int cur = udtNameOffset;
        for (int k = 0; k < memberCount + 1; k++)
        {
            if (cur >= totalSize) break;
            int start = cur;
            while (cur < totalSize && rawBytes[cur] != 0)
            {
                cur++;
            }
            string s = System.Text.Encoding.ASCII.GetString(rawBytes, start, cur - start);
            strings.Add(s);
            cur++; // Skip null terminator
        }

        // Parse member headers
        for (int i = 0; i < memberCount; i++)
        {
            int headerOffset = 16 + i * 8;
            if (headerOffset >= udtNameOffset)
            {
                logger.LogWarning("ParseTemplatePayload header offset out of bounds: headerOffset={HeaderOffset} >= udtNameOffset={UdtNameOffset}", headerOffset, udtNameOffset);
                break;
            }

            ushort typeId = (ushort)BitConverter.ToInt16(rawBytes, headerOffset);
            ushort memberOffset = (ushort)BitConverter.ToInt16(rawBytes, headerOffset + 2);
            
            string memberName = (i + 1 < strings.Count) ? strings[i + 1] : $"?Member{i}";

            logger.LogDebug("Parsed member: Name={MemberName}, DataType={DataType}, TypeId=0x{TypeIdHex}, Offset={Offset}", memberName, MapCipTypeToDataType(typeId), $"{typeId:X4}", memberOffset);

            if (memberName.StartsWith("__")) continue;

            var dataType = MapCipTypeToDataType(typeId);
            if (dataType.Equals("Unknown", StringComparison.OrdinalIgnoreCase)) continue;

            members.Add(new StructureMember
            {
                Name = memberName,
                DataType = dataType,
                TypeId = typeId,
                Offset = memberOffset,
                IsStructure = (typeId & 0x8000) != 0,
                TemplateId = (ushort)(typeId & 0x0FFF)
            });
        }

        return members;
    }

    private static bool IsValidUdtNameStartCharacter(byte b)
    {
        char c = (char)b;
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
    }

    private static bool IsValidStringsBlockStart(byte[] bytes, int offset, int expectedCount)
    {
        int current = offset;
        int totalSize = bytes.Length;
        for (int i = 0; i < expectedCount; i++)
        {
            if (current >= totalSize) return false;
            int start = current;
            while (current < totalSize && bytes[current] != 0)
            {
                byte b = bytes[current];
                if (b < 32 || b > 126)
                {
                    return false;
                }
                current++;
            }
            if (current >= totalSize) return false;
            if (current == start) return false;
            current++;
        }
        return true;
    }

    public class StructureMember
    {
        public string Name { get; set; } = string.Empty;
        public string DataType { get; set; } = string.Empty;
        public ushort TypeId { get; set; }
        public uint Offset { get; set; }
        public bool IsStructure { get; set; }
        public ushort TemplateId { get; set; }
    }

    private static string MapCipTypeToDataType(ushort cipType)
    {
        ushort baseType = (ushort)(cipType & 0x0FFF);
        switch (baseType)
        {
            case 0xC1: return "BOOL";
            case 0xC2: return "SINT";
            case 0xC3: return "INT16";
            case 0xC4: return "INT32";
            case 0xC5: return "INT64";
            case 0xC6: return "USINT";
            case 0xC7: return "UINT16";
            case 0xC8: return "UINT32";
            case 0xC9: return "UINT64";
            case 0xCA: return "REAL";
            case 0xCB: return "LREAL";
            default:
                if ((cipType & 0x8000) != 0)
                {
                    return "Structure";
                }
                return "Unknown";
        }
    }

    public void Dispose()
    {
        Disconnect();
    }

    private interface IPlcTag : IDisposable
    {
        void Read();
        Task ReadAsync(CancellationToken cancellationToken = default);
        object GetValue();
    }

    public class UintPlcMapper : IPlcMapper<ushort>
    {
        public PlcType PlcType { get; set; }
        public int? ElementSize => 2;
        public int[] ArrayDimensions { get; set; } = Array.Empty<int>();
        public int? GetElementCount() => null;
        public ushort Decode(Tag tag) => (ushort)tag.GetInt16(0);
        public void Encode(Tag tag, ushort value) => tag.SetInt16(0, (short)value);
    }

    public class UdintPlcMapper : IPlcMapper<uint>
    {
        public PlcType PlcType { get; set; }
        public int? ElementSize => 4;
        public int[] ArrayDimensions { get; set; } = Array.Empty<int>();
        public int? GetElementCount() => null;
        public uint Decode(Tag tag) => (uint)tag.GetInt32(0);
        public void Encode(Tag tag, uint value) => tag.SetInt32(0, (int)value);
    }

    public class UlintPlcMapper : IPlcMapper<ulong>
    {
        public PlcType PlcType { get; set; }
        public int? ElementSize => 8;
        public int[] ArrayDimensions { get; set; } = Array.Empty<int>();
        public int? GetElementCount() => null;
        public ulong Decode(Tag tag) => (ulong)tag.GetInt64(0);
        public void Encode(Tag tag, ulong value) => tag.SetInt64(0, (long)value);
    }

    private class PlcTagWrapper<TMapper, TValue> : IPlcTag 
        where TMapper : IPlcMapper<TValue>, new()
    {
        private readonly Tag<TMapper, TValue> _tag;

        public PlcTagWrapper(Tag<TMapper, TValue> tag)
        {
            _tag = tag;
            _tag.Initialize();
        }

        public void Read()
        {
            _tag.Read();
        }

        public async Task ReadAsync(CancellationToken cancellationToken = default)
        {
            await _tag.ReadAsync(cancellationToken);
        }

        public object GetValue()
        {
            return _tag.Value!;
        }

        public void Dispose()
        {
            _tag.Dispose();
        }
    }
}
