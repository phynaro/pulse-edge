namespace Pulse.Edge.Storage.Security;

public interface ISecretProtector
{
    string Protect(string plaintext);
    // Returns the input unchanged if it is not valid ciphertext (legacy plaintext).
    string Unprotect(string stored);
    // True only if `stored` is ciphertext this protector produced.
    bool IsProtected(string stored);
}

/// <summary>
/// Process-wide holder so the non-DI <c>QueueDbContext</c> value converter can reach the
/// protector. <c>Program.cs</c> sets <see cref="Protector"/> at startup. The default is a
/// passthrough (no encryption) so EF tooling and unconfigured contexts do not crash; the
/// encryption integration test fails if the app leaves it unconfigured.
/// </summary>
public static class SecretProtection
{
    public static ISecretProtector Protector { get; set; } = PassthroughSecretProtector.Instance;
}

public sealed class PassthroughSecretProtector : ISecretProtector
{
    public static readonly PassthroughSecretProtector Instance = new();
    public string Protect(string plaintext) => plaintext;
    public string Unprotect(string stored) => stored;
    public bool IsProtected(string stored) => false;
}
