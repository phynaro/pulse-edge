using System.Linq;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Configuration;
using Pulse.Edge.Api.Security;

namespace Pulse.Edge.Tests;

public sealed class LocalCertificateProviderTests
{
    private static string TempDir() => Path.Combine(Path.GetTempPath(), $"pulse-cert-{Guid.NewGuid():N}");

    [Fact]
    public void GenerateSelfSigned_has_private_key_and_localhost_san()
    {
        using var cert = LocalCertificateProvider.GenerateSelfSigned();

        Assert.True(cert.HasPrivateKey);
        Assert.Contains("PULSE Edge", cert.Subject);
        var san = cert.Extensions.FirstOrDefault(e => e.Oid?.Value == "2.5.29.17");
        Assert.NotNull(san);
        var text = san!.Format(false);
        Assert.Contains("localhost", text);
        Assert.Contains("127.0.0.1", text);
    }

    [Fact]
    public void GetOrCreate_generates_then_reuses_the_persisted_cert()
    {
        var dir = TempDir();
        try
        {
            var provider = new LocalCertificateProvider(new ConfigurationBuilder().Build(), dir);
            using var first = provider.GetOrCreateCertificate();
            using var second = provider.GetOrCreateCertificate();

            Assert.True(File.Exists(Path.Combine(dir, "pulse-edge.pfx")));
            Assert.Equal(first.Thumbprint, second.Thumbprint);
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }

    [Fact]
    public void GetOrCreate_prefers_a_configured_custom_cert()
    {
        var dir = TempDir();
        try
        {
            // Write a distinct custom cert to disk.
            using var custom = LocalCertificateProvider.GenerateSelfSigned();
            var customPath = Path.Combine(dir, "custom.pfx");
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(customPath, custom.Export(X509ContentType.Pfx));

            var config = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["Tls:CertPath"] = customPath })
                .Build();
            var provider = new LocalCertificateProvider(config, dir);
            using var loaded = provider.GetOrCreateCertificate();

            Assert.Equal(custom.Thumbprint, loaded.Thumbprint);
            Assert.False(File.Exists(Path.Combine(dir, "pulse-edge.pfx"))); // did not self-generate
        }
        finally { if (Directory.Exists(dir)) Directory.Delete(dir, true); }
    }
}
