using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using System.Security.Claims;

namespace Pulse.Edge.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/api/auth/setup-status", async (HttpContext context) =>
        {
            using var db = new QueueDbContext();
            var hasUsers = await db.LocalUsers.AnyAsync();
            var state = hasUsers ? "Operational" : "NeedsFirstAdmin";
            return Results.Ok(new { state, isAuthenticated = context.User.Identity?.IsAuthenticated == true,
                user = context.User.Identity?.IsAuthenticated == true ? ToCurrentUser(context.User) : null });
        });

        routes.MapPost("/api/auth/first-admin", async (CreateFirstAdminRequest request, HttpContext context, PasswordService passwords, RecoveryCodeService codes) =>
        {
            using var db = new QueueDbContext();
            if (await db.LocalUsers.AnyAsync()) return Results.Conflict(new { error = "Initial administrator has already been created." });
            var error = ValidateUserInput(request.Username, request.Password);
            if (error != null) return Results.BadRequest(new { error });
            var user = NewUser(request.Username, request.Password, "Admin", passwords);
            var recoveryCode = codes.Generate();
            user.RecoveryCodeHash = codes.Hash(recoveryCode);
            user.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
            db.LocalUsers.Add(user);
            db.AuditEvents.Add(Audit("FirstAdminCreated", "setup", user.Username, context, true));
            await db.SaveChangesAsync();
            await SignIn(context, user);
            return Results.Ok(new { user.Id, user.Username, user.Role, user.IsEnabled, user.CreatedAtUtc, user.LastLoginAtUtc, user.LockoutEndUtc, recoveryCode });
        });

        routes.MapPost("/api/auth/login", async (LoginRequest request, HttpContext context, PasswordService passwords) =>
        {
            using var db = new QueueDbContext();
            var normalized = Normalize(request.Username);
            var user = await db.LocalUsers.FirstOrDefaultAsync(x => x.NormalizedUsername == normalized);
            var valid = user is { IsEnabled: true } && (user.LockoutEndUtc == null || user.LockoutEndUtc <= DateTime.UtcNow) && passwords.Verify(request.Password, user.PasswordHash);
            if (!valid)
            {
                if (user != null)
                {
                    user.FailedLoginCount++;
                    if (user.FailedLoginCount >= 5) user.LockoutEndUtc = DateTime.UtcNow.AddMinutes(15);
                }
                db.AuditEvents.Add(Audit("Login", request.Username, request.Username, context, false));
                await db.SaveChangesAsync();
                return Results.Json(new { error = "Invalid username or password." }, statusCode: 401);
            }
            user!.FailedLoginCount = 0;
            user.LockoutEndUtc = null;
            user.LastLoginAtUtc = DateTime.UtcNow;
            user.UpdatedAtUtc = DateTime.UtcNow;
            db.AuditEvents.Add(Audit("Login", user.Username, user.Username, context, true));
            await db.SaveChangesAsync();
            await SignIn(context, user);
            return Results.Ok(ToUser(user));
        }).RequireRateLimiting("login");

        routes.MapPost("/api/auth/logout", async (HttpContext context) =>
        {
            await context.SignOutAsync();
            return Results.Ok(new { success = true });
        });

        // Admin self-service recovery (spec 2026-10-06-edge-password-recovery-design §5.3). Every
        // failure returns the same 401 so the endpoint never reveals which usernames exist.
        routes.MapPost("/api/auth/recover", async (RecoverRequest request, HttpContext context, PasswordService passwords, RecoveryCodeService codes) =>
        {
            if (PasswordService.Validate(request.NewPassword ?? "") is { } passwordError)
                return Results.BadRequest(new { error = passwordError });
            using var db = new QueueDbContext();
            var normalized = Normalize(request.Username ?? "");
            var user = await db.LocalUsers.FirstOrDefaultAsync(x => x.NormalizedUsername == normalized);
            var eligible = user is { Role: "Admin", IsEnabled: true };
            // Verify always runs (against a dummy hash when ineligible) so timing is uniform.
            var valid = codes.Verify(request.RecoveryCode, eligible ? user!.RecoveryCodeHash : null) && eligible;
            if (!valid)
            {
                db.AuditEvents.Add(Audit("PasswordRecovered", request.Username ?? "", request.Username ?? "", context, false));
                await db.SaveChangesAsync();
                return Results.Json(new { error = "Invalid username or recovery code." }, statusCode: 401);
            }
            var newCode = codes.Generate();
            user!.PasswordHash = passwords.Hash(request.NewPassword!);
            user.SecurityStamp = LocalUser.NewSecurityStamp();
            user.FailedLoginCount = 0;
            user.LockoutEndUtc = null;
            user.RecoveryCodeHash = codes.Hash(newCode);
            user.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
            user.UpdatedAtUtc = DateTime.UtcNow;
            db.AuditEvents.Add(Audit("PasswordRecovered", user.Username, user.Username, context, true));
            await db.SaveChangesAsync();
            return Results.Ok(new { recoveryCode = newCode });
        }).RequireRateLimiting("login");

        routes.MapPost("/api/auth/recovery-code", async (RegenerateRecoveryCodeRequest request, HttpContext context, PasswordService passwords, RecoveryCodeService codes) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();
            using var db = new QueueDbContext();
            var user = await db.LocalUsers.FindAsync(context.User.FindFirstValue(ClaimTypes.NameIdentifier));
            if (user == null) return Results.Unauthorized();
            if (!passwords.Verify(request.CurrentPassword ?? "", user.PasswordHash))
            {
                db.AuditEvents.Add(Audit("RecoveryCodeRegenerated", user.Username, user.Username, context, false));
                await db.SaveChangesAsync();
                return Results.BadRequest(new { error = "Current password is incorrect." });
            }
            var code = codes.Generate();
            user.RecoveryCodeHash = codes.Hash(code);
            user.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
            user.UpdatedAtUtc = DateTime.UtcNow;
            db.AuditEvents.Add(Audit("RecoveryCodeRegenerated", user.Username, user.Username, context, true));
            await db.SaveChangesAsync();
            return Results.Ok(new { recoveryCode = code });
        });

        routes.MapGet("/api/auth/me", async (HttpContext context) =>
        {
            var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            using var db = new QueueDbContext();
            var user = await db.LocalUsers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
            return Results.Ok(new
            {
                id, username = context.User.Identity?.Name, role = context.User.FindFirstValue(ClaimTypes.Role),
                hasRecoveryCode = !string.IsNullOrEmpty(user?.RecoveryCodeHash),
                recoveryCodeCreatedAtUtc = user?.RecoveryCodeCreatedAtUtc,
            });
        });

        routes.MapGet("/api/users", async (HttpContext context) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();
            using var db = new QueueDbContext();
            var users = await db.LocalUsers.AsNoTracking().OrderBy(x => x.Username).ToListAsync();
            return Results.Ok(users.Select(ToUser));
        });

        routes.MapPost("/api/users", async (CreateUserRequest request, HttpContext context, PasswordService passwords) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();
            var error = ValidateUserInput(request.Username, request.Password) ?? ValidateRole(request.Role);
            if (error != null) return Results.BadRequest(new { error });
            using var db = new QueueDbContext();
            if (await db.LocalUsers.AnyAsync(x => x.NormalizedUsername == Normalize(request.Username))) return Results.Conflict(new { error = "Username already exists." });
            var user = NewUser(request.Username, request.Password, request.Role, passwords);
            db.LocalUsers.Add(user);
            db.AuditEvents.Add(Audit("UserCreated", context.User.Identity!.Name!, user.Username, context, true));
            await db.SaveChangesAsync();
            return Results.Ok(ToUser(user));
        });

        routes.MapPut("/api/users/{id}", async (string id, UpdateUserRequest request, HttpContext context, PasswordService passwords) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();
            using var db = new QueueDbContext();
            var user = await db.LocalUsers.FindAsync(id);
            if (user == null) return Results.NotFound();
            if (request.Role != null && ValidateRole(request.Role) is { } roleError) return Results.BadRequest(new { error = roleError });
            var removesAdmin = user.Role == "Admin" && ((request.Role != null && request.Role != "Admin") || request.IsEnabled == false);
            if (removesAdmin && await db.LocalUsers.CountAsync(x => x.Role == "Admin" && x.IsEnabled) <= 1)
                return Results.BadRequest(new { error = "The final enabled administrator cannot be disabled or demoted." });
            var passwordChanged = !string.IsNullOrEmpty(request.Password);
            if (passwordChanged && PasswordService.Validate(request.Password!) is { } passwordError)
                return Results.BadRequest(new { error = passwordError });
            var roleChanged = request.Role != null && request.Role != user.Role;
            var disabling = request.IsEnabled == false && user.IsEnabled;

            if (roleChanged && user.Role == "Admin")
            {
                // Recovery codes are admin-only; a demoted user must not keep one.
                user.RecoveryCodeHash = string.Empty;
                user.RecoveryCodeCreatedAtUtc = null;
            }
            if (request.Role != null) user.Role = request.Role;
            if (request.IsEnabled.HasValue) user.IsEnabled = request.IsEnabled.Value;
            if (passwordChanged) user.PasswordHash = passwords.Hash(request.Password!);
            if (passwordChanged || roleChanged || disabling) user.SecurityStamp = LocalUser.NewSecurityStamp();
            user.UpdatedAtUtc = DateTime.UtcNow;
            db.AuditEvents.Add(Audit("UserUpdated", context.User.Identity!.Name!, user.Username, context, true));
            await db.SaveChangesAsync();
            // The stamp rotation above would sign the acting admin out of their own session.
            var isSelf = context.User.FindFirstValue(ClaimTypes.NameIdentifier) == user.Id;
            if (isSelf && user.IsEnabled && (passwordChanged || roleChanged)) await SignIn(context, user);
            return Results.Ok(ToUser(user));
        });

        routes.MapDelete("/api/users/{id}", async (string id, HttpContext context) =>
        {
            if (!context.User.IsInRole("Admin")) return Results.Forbid();
            if (context.User.FindFirstValue(ClaimTypes.NameIdentifier) == id) return Results.BadRequest(new { error = "You cannot delete your active account." });
            using var db = new QueueDbContext();
            var user = await db.LocalUsers.FindAsync(id);
            if (user == null) return Results.NotFound();
            if (user.Role == "Admin" && user.IsEnabled && await db.LocalUsers.CountAsync(x => x.Role == "Admin" && x.IsEnabled) <= 1)
                return Results.BadRequest(new { error = "The final enabled administrator cannot be deleted." });
            db.LocalUsers.Remove(user);
            db.AuditEvents.Add(Audit("UserDeleted", context.User.Identity!.Name!, user.Username, context, true));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static async Task SignIn(HttpContext context, LocalUser user) => await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
        new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Name, user.Username), new Claim(ClaimTypes.Role, user.Role),
            new Claim(CurrentUserValidationMiddleware.SecurityStampClaim, user.SecurityStamp)
        ], CookieAuthenticationDefaults.AuthenticationScheme)));
    private static LocalUser NewUser(string username, string password, string role, PasswordService passwords) => new()
        { Username = username.Trim(), NormalizedUsername = Normalize(username), PasswordHash = passwords.Hash(password), Role = role };
    private static string Normalize(string username) => username.Trim().ToUpperInvariant();
    private static string? ValidateUserInput(string username, string password) => string.IsNullOrWhiteSpace(username) || username.Trim().Length < 3
        ? "Username must be at least 3 characters." : PasswordService.Validate(password);
    private static string? ValidateRole(string role) => role is "Admin" or "ReadOnly" ? null : "Role must be Admin or ReadOnly.";
    private static object ToUser(LocalUser x) => new { x.Id, x.Username, x.Role, x.IsEnabled, x.CreatedAtUtc, x.LastLoginAtUtc, x.LockoutEndUtc };
    private static object ToCurrentUser(ClaimsPrincipal user) => new { id = user.FindFirstValue(ClaimTypes.NameIdentifier), username = user.Identity?.Name, role = user.FindFirstValue(ClaimTypes.Role) };
    private static AuditEvent Audit(string type, string actor, string target, HttpContext context, bool succeeded) => new()
        { EventType = type, ActorUsername = actor, Target = target, RemoteIp = context.Connection.RemoteIpAddress?.ToString() ?? "", Succeeded = succeeded };
}

public record LoginRequest(string Username, string Password);
public record CreateFirstAdminRequest(string Username, string Password);
public record CreateUserRequest(string Username, string Password, string Role);
public record UpdateUserRequest(string? Role, bool? IsEnabled, string? Password);
public record RecoverRequest(string? Username, string? RecoveryCode, string? NewPassword);
public record RegenerateRecoveryCodeRequest(string? CurrentPassword);
