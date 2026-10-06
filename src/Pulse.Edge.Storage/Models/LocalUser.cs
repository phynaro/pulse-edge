namespace Pulse.Edge.Storage.Models;

public class LocalUser
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Username { get; set; } = string.Empty;
    public string NormalizedUsername { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "ReadOnly";
    public bool IsEnabled { get; set; } = true;
    public int FailedLoginCount { get; set; }
    public DateTime? LockoutEndUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? LastLoginAtUtc { get; set; }

    // Rotated on every password reset/recovery, disable, or role change; the auth cookie
    // carries it and CurrentUserValidationMiddleware rejects a cookie whose stamp is stale.
    public string SecurityStamp { get; set; } = NewSecurityStamp();
    // PBKDF2 hash of the admin's current recovery code; empty = no code issued.
    public string RecoveryCodeHash { get; set; } = string.Empty;
    public DateTime? RecoveryCodeCreatedAtUtc { get; set; }

    public static string NewSecurityStamp() => Guid.NewGuid().ToString("N");
}

