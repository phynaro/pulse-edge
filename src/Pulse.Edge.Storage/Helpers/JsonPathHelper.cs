using System;
using System.Text.Json;

namespace Pulse.Edge.Storage.Helpers;

public static class JsonPathHelper
{
    public static string? GetJsonValueByElement(JsonElement element, string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return null;

        try
        {
            var cleanPath = path;
            if (cleanPath.StartsWith("$.")) cleanPath = cleanPath[2..];
            else if (cleanPath.StartsWith("$")) cleanPath = cleanPath[1..];
            
            var parts = cleanPath.Split('.', StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in parts)
            {
                var cleanPart = part;
                int arrayIndex = -1;
                
                if (part.EndsWith("]") && part.Contains("["))
                {
                    int openBracket = part.IndexOf("[");
                    cleanPart = part[..openBracket];
                    string indexStr = part[(openBracket + 1)..^1];
                    int.TryParse(indexStr, out arrayIndex);
                }

                if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(cleanPart, out var child))
                {
                    element = child;
                }
                else
                {
                    return null;
                }

                if (arrayIndex >= 0)
                {
                    if (element.ValueKind == JsonValueKind.Array && arrayIndex < element.GetArrayLength())
                    {
                        element = element[arrayIndex];
                    }
                    else
                    {
                        return null;
                    }
                }
            }
            
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                JsonValueKind.Null => null,
                _ => element.GetRawText()
            };
        }
        catch
        {
            return null;
        }
    }

    public static string? GetJsonValueByPath(string json, string path)
    {
        if (string.IsNullOrWhiteSpace(json) || string.IsNullOrWhiteSpace(path))
            return null;

        try
        {
            using var doc = JsonDocument.Parse(json);
            return GetJsonValueByElement(doc.RootElement, path);
        }
        catch
        {
            return null;
        }
    }
}
