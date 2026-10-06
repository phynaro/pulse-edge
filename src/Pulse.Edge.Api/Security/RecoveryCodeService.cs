using System.Security.Cryptography;
using System.Text;

namespace Pulse.Edge.Api.Security;

// Admin recovery codes — spec docs/superpowers/specs/2026-10-06-edge-password-recovery-design.md §5.
public sealed class RecoveryCodeService(PasswordService passwords)
{
    // Crockford Base32: no I, L, O or U, so a code copied from paper is hard to misread.
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private const int CodeLength = 20;
    private const int GroupSize = 4;

    // Verified against when there is no real hash, so a missing user costs the same time as a real one.
    private readonly Lazy<string> _dummyHash = new(() => passwords.Hash(Guid.NewGuid().ToString("N")));

    public string Generate()
    {
        var code = new StringBuilder(CodeLength + CodeLength / GroupSize);
        for (var i = 0; i < CodeLength; i++)
        {
            if (i > 0 && i % GroupSize == 0) code.Append('-');
            code.Append(Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)]);
        }
        return code.ToString();
    }

    public static string Normalize(string? input)
    {
        if (string.IsNullOrEmpty(input)) return string.Empty;
        var normalized = new StringBuilder(input.Length);
        foreach (var c in input.ToUpperInvariant())
        {
            if (c == '-' || char.IsWhiteSpace(c)) continue;
            normalized.Append(c switch { 'O' => '0', 'I' or 'L' => '1', _ => c });
        }
        return normalized.ToString();
    }

    public string Hash(string code) => passwords.Hash(Normalize(code));

    public bool Verify(string? input, string? storedHash)
    {
        var normalized = Normalize(input);
        if (string.IsNullOrEmpty(storedHash) || normalized.Length != CodeLength)
        {
            passwords.Verify(normalized, _dummyHash.Value);
            return false;
        }
        return passwords.Verify(normalized, storedHash);
    }
}
