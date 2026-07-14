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
            var config = await db.DeviceConfigs.AsNoTracking().FirstOrDefaultAsync();
            var connected = string.Equals(config?.CloudStatus, "Connected", StringComparison.OrdinalIgnoreCase);
            var state = hasUsers ? "Operational" : connected ? "NeedsFirstAdmin" : "NeedsCloudSetup";
            return Results.Ok(new { state, isAuthenticated = context.User.Identity?.IsAuthenticated == true,
                user = context.User.Identity?.IsAuthenticated == true ? ToCurrentUser(context.User) : null });
        });

        routes.MapPost("/api/auth/first-admin", async (CreateFirstAdminRequest request, HttpContext context, PasswordService passwords) =>
        {
            using var db = new QueueDbContext();
            if (await db.LocalUsers.AnyAsync()) return Results.Conflict(new { error = "Initial administrator has already been created." });
            var config = await db.DeviceConfigs.AsNoTracking().FirstOrDefaultAsync();
            if (!string.Equals(config?.CloudStatus, "Connected", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { error = "Cloud pairing must be completed first." });
            var error = ValidateUserInput(request.Username, request.Password);
            if (error != null) return Results.BadRequest(new { error });
            var user = NewUser(request.Username, request.Password, "Admin", passwords);
            db.LocalUsers.Add(user);
            db.AuditEvents.Add(Audit("FirstAdminCreated", "setup", user.Username, context, true));
            await db.SaveChangesAsync();
            await SignIn(context, user);
            return Results.Ok(ToUser(user));
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

        routes.MapGet("/api/auth/me", (HttpContext context) => Results.Ok(ToCurrentUser(context.User)));

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
            if (request.Role != null) user.Role = request.Role;
            if (request.IsEnabled.HasValue) user.IsEnabled = request.IsEnabled.Value;
            if (!string.IsNullOrEmpty(request.Password))
            {
                var passwordError = PasswordService.Validate(request.Password);
                if (passwordError != null) return Results.BadRequest(new { error = passwordError });
                user.PasswordHash = passwords.Hash(request.Password);
            }
            user.UpdatedAtUtc = DateTime.UtcNow;
            db.AuditEvents.Add(Audit("UserUpdated", context.User.Identity!.Name!, user.Username, context, true));
            await db.SaveChangesAsync();
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
            new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Name, user.Username), new Claim(ClaimTypes.Role, user.Role)
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
