namespace Pulse.Edge.Tests;

/// <summary>
/// G2 gate check "production TLS verification cannot be bypassed": scans all production
/// source for certificate-validation bypass patterns. The single allowed site is the
/// diagnostic-forwarding client, and only because it delegates to the loopback-scoped
/// <c>LoopbackCertificateTrust</c> policy. Any new bypass anywhere fails this test.
/// </summary>
public sealed class TlsBypassGuardTests
{
    private static readonly string[] BypassMarkers =
    [
        "ServerCertificateCustomValidationCallback",
        "DangerousAcceptAnyServerCertificateValidator",
    ];

    [Fact]
    public void Certificate_validation_is_only_relaxed_via_the_loopback_policy()
    {
        var srcRoot = Path.Combine(FindRepoRoot(), "src");
        var offenders = new List<string>();
        foreach (var file in Directory.EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories))
        {
            var normalized = file.Replace('\\', '/');
            if (normalized.Contains("/obj/") || normalized.Contains("/bin/") ||
                normalized.Contains("/Pulse.Edge.Tests/")) continue;

            var text = File.ReadAllText(file);
            if (!BypassMarkers.Any(text.Contains)) continue;

            var isAllowedSite =
                normalized.EndsWith("/Pulse.Edge.Agent/Services/DiagnosticForwardingProvider.cs", StringComparison.Ordinal) &&
                text.Contains("LoopbackCertificateTrust.Validate");
            if (!isAllowedSite) offenders.Add(normalized);
        }

        Assert.True(offenders.Count == 0,
            "TLS certificate validation is bypassed outside the loopback policy in:\n" + string.Join("\n", offenders));
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Pulse.Edge.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException(
            "Repository root (Pulse.Edge.slnx) not found above " + AppContext.BaseDirectory);
    }
}
