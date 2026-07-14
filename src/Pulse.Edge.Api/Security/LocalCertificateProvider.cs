using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Configuration;

namespace Pulse.Edge.Api.Security;

public sealed class LocalCertificateProvider
{
    private readonly IConfiguration _config;
    private readonly string _dataDir;

    public LocalCertificateProvider(IConfiguration config) : this(config, ResolveDataDir()) { }

    public LocalCertificateProvider(IConfiguration config, string dataDir)
    {
        _config = config;
        _dataDir = dataDir;
    }

    private static string ResolveDataDir()
    {
        var overrideDir = Environment.GetEnvironmentVariable("PULSE_EDGE_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(overrideDir)) return overrideDir;
        var folder = OperatingSystem.IsWindows()
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "PULSE Edge")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".pulse");
        Directory.CreateDirectory(folder);
        return folder;
    }

    public X509Certificate2 GetOrCreateCertificate()
    {
        var certPath = _config["Tls:CertPath"];
        if (!string.IsNullOrWhiteSpace(certPath))
        {
            var pwd = _config["Tls:CertPassword"];
            return X509CertificateLoader.LoadPkcs12FromFile(
                certPath, string.IsNullOrEmpty(pwd) ? null : pwd, X509KeyStorageFlags.Exportable);
        }

        Directory.CreateDirectory(_dataDir);
        var pfxPath = Path.Combine(_dataDir, "pulse-edge.pfx");
        if (File.Exists(pfxPath))
        {
            return X509CertificateLoader.LoadPkcs12(File.ReadAllBytes(pfxPath), null, X509KeyStorageFlags.Exportable);
        }

        using var generated = GenerateSelfSigned();
        var pfxBytes = generated.Export(X509ContentType.Pfx);
        File.WriteAllBytes(pfxPath, pfxBytes);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(pfxPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        return X509CertificateLoader.LoadPkcs12(pfxBytes, null, X509KeyStorageFlags.Exportable);
    }

    public static X509Certificate2 GenerateSelfSigned(DateTimeOffset? notBefore = null, DateTimeOffset? notAfter = null)
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest(
            new X500DistinguishedName("CN=PULSE Edge"),
            rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false)); // serverAuth
        request.CertificateExtensions.Add(new X509KeyUsageExtension(
            X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));

        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(IPAddress.Loopback);
        san.AddIpAddress(IPAddress.IPv6Loopback);
        try { san.AddDnsName(Dns.GetHostName()); } catch { /* hostname unavailable */ }
        foreach (var ip in GetLocalIPv4Addresses()) san.AddIpAddress(ip);
        request.CertificateExtensions.Add(san.Build());

        var nb = notBefore ?? DateTimeOffset.UtcNow.AddDays(-1);
        var na = notAfter ?? DateTimeOffset.UtcNow.AddYears(5);
        return request.CreateSelfSigned(nb, na);
    }

    private static IEnumerable<IPAddress> GetLocalIPv4Addresses()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            foreach (var ua in ni.GetIPProperties().UnicastAddresses)
            {
                if (ua.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ua.Address))
                    yield return ua.Address;
            }
        }
    }
}
