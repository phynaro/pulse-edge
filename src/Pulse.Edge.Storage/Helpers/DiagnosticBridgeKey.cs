using System.Security.Cryptography;
using System.Text;

namespace Pulse.Edge.Storage.Helpers;

public static class DiagnosticBridgeKey
{
    public static string LoadOrCreate()
    {
        var folder = OperatingSystem.IsWindows()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PULSE Edge")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pulse");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "diagnostic-bridge.key");
        if (!File.Exists(path))
        {
            try
            {
                var value = Encoding.UTF8.GetBytes(Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant());
                using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
                stream.Write(value);
                if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
            catch (IOException) { /* another process created it */ }
        }
        return File.ReadAllText(path).Trim();
    }
}
