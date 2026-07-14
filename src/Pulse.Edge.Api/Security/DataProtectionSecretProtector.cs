using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Pulse.Edge.Storage.Security;

namespace Pulse.Edge.Api.Security;

public sealed class DataProtectionSecretProtector : ISecretProtector
{
    private readonly IDataProtector _protector;

    public DataProtectionSecretProtector(IDataProtectionProvider provider)
        => _protector = provider.CreateProtector("Pulse.Edge.DeviceConfig.CloudCredentials.v1");

    public string Protect(string plaintext)
        => string.IsNullOrEmpty(plaintext) ? plaintext : _protector.Protect(plaintext);

    public string Unprotect(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return stored;
        try { return _protector.Unprotect(stored); }
        catch (CryptographicException) { return stored; } // legacy plaintext
    }

    public bool IsProtected(string stored)
    {
        if (string.IsNullOrEmpty(stored)) return false;
        try { _protector.Unprotect(stored); return true; }
        catch (CryptographicException) { return false; }
    }
}
