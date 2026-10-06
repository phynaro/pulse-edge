# Edge Password Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a locked-out Edge user regain access without a factory reset — via admin recovery codes (web) and a `reset-password` console command — and make every password reset end existing sessions.

**Architecture:** Three new `LocalUser` columns (`SecurityStamp`, `RecoveryCodeHash`, `RecoveryCodeCreatedAtUtc`) added by the existing in-code SQLite upgrade path. A `RecoveryCodeService` (API `Security/`) generates/hashes/verifies codes; `AuthEndpoints` gains `/api/auth/recover` and `/api/auth/recovery-code`; the cookie carries a `pulse:stamp` claim checked by `CurrentUserValidationMiddleware`. `Program.cs` dispatches `reset-password` args to a `PasswordResetCommand` before the web host is built. React UI adds a forgot-password panel, a reusable recovery-code save component, an onboarding step, and a self-service regenerate panel.

**Tech Stack:** .NET 10 Minimal APIs, EF Core + SQLite, xUnit + WebApplicationFactory; React 19 + Vite, react-i18next, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-06-edge-password-recovery-design.md`

## Global Constraints

- Build must stay clean under `dotnet build Pulse.Edge.slnx --warnaserror`; `pnpm lint:ui` must have zero errors.
- No literal secrets in tests: use `TestCredentials` (backend) / `testCredentials` (frontend) helpers; generate recovery codes at runtime. GitGuardian scans history.
- Recovery code: 20 Crockford Base32 chars (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), shown as 5 groups of 4 joined by `-`; stored only as a `PasswordService.Hash` of the normalized code.
- Generic recover failure message, exactly: `Invalid username or recovery code.`
- Regenerate wrong-password message, exactly: `Current password is incorrect.`
- Audit event types, exactly: `PasswordRecovered`, `RecoveryCodeRegenerated`, `PasswordResetConsole`.
- Session claim type, exactly: `pulse:stamp`.
- Console exit codes: `0` success, `1` database error / usage error, `2` unknown user, `3` password rules or confirmation not satisfied.
- Console command: no OS elevation check, not mentioned anywhere in the UI.
- New UI strings go through i18n with both `en.ts` and `th.ts` (`th` is typed `typeof en`, so keys must match).
- UI work uses the PULSE design system — invoke the `pulse` skill before Tasks 6–7.
- **Work in a clean worktree.** The main checkout has unrelated uncommitted edits in `en.ts`, `th.ts`, `index.css`, `App.tsx`, etc. Execute this plan in a git worktree created from `feat/password-recovery` (superpowers:using-git-worktrees) so those edits are never swept into these commits.

## Review Focus

1. **Recovery code pasted with spaces, lowercase, or `O`/`I`/`L` look-alikes** — must still verify. Pinned in Task 2 (`Normalize` test) and Task 4 (recover with lowercased, dash-free code).
2. **Device already paired (ApiKey set) and nobody logged in** — `/api/auth/recover` must still be reachable; the middleware's post-setup lockdown blocks every other anonymous path. Pinned in Task 4 (`Recover_is_reachable_after_device_is_paired`).
3. **Admin changes their own password in User Management** — must stay signed in despite the stamp rotation. Pinned in Task 3.
4. **Account currently locked out (5 bad logins)** — recovery must still work and clear the lockout. Pinned in Task 4.
5. **Console command run with piped stdin (script/SSH)** — must not hang waiting for masked keys and must not re-prompt. Pinned in Task 5 (non-interactive tests).

---

### Task 1: LocalUser columns + schema upgrade

**Files:**
- Modify: `src/Pulse.Edge.Storage/Models/LocalUser.cs`
- Modify: `src/Pulse.Edge.Storage/Services/QueueStorageService.cs` (LocalUsers `CREATE TABLE` at ~line 53; add call after the big `ExecuteSqlRawAsync` block ending ~line 97)
- Test: `src/Pulse.Edge.Tests/LocalUserSchemaUpgradeTests.cs`

**Interfaces:**
- Produces: `LocalUser.SecurityStamp` (string, defaults to a new stamp), `LocalUser.RecoveryCodeHash` (string, default `""`), `LocalUser.RecoveryCodeCreatedAtUtc` (`DateTime?`), `static string LocalUser.NewSecurityStamp()`, `public static Task QueueStorageService.UpgradeLocalUsersSchemaAsync(QueueDbContext db)`.

- [ ] **Step 1: Write the failing test**

```csharp
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Services;
using Xunit;

namespace Pulse.Edge.Tests;

public sealed class LocalUserSchemaUpgradeTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"pulse-users-upgrade-{Guid.NewGuid():N}.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_dbPath);
    }

    [Fact]
    public async Task Legacy_users_table_gains_columns_and_every_user_gets_a_stamp()
    {
        await using (var db = new QueueDbContext(_dbPath))
        {
            // The pre-recovery LocalUsers shape, exactly as older devices have it.
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE TABLE LocalUsers (
                    Id TEXT PRIMARY KEY, Username TEXT NOT NULL, NormalizedUsername TEXT NOT NULL UNIQUE,
                    PasswordHash TEXT NOT NULL, Role TEXT NOT NULL, IsEnabled INTEGER NOT NULL DEFAULT 1,
                    FailedLoginCount INTEGER NOT NULL DEFAULT 0, LockoutEndUtc TEXT,
                    CreatedAtUtc TEXT NOT NULL, UpdatedAtUtc TEXT NOT NULL, LastLoginAtUtc TEXT);
                INSERT INTO LocalUsers (Id, Username, NormalizedUsername, PasswordHash, Role, CreatedAtUtc, UpdatedAtUtc)
                VALUES ('u1', 'alice', 'ALICE', 'x', 'Admin', '2026-01-01 00:00:00', '2026-01-01 00:00:00');
                INSERT INTO LocalUsers (Id, Username, NormalizedUsername, PasswordHash, Role, CreatedAtUtc, UpdatedAtUtc)
                VALUES ('u2', 'bob', 'BOB', 'x', 'ReadOnly', '2026-01-01 00:00:00', '2026-01-01 00:00:00');");

            await QueueStorageService.UpgradeLocalUsersSchemaAsync(db);
            await QueueStorageService.UpgradeLocalUsersSchemaAsync(db); // idempotent
        }

        await using var check = new QueueDbContext(_dbPath);
        var users = await check.LocalUsers.AsNoTracking().OrderBy(x => x.Id).ToListAsync();
        Assert.Equal(2, users.Count);
        Assert.All(users, u =>
        {
            Assert.Equal(32, u.SecurityStamp.Length);
            Assert.Equal("", u.RecoveryCodeHash);
            Assert.Null(u.RecoveryCodeCreatedAtUtc);
        });
        Assert.NotEqual(users[0].SecurityStamp, users[1].SecurityStamp);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LocalUserSchemaUpgradeTests`
Expected: build FAIL — `UpgradeLocalUsersSchemaAsync` / `SecurityStamp` not defined.

- [ ] **Step 3: Add the model fields**

In `LocalUser.cs`, add after `LastLoginAtUtc`:

```csharp
    // Rotated on every password reset/recovery, disable, or role change; the auth cookie
    // carries it and CurrentUserValidationMiddleware rejects a cookie whose stamp is stale.
    public string SecurityStamp { get; set; } = NewSecurityStamp();
    // PBKDF2 hash of the admin's current recovery code; empty = no code issued.
    public string RecoveryCodeHash { get; set; } = string.Empty;
    public DateTime? RecoveryCodeCreatedAtUtc { get; set; }

    public static string NewSecurityStamp() => Guid.NewGuid().ToString("N");
```

- [ ] **Step 4: Add the upgrade method and wire it**

In `QueueStorageService.cs`, extend the `CREATE TABLE IF NOT EXISTS LocalUsers (...)` column list (after `LastLoginAtUtc TEXT`) with:

```sql
                LastLoginAtUtc TEXT,
                SecurityStamp TEXT NOT NULL DEFAULT '',
                RecoveryCodeHash TEXT NOT NULL DEFAULT '',
                RecoveryCodeCreatedAtUtc TEXT
```

Immediately after that big `ExecuteSqlRawAsync(@"...")` call (the one ending with `INSERT OR IGNORE INTO DiagnosticCaptureConfigs (Id) VALUES (1);`), add:

```csharp
        await UpgradeLocalUsersSchemaAsync(db);
```

Add this public static method to the class (next to `InitializeCoreAsync`):

```csharp
    // Password-recovery columns (spec 2026-10-06-edge-password-recovery-design §4). Idempotent:
    // ADD COLUMN throws when the column exists, which we ignore like the other upgrades here.
    // Users from before this upgrade get a random stamp, which signs out their old cookies once.
    public static async Task UpgradeLocalUsersSchemaAsync(QueueDbContext db)
    {
        string[] columns =
        [
            "ALTER TABLE LocalUsers ADD COLUMN SecurityStamp TEXT NOT NULL DEFAULT '';",
            "ALTER TABLE LocalUsers ADD COLUMN RecoveryCodeHash TEXT NOT NULL DEFAULT '';",
            "ALTER TABLE LocalUsers ADD COLUMN RecoveryCodeCreatedAtUtc TEXT;",
        ];
        foreach (var ddl in columns)
        {
            try { await db.Database.ExecuteSqlRawAsync(ddl); }
            catch { /* Column already exists */ }
        }
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE LocalUsers SET SecurityStamp = lower(hex(randomblob(16))) WHERE SecurityStamp = '';");
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~LocalUserSchemaUpgradeTests`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite (the persisted itests DB must upgrade cleanly)**

Run: `dotnet build Pulse.Edge.slnx --warnaserror && dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj`
Expected: build clean, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Pulse.Edge.Storage/Models/LocalUser.cs src/Pulse.Edge.Storage/Services/QueueStorageService.cs src/Pulse.Edge.Tests/LocalUserSchemaUpgradeTests.cs
git commit -m "feat(storage): add security stamp and recovery code columns to LocalUsers"
```

---

### Task 2: RecoveryCodeService

**Files:**
- Create: `src/Pulse.Edge.Api/Security/RecoveryCodeService.cs`
- Modify: `src/Pulse.Edge.Api/Program.cs:183` (DI registration)
- Test: `src/Pulse.Edge.Tests/RecoveryCodeServiceTests.cs`

**Interfaces:**
- Consumes: `PasswordService.Hash(string)`, `PasswordService.Verify(string, string)`.
- Produces: `sealed class RecoveryCodeService(PasswordService passwords)` with `string Generate()`, `static string Normalize(string? input)`, `string Hash(string code)`, `bool Verify(string? input, string? storedHash)`. Registered as a singleton.

- [ ] **Step 1: Write the failing tests**

```csharp
using System.Text.RegularExpressions;
using Pulse.Edge.Api.Security;
using Xunit;

namespace Pulse.Edge.Tests;

public sealed class RecoveryCodeServiceTests
{
    private readonly RecoveryCodeService _codes = new(new PasswordService());

    [Fact]
    public void Generate_produces_five_dash_separated_groups_of_crockford_base32()
    {
        var code = _codes.Generate();
        Assert.Matches(new Regex("^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$"), code);
        Assert.NotEqual(code, _codes.Generate());
    }

    [Fact]
    public void Normalize_strips_separators_uppercases_and_maps_look_alikes()
    {
        Assert.Equal("ABCD011", RecoveryCodeService.Normalize("ab-cd o il"));
        Assert.Equal("", RecoveryCodeService.Normalize(null));
    }

    [Fact]
    public void Verify_accepts_the_issued_code_in_any_casing_or_grouping()
    {
        var code = _codes.Generate();
        var hash = _codes.Hash(code);
        Assert.True(_codes.Verify(code, hash));
        Assert.True(_codes.Verify(code.Replace("-", "").ToLowerInvariant(), hash));
        Assert.True(_codes.Verify(" " + code.Replace("-", " ") + " ", hash));
    }

    [Fact]
    public void Verify_rejects_wrong_code_and_missing_hash()
    {
        var hash = _codes.Hash(_codes.Generate());
        Assert.False(_codes.Verify(_codes.Generate(), hash));
        Assert.False(_codes.Verify(_codes.Generate(), ""));
        Assert.False(_codes.Verify(null, hash));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~RecoveryCodeServiceTests`
Expected: build FAIL — `RecoveryCodeService` not defined.

- [ ] **Step 3: Implement**

```csharp
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
```

In `Program.cs`, after `builder.Services.AddSingleton<PasswordService>();` add:

```csharp
builder.Services.AddSingleton<RecoveryCodeService>();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~RecoveryCodeServiceTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/Pulse.Edge.Api/Security/RecoveryCodeService.cs src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Tests/RecoveryCodeServiceTests.cs
git commit -m "feat(auth): add RecoveryCodeService for admin recovery codes"
```

---

### Task 3: Session revocation via SecurityStamp

**Files:**
- Modify: `src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs` (`SignIn` helper; `PUT /api/users/{id}` handler)
- Modify: `src/Pulse.Edge.Api/Security/CurrentUserValidationMiddleware.cs` (authenticated-user check)
- Modify: `src/Pulse.Edge.Tests/Integration/TestCredentials.cs`
- Test: `src/Pulse.Edge.Tests/Integration/SessionRevocationTests.cs`

**Interfaces:**
- Consumes: `LocalUser.SecurityStamp`, `LocalUser.NewSecurityStamp()` (Task 1).
- Produces: `public const string CurrentUserValidationMiddleware.SecurityStampClaim = "pulse:stamp"`; `TestCredentials.StrongPassword` (policy-compliant test password); `TestCredentials.SecondAdminUsername`.

- [ ] **Step 1: Add test credentials**

In `TestCredentials.cs` add:

```csharp
    /// <summary>
    /// Satisfies the production password policy (10+ chars, upper, lower, digit, special) for
    /// API paths that validate it (recover, first-admin, admin reset). Non-secret fallback.
    /// </summary>
    public static string StrongPassword =>
        Environment.GetEnvironmentVariable("PULSE_TEST_STRONG_PASSWORD") ?? "Not-a-real-Pw-1";

    public const string SecondAdminUsername = "test-admin-two";
```

- [ ] **Step 2: Write the failing tests**

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class SessionRevocationTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private static async Task<string> IdOfAsync(string username)
    {
        await using var db = new QueueDbContext();
        return (await db.LocalUsers.AsNoTracking().SingleAsync(x => x.Username == username)).Id;
    }

    [Fact]
    public async Task Admin_password_reset_signs_out_the_targets_existing_sessions()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var target = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);
        Assert.Equal(HttpStatusCode.OK, (await target.GetAsync("/api/auth/me")).StatusCode);

        var reset = await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.ReadOnlyUsername)}",
            new { Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await target.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Disabling_a_user_signs_out_their_sessions()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var target = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);

        await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.ReadOnlyUsername)}", new { IsEnabled = false });

        Assert.Equal(HttpStatusCode.Unauthorized, (await target.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Admin_changing_their_own_password_stays_signed_in()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var change = await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.AdminUsername)}",
            new { Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, change.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Demoting_an_admin_clears_their_recovery_code()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.SecondAdminUsername, TestCredentials.Password);
        var codes = new RecoveryCodeService(new PasswordService());
        await using (var db = new QueueDbContext())
        {
            var second = await db.LocalUsers.SingleAsync(x => x.Username == TestCredentials.SecondAdminUsername);
            second.RecoveryCodeHash = codes.Hash(codes.Generate());
            second.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
            await db.SaveChangesAsync();
        }

        await admin.PutAsJsonAsync($"/api/users/{await IdOfAsync(TestCredentials.SecondAdminUsername)}", new { Role = "ReadOnly" });

        await using var check = new QueueDbContext();
        var demoted = await check.LocalUsers.AsNoTracking().SingleAsync(x => x.Username == TestCredentials.SecondAdminUsername);
        Assert.Equal("", demoted.RecoveryCodeHash);
        Assert.Null(demoted.RecoveryCodeCreatedAtUtc);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~SessionRevocationTests`
Expected: `Admin_password_reset_signs_out…`, `Disabling_a_user…` and `Demoting_an_admin…` FAIL (sessions still valid / code not cleared). `Admin_changing_their_own_password…` passes already (it guards the re-sign-in we add next).

- [ ] **Step 4: Put the stamp in the cookie and check it**

In `CurrentUserValidationMiddleware`, add to the class:

```csharp
    public const string SecurityStampClaim = "pulse:stamp";
```

and change the authenticated-user rejection condition to:

```csharp
            if (user == null || !string.Equals(user.Role, claimedRole, StringComparison.Ordinal) ||
                !string.Equals(user.SecurityStamp, context.User.FindFirstValue(SecurityStampClaim), StringComparison.Ordinal))
```

In `AuthEndpoints.SignIn`, add the claim to the identity's claim list:

```csharp
            new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Name, user.Username), new Claim(ClaimTypes.Role, user.Role),
            new Claim(CurrentUserValidationMiddleware.SecurityStampClaim, user.SecurityStamp)
```

- [ ] **Step 5: Rotate the stamp in `PUT /api/users/{id}`**

Replace the whole `routes.MapPut("/api/users/{id}", ...)` handler with:

```csharp
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
```

- [ ] **Step 6: Run tests to verify they pass, plus the existing auth suites**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter "FullyQualifiedName~SessionRevocationTests|FullyQualifiedName~AuthorizationMatrixTests|FullyQualifiedName~HarnessSmokeTests"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs src/Pulse.Edge.Api/Security/CurrentUserValidationMiddleware.cs src/Pulse.Edge.Tests/Integration/TestCredentials.cs src/Pulse.Edge.Tests/Integration/SessionRevocationTests.cs
git commit -m "feat(auth): revoke sessions on password reset, disable, and role change"
```

---

### Task 4: Recovery endpoints

**Files:**
- Modify: `src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs` (first-admin, `/api/auth/me`, two new endpoints, two new request records)
- Modify: `src/Pulse.Edge.Api/Security/CurrentUserValidationMiddleware.cs` (anonymous allowlist + post-setup exclusion)
- Modify: `src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs` (two matrix rows)
- Test: `src/Pulse.Edge.Tests/Integration/PasswordRecoveryTests.cs`

**Interfaces:**
- Consumes: `RecoveryCodeService` (Task 2), `LocalUser.NewSecurityStamp()` (Task 1), `TestCredentials.StrongPassword` (Task 3).
- Produces (HTTP, used by Tasks 6–7):
  - `POST /api/auth/first-admin` → 200 body now also has `recoveryCode: string`.
  - `GET /api/auth/me` → `{ id, username, role, hasRecoveryCode: boolean, recoveryCodeCreatedAtUtc: string | null }`.
  - `POST /api/auth/recover` body `{ username, recoveryCode, newPassword }` → 200 `{ recoveryCode }` | 400 `{ error }` | 401 `{ error: "Invalid username or recovery code." }` | 429.
  - `POST /api/auth/recovery-code` body `{ currentPassword }` → 200 `{ recoveryCode }` | 400 `{ error: "Current password is incorrect." }` | 403 (non-admin).

- [ ] **Step 1: Write the failing tests**

```csharp
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;

namespace Pulse.Edge.Tests.Integration;

[Collection("EdgeApi")]
public sealed class PasswordRecoveryTests(PulseEdgeAppFactory factory) : IClassFixture<PulseEdgeAppFactory>
{
    private static readonly RecoveryCodeService Codes = new(new PasswordService());
    private const string GenericError = "Invalid username or recovery code.";

    private static async Task<string> GiveRecoveryCodeAsync(string username)
    {
        var code = Codes.Generate();
        await using var db = new QueueDbContext();
        var user = await db.LocalUsers.SingleAsync(x => x.Username == username);
        user.RecoveryCodeHash = Codes.Hash(code);
        user.RecoveryCodeCreatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return code;
    }

    private static object Recover(string username, string code, string newPassword) =>
        new { Username = username, RecoveryCode = code, NewPassword = newPassword };

    private static async Task<string> ReadStringAsync(HttpResponseMessage response, string property) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty(property).GetString()!;

    [Fact]
    public async Task Valid_code_resets_password_issues_a_new_code_and_ends_old_sessions()
    {
        await factory.ResetDatabaseAsync();
        var oldSession = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var code = await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);
        var anonymous = factory.CreateClient();

        var response = await anonymous.PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code.Replace("-", "").ToLowerInvariant(), TestCredentials.StrongPassword));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var newCode = await ReadStringAsync(response, "recoveryCode");
        Assert.NotEqual(code, newCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await oldSession.GetAsync("/api/auth/me")).StatusCode);
        var login = await factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        // Single use: the consumed code no longer works, the new one does.
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, newCode, TestCredentials.StrongPassword))).StatusCode);
    }

    [Fact]
    public async Task Wrong_code_unknown_user_readonly_and_disabled_all_get_the_same_401()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.SecondAdminUsername, TestCredentials.Password);
        _ = await factory.CreateClientLoggedInAsync("ReadOnly", TestCredentials.ReadOnlyUsername, TestCredentials.Password);
        await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);
        var readOnlyCode = await GiveRecoveryCodeAsync(TestCredentials.ReadOnlyUsername);
        var disabledCode = await GiveRecoveryCodeAsync(TestCredentials.SecondAdminUsername);
        await using (var db = new QueueDbContext())
        {
            (await db.LocalUsers.SingleAsync(x => x.Username == TestCredentials.SecondAdminUsername)).IsEnabled = false;
            await db.SaveChangesAsync();
        }
        var anonymous = factory.CreateClient();

        var attempts = new[]
        {
            Recover(TestCredentials.AdminUsername, Codes.Generate(), TestCredentials.StrongPassword),
            Recover(TestCredentials.NonexistentUsername, Codes.Generate(), TestCredentials.StrongPassword),
            Recover(TestCredentials.ReadOnlyUsername, readOnlyCode, TestCredentials.StrongPassword),
            Recover(TestCredentials.SecondAdminUsername, disabledCode, TestCredentials.StrongPassword),
        };
        foreach (var body in attempts)
        {
            var response = await anonymous.PostAsJsonAsync("/api/auth/recover", body);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal(GenericError, await ReadStringAsync(response, "error"));
        }
    }

    [Fact]
    public async Task Recovery_works_while_locked_out_and_clears_the_lockout()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var code = await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);
        await using (var db = new QueueDbContext())
        {
            var user = await db.LocalUsers.SingleAsync(x => x.Username == TestCredentials.AdminUsername);
            user.FailedLoginCount = 5;
            user.LockoutEndUtc = DateTime.UtcNow.AddMinutes(15);
            await db.SaveChangesAsync();
        }

        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var login = await factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task Weak_new_password_is_rejected_with_400()
    {
        await factory.ResetDatabaseAsync();
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);
        var code = await GiveRecoveryCodeAsync(TestCredentials.AdminUsername);

        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, "short"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Recover_is_reachable_after_device_is_paired()
    {
        await factory.ResetDatabaseAsync();
        await factory.SeedDeviceConfigAsync(c => c.ApiKey = TestCredentials.SamplePairingToken);
        _ = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var response = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, Codes.Generate(), TestCredentials.StrongPassword));

        // A middleware rejection is a bare 401; reaching the handler yields the generic error body.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(GenericError, await ReadStringAsync(response, "error"));
    }

    [Fact]
    public async Task Regenerate_requires_current_password_and_the_new_code_works()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var wrong = await admin.PostAsJsonAsync("/api/auth/recovery-code", new { CurrentPassword = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Equal("Current password is incorrect.", await ReadStringAsync(wrong, "error"));

        var ok = await admin.PostAsJsonAsync("/api/auth/recovery-code", new { CurrentPassword = TestCredentials.Password });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var code = await ReadStringAsync(ok, "recoveryCode");

        var me = JsonDocument.Parse(await (await admin.GetAsync("/api/auth/me")).Content.ReadAsStringAsync()).RootElement;
        Assert.True(me.GetProperty("hasRecoveryCode").GetBoolean());

        var recover = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword));
        Assert.Equal(HttpStatusCode.OK, recover.StatusCode);
    }

    [Fact]
    public async Task First_admin_response_includes_a_working_recovery_code()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();

        var created = await client.PostAsJsonAsync("/api/auth/first-admin",
            new { Username = TestCredentials.AdminUsername, Password = TestCredentials.StrongPassword });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var code = await ReadStringAsync(created, "recoveryCode");

        var recover = await factory.CreateClient().PostAsJsonAsync("/api/auth/recover",
            Recover(TestCredentials.AdminUsername, code, TestCredentials.StrongPassword));
        Assert.Equal(HttpStatusCode.OK, recover.StatusCode);
    }

    [Fact]
    public async Task Me_reports_no_recovery_code_for_an_admin_without_one()
    {
        await factory.ResetDatabaseAsync();
        var admin = await factory.CreateClientLoggedInAsync("Admin", TestCredentials.AdminUsername, TestCredentials.Password);

        var me = JsonDocument.Parse(await (await admin.GetAsync("/api/auth/me")).Content.ReadAsStringAsync()).RootElement;

        Assert.False(me.GetProperty("hasRecoveryCode").GetBoolean());
        Assert.Equal("Admin", me.GetProperty("role").GetString());
    }
}

// Own factory instance so the low limit never throttles the functional tests above.
public sealed class ThrottledRecoverAppFactory : PulseEdgeAppFactory
{
    protected override int LoginPermitLimit => 5;
}

[Collection("EdgeApi")]
public sealed class RecoverThrottleTests(ThrottledRecoverAppFactory factory) : IClassFixture<ThrottledRecoverAppFactory>
{
    [Fact]
    public async Task Repeated_recover_attempts_are_throttled_with_429()
    {
        await factory.ResetDatabaseAsync();
        var client = factory.CreateClient();
        var codes = new RecoveryCodeService(new PasswordService());

        HttpStatusCode last = HttpStatusCode.OK;
        for (var i = 0; i < 6; i++)
        {
            var response = await client.PostAsJsonAsync("/api/auth/recover", new
            {
                Username = TestCredentials.NonexistentUsername,
                RecoveryCode = codes.Generate(),
                NewPassword = TestCredentials.StrongPassword,
            });
            last = response.StatusCode;
        }

        Assert.Equal((HttpStatusCode)429, last);
    }
}
```

Add to the `Matrix` dictionary in `AuthorizationMatrixTests.cs` (next to the other `/api/auth/*` rows):

```csharp
        ["POST /api/auth/recover"] = Access.AnonymousReachable,       // {} body -> handler 400 (password rules), never 401/403
        ["POST /api/auth/recovery-code"] = Access.AdminMutation,      // handler IsInRole("Admin") -> ReadOnly 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter "FullyQualifiedName~PasswordRecoveryTests|FullyQualifiedName~RecoverThrottleTests|FullyQualifiedName~AuthorizationMatrixTests"`
Expected: FAIL — endpoints return 404/401; matrix completeness lists the two rows as dead.

- [ ] **Step 3: Middleware — let `/api/auth/recover` through anonymously, including after pairing**

In `CurrentUserValidationMiddleware`, add `"/api/auth/recover"` to `AnonymousApiPaths`:

```csharp
        "/api/auth/login", "/api/auth/setup-status", "/api/auth/first-admin", "/api/auth/recover",
```

and add one line to the post-setup exclusion chain, after the `/api/auth/setup-status` line:

```csharp
            !path.Equals("/api/auth/recover", StringComparison.OrdinalIgnoreCase) &&
```

- [ ] **Step 4: Endpoints**

In `AuthEndpoints.cs`:

(a) Replace the first-admin handler with:

```csharp
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
```

(b) Replace the `/api/auth/me` mapping with:

```csharp
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
```

(c) Add after the logout mapping:

```csharp
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
```

(d) Add the request records at the bottom of the file with the others:

```csharp
public record RecoverRequest(string? Username, string? RecoveryCode, string? NewPassword);
public record RegenerateRecoveryCodeRequest(string? CurrentPassword);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter "FullyQualifiedName~PasswordRecoveryTests|FullyQualifiedName~RecoverThrottleTests|FullyQualifiedName~AuthorizationMatrixTests|FullyQualifiedName~SessionRevocationTests"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Pulse.Edge.Api/Endpoints/AuthEndpoints.cs src/Pulse.Edge.Api/Security/CurrentUserValidationMiddleware.cs src/Pulse.Edge.Tests/Integration/AuthorizationMatrixTests.cs src/Pulse.Edge.Tests/Integration/PasswordRecoveryTests.cs
git commit -m "feat(auth): add admin recovery-code endpoints and first-admin code issuance"
```

---

### Task 5: `reset-password` console command

**Files:**
- Create: `src/Pulse.Edge.Api/Security/PasswordResetCommand.cs`
- Modify: `src/Pulse.Edge.Api/Program.cs` (dispatch right after the `using` directives; `return 0;` after the final `try/catch/finally`)
- Test: `src/Pulse.Edge.Tests/PasswordResetCommandTests.cs`

**Interfaces:**
- Consumes: `LocalUser.NewSecurityStamp()`, `PasswordService.Validate/Hash`, `QueueStorageService.InitializeAsync()`.
- Produces: `sealed record CommandIo(TextWriter Out, Func<string, string?> ReadSecret, bool Interactive, string OsUser)` with `static CommandIo FromSystemConsole()`; `static Task<int> PasswordResetCommand.RunAsync(string[] args, CommandIo io, Func<QueueDbContext> openDb, Func<Task> initialize)`.

- [ ] **Step 1: Write the failing tests**

```csharp
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Api.Security;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;
using Pulse.Edge.Tests.Integration;
using Xunit;

namespace Pulse.Edge.Tests;

public sealed class PasswordResetCommandTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"pulse-reset-cmd-{Guid.NewGuid():N}.db");
    private readonly StringWriter _out = new();
    private const string OldStamp = "old-stamp";

    public PasswordResetCommandTests()
    {
        using var db = OpenDb();
        db.Database.EnsureCreated();
        db.LocalUsers.Add(new LocalUser
        {
            Username = TestCredentials.AdminUsername, NormalizedUsername = TestCredentials.AdminUsername.ToUpperInvariant(),
            PasswordHash = new PasswordService().Hash(TestCredentials.Password), Role = "Admin",
            IsEnabled = false, FailedLoginCount = 5, LockoutEndUtc = DateTime.UtcNow.AddMinutes(15), SecurityStamp = OldStamp,
        });
        db.SaveChanges();
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        File.Delete(_dbPath);
    }

    private QueueDbContext OpenDb() => new(_dbPath);

    // args = the CLI arguments; secrets = the answers fed, in order, to each password prompt.
    private Task<int> RunAsync(bool interactive, string[] args, params string[] secrets)
    {
        var answers = new Queue<string>(secrets);
        var io = new CommandIo(_out, _ => answers.Count > 0 ? answers.Dequeue() : null, interactive, "tester");
        return PasswordResetCommand.RunAsync(args, io, OpenDb, () => Task.CompletedTask);
    }

    private async Task<LocalUser> LoadAdminAsync()
    {
        await using var db = OpenDb();
        return await db.LocalUsers.AsNoTracking().SingleAsync();
    }

    [Fact]
    public async Task List_prints_users_without_secrets()
    {
        var exit = await RunAsync(false, ["--list"]);

        Assert.Equal(0, exit);
        Assert.Contains(TestCredentials.AdminUsername, _out.ToString());
        Assert.Contains("Admin", _out.ToString());
        Assert.DoesNotContain("pbkdf2", _out.ToString());
    }

    [Fact]
    public async Task Piped_reset_sets_password_unlocks_enables_rotates_stamp_and_audits()
    {
        var exit = await RunAsync(false, ["--user", TestCredentials.AdminUsername], TestCredentials.StrongPassword, TestCredentials.StrongPassword);

        Assert.Equal(0, exit);
        var user = await LoadAdminAsync();
        Assert.True(new PasswordService().Verify(TestCredentials.StrongPassword, user.PasswordHash));
        Assert.True(user.IsEnabled);
        Assert.Equal(0, user.FailedLoginCount);
        Assert.Null(user.LockoutEndUtc);
        Assert.NotEqual(OldStamp, user.SecurityStamp);
        await using var db = OpenDb();
        var audit = await db.AuditEvents.AsNoTracking().SingleAsync();
        Assert.Equal("PasswordResetConsole", audit.EventType);
        Assert.Equal("console:tester", audit.ActorUsername);
        Assert.Equal("local-console", audit.RemoteIp);
    }

    [Fact]
    public async Task Username_lookup_is_case_insensitive()
    {
        var exit = await RunAsync(false, ["--user", TestCredentials.AdminUsername.ToUpperInvariant()], TestCredentials.StrongPassword, TestCredentials.StrongPassword);
        Assert.Equal(0, exit);
    }

    [Fact]
    public async Task Unknown_user_exits_2()
    {
        Assert.Equal(2, await RunAsync(false, ["--user", TestCredentials.NonexistentUsername]));
    }

    [Fact]
    public async Task Piped_mismatch_exits_3_without_reprompting_and_changes_nothing()
    {
        var exit = await RunAsync(false, ["--user", TestCredentials.AdminUsername], TestCredentials.StrongPassword, TestCredentials.StrongPassword + "x", TestCredentials.StrongPassword, TestCredentials.StrongPassword);

        Assert.Equal(3, exit);
        Assert.Equal(OldStamp, (await LoadAdminAsync()).SecurityStamp);
    }

    [Fact]
    public async Task Interactive_reprompts_after_a_weak_password()
    {
        var exit = await RunAsync(true, ["--user", TestCredentials.AdminUsername], "short", "short", TestCredentials.StrongPassword, TestCredentials.StrongPassword);

        Assert.Equal(0, exit);
        Assert.Contains("at least 10 characters", _out.ToString());
    }

    [Fact]
    public async Task Interactive_gives_up_after_three_failed_attempts()
    {
        var exit = await RunAsync(true, ["--user", TestCredentials.AdminUsername], "short", "short", "short", "short", "short", "short");
        Assert.Equal(3, exit);
    }

    [Fact]
    public async Task Bad_arguments_print_usage_and_exit_1()
    {
        Assert.Equal(1, await RunAsync(false, ["--bogus"]));
        Assert.Contains("reset-password --user <username>", _out.ToString());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~PasswordResetCommandTests`
Expected: build FAIL — `PasswordResetCommand` / `CommandIo` not defined.

- [ ] **Step 3: Implement the command**

```csharp
using System.Text;
using Microsoft.EntityFrameworkCore;
using Pulse.Edge.Storage;
using Pulse.Edge.Storage.Models;

namespace Pulse.Edge.Api.Security;

// Console I/O seam so the command is testable without a real terminal.
public sealed record CommandIo(TextWriter Out, Func<string, string?> ReadSecret, bool Interactive, string OsUser)
{
    public static CommandIo FromSystemConsole() => new(
        Console.Out,
        prompt =>
        {
            Console.Write(prompt);
            return Console.IsInputRedirected ? Console.ReadLine() : ReadMasked();
        },
        !Console.IsInputRedirected,
        Environment.UserName);

    // Reads a line without echoing it, printing '*' per character (Backspace supported).
    private static string ReadMasked()
    {
        var input = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) { Console.WriteLine(); return input.ToString(); }
            if (key.Key == ConsoleKey.Backspace)
            {
                if (input.Length > 0) { input.Length--; Console.Write("\b \b"); }
                continue;
            }
            if (!char.IsControl(key.KeyChar)) { input.Append(key.KeyChar); Console.Write('*'); }
        }
    }
}

// Local console password reset — spec 2026-10-06-edge-password-recovery-design §6. Anyone who can run
// the executable against the data directory may reset any user (accepted risk, Security Exception
// Register R-012). Deliberately not advertised in the UI.
public static class PasswordResetCommand
{
    private const string Usage = "Usage:\n  reset-password --list\n  reset-password --user <username>";

    public static async Task<int> RunAsync(string[] args, CommandIo io, Func<QueueDbContext> openDb, Func<Task> initialize)
    {
        try
        {
            await initialize();
            return args switch
            {
                ["--list"] => await ListAsync(io, openDb),
                ["--user", var username] => await ResetAsync(username, io, openDb),
                _ => PrintUsage(io),
            };
        }
        catch (Exception ex)
        {
            io.Out.WriteLine($"Cannot access the PULSE Edge database: {ex.Message}");
            return 1;
        }
    }

    private static int PrintUsage(CommandIo io)
    {
        io.Out.WriteLine(Usage);
        return 1;
    }

    private static async Task<int> ListAsync(CommandIo io, Func<QueueDbContext> openDb)
    {
        await using var db = openDb();
        var users = await db.LocalUsers.AsNoTracking().OrderBy(x => x.Username).ToListAsync();
        if (users.Count == 0)
        {
            io.Out.WriteLine("No users exist yet. Complete setup in the web UI.");
            return 0;
        }
        foreach (var u in users)
        {
            var locked = u.LockoutEndUtc > DateTime.UtcNow ? "locked" : "";
            io.Out.WriteLine($"{u.Username,-24} {u.Role,-9} {(u.IsEnabled ? "enabled" : "disabled"),-9} {locked}");
        }
        return 0;
    }

    private static async Task<int> ResetAsync(string username, CommandIo io, Func<QueueDbContext> openDb)
    {
        await using var db = openDb();
        var normalized = username.Trim().ToUpperInvariant();
        var user = await db.LocalUsers.FirstOrDefaultAsync(x => x.NormalizedUsername == normalized);
        if (user == null)
        {
            io.Out.WriteLine($"No user named '{username}'. Run 'reset-password --list' to see users.");
            return 2;
        }

        // Piped input gets exactly one try: re-prompting would consume lines meant for nothing.
        var attempts = io.Interactive ? 3 : 1;
        string? password = null;
        for (var i = 0; i < attempts && password == null; i++)
        {
            var first = io.ReadSecret("New password: ") ?? "";
            var confirm = io.ReadSecret("Confirm:      ") ?? "";
            if (first != confirm) { io.Out.WriteLine("Passwords do not match."); continue; }
            if (PasswordService.Validate(first) is { } error) { io.Out.WriteLine(error); continue; }
            password = first;
        }
        if (password == null) return 3;

        user.PasswordHash = new PasswordService().Hash(password);
        user.SecurityStamp = LocalUser.NewSecurityStamp();
        user.FailedLoginCount = 0;
        user.LockoutEndUtc = null;
        user.IsEnabled = true;
        user.UpdatedAtUtc = DateTime.UtcNow;
        db.AuditEvents.Add(new AuditEvent
        {
            EventType = "PasswordResetConsole", ActorUsername = $"console:{io.OsUser}", Target = user.Username,
            RemoteIp = "local-console", Succeeded = true,
        });
        await db.SaveChangesAsync();
        io.Out.WriteLine($"Password for '{user.Username}' updated. Account unlocked. Existing sessions signed out.");
        return 0;
    }
}
```

- [ ] **Step 4: Dispatch from `Program.cs`**

Immediately after the last `using` directive at the top of `src/Pulse.Edge.Api/Program.cs` (before the Serilog setup, so the command never writes to the service log files), insert:

```csharp
// `PulseEdge.Service.exe reset-password ...` — local console password reset. Runs and exits
// before the web host is built, so it is safe while the service itself is running.
if (args.Length > 0 && args[0] == "reset-password")
{
    return await PasswordResetCommand.RunAsync(args[1..], CommandIo.FromSystemConsole(),
        () => new QueueDbContext(), () => new QueueStorageService().InitializeAsync());
}
```

Because top-level statements now contain `return <int>`, add an explicit `return 0;` after the final `finally { Log.CloseAndFlush(); }` block (before `public partial class Program { }`).

- [ ] **Step 5: Run tests and a manual smoke**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~PasswordResetCommandTests`
Expected: PASS (8 tests).

Manual smoke against a scratch data dir (never the real device DB):

```bash
export PULSE_EDGE_DATA_DIR="$(mktemp -d)"
dotnet run --project src/Pulse.Edge.Api -- reset-password --list; echo "exit=$?"
dotnet run --project src/Pulse.Edge.Api -- reset-password --user nobody; echo "exit=$?"
unset PULSE_EDGE_DATA_DIR
```
Expected: `No users exist yet…` / `exit=0`, then `No user named 'nobody'…` / `exit=2`, and no Kestrel startup lines.

- [ ] **Step 6: Commit**

```bash
git add src/Pulse.Edge.Api/Security/PasswordResetCommand.cs src/Pulse.Edge.Api/Program.cs src/Pulse.Edge.Tests/PasswordResetCommandTests.cs
git commit -m "feat(auth): add reset-password console command"
```

---

### Task 6: UI — recovery-code component and forgot-password flow

**Invoke the `pulse` skill first.**

**Files:**
- Modify: `src/Pulse.Edge.UI/src/i18n/locales/en.ts`, `src/Pulse.Edge.UI/src/i18n/locales/th.ts` (new `recovery` block after `login`)
- Create: `src/Pulse.Edge.UI/src/components/RecoveryCodeDisplay.tsx`, `src/Pulse.Edge.UI/src/components/RecoveryCode.css`
- Create: `src/Pulse.Edge.UI/src/components/ForgotPasswordPanel.tsx`
- Modify: `src/Pulse.Edge.UI/src/components/LoginScreen.tsx`
- Test: `src/Pulse.Edge.UI/src/components/RecoveryCodeDisplay.test.tsx`, `src/Pulse.Edge.UI/src/components/ForgotPasswordPanel.test.tsx`, `src/Pulse.Edge.UI/src/components/LoginScreen.test.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/recover` (Task 4).
- Produces: `RecoveryCodeDisplay({ code: string; onDone: () => void; notice?: string })` (default export); `ForgotPasswordPanel({ onBack: () => void })` (default export); i18n keys under `recovery.*` (listed below — Task 7 uses `missingBanner`, `issuedOn`, `regenerate`, `currentPassword`, `generate`, `regenerateFailed`).

- [ ] **Step 1: Add i18n strings**

In `en.ts`, after the `login: { ... },` block:

```ts
  recovery: {
    forgotLink: 'Forgot password?',
    title: 'Recover access',
    askAdminTitle: 'Ask your administrator',
    askAdminBody: 'Another administrator can reset your password for you.',
    useCodeBtn: 'Use a recovery code',
    backToSignIn: 'Back to sign in',
    codeLabel: 'Recovery code',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    passwordRules: '10+ characters with upper-case, lower-case, number, and special character.',
    mismatch: 'Passwords do not match.',
    submit: 'Reset password',
    submitting: 'Resetting…',
    failed: 'Recovery failed.',
    saveTitle: 'Save your recovery code',
    saveBody: 'This code lets you reset your administrator password if you forget it. It is shown only once — store it somewhere safe, away from this device.',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download .txt',
    savedCheckbox: 'I have saved this code',
    continue: 'Continue',
    successNotice: 'Password reset. Your old recovery code no longer works — save this new one.',
    missingBanner: 'You have no recovery code. Generate one so you can recover access if you forget your password.',
    issuedOn: 'Recovery code issued {{date}}.',
    regenerate: 'Regenerate my recovery code',
    currentPassword: 'Current password',
    generate: 'Generate code',
    regenerateFailed: 'Could not generate a recovery code.',
  },
```

In `th.ts`, the same keys:

```ts
  recovery: {
    forgotLink: 'ลืมรหัสผ่าน?',
    title: 'กู้คืนการเข้าใช้งาน',
    askAdminTitle: 'ติดต่อผู้ดูแลระบบ',
    askAdminBody: 'ผู้ดูแลระบบคนอื่นสามารถรีเซ็ตรหัสผ่านให้คุณได้',
    useCodeBtn: 'ใช้รหัสกู้คืน',
    backToSignIn: 'กลับไปหน้าเข้าสู่ระบบ',
    codeLabel: 'รหัสกู้คืน (Recovery code)',
    newPassword: 'รหัสผ่านใหม่',
    confirmPassword: 'ยืนยันรหัสผ่านใหม่',
    passwordRules: 'อย่างน้อย 10 ตัวอักษร ประกอบด้วยตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ',
    mismatch: 'รหัสผ่านไม่ตรงกัน',
    submit: 'รีเซ็ตรหัสผ่าน',
    submitting: 'กำลังรีเซ็ต…',
    failed: 'กู้คืนไม่สำเร็จ',
    saveTitle: 'บันทึกรหัสกู้คืนของคุณ',
    saveBody: 'รหัสนี้ใช้รีเซ็ตรหัสผ่านผู้ดูแลระบบเมื่อคุณลืม และจะแสดงเพียงครั้งเดียว — เก็บไว้ในที่ปลอดภัย แยกจากเครื่องนี้',
    copy: 'คัดลอก',
    copied: 'คัดลอกแล้ว',
    download: 'ดาวน์โหลด .txt',
    savedCheckbox: 'ฉันบันทึกรหัสนี้แล้ว',
    continue: 'ดำเนินการต่อ',
    successNotice: 'รีเซ็ตรหัสผ่านแล้ว รหัสกู้คืนเดิมใช้ไม่ได้อีก — กรุณาบันทึกรหัสใหม่นี้',
    missingBanner: 'คุณยังไม่มีรหัสกู้คืน สร้างไว้เพื่อใช้กู้คืนการเข้าใช้งานเมื่อลืมรหัสผ่าน',
    issuedOn: 'ออกรหัสกู้คืนเมื่อ {{date}}',
    regenerate: 'สร้างรหัสกู้คืนใหม่',
    currentPassword: 'รหัสผ่านปัจจุบัน',
    generate: 'สร้างรหัส',
    regenerateFailed: 'ไม่สามารถสร้างรหัสกู้คืนได้',
  },
```

- [ ] **Step 2: Write the failing tests**

`RecoveryCodeDisplay.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';

const sampleCode = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'].join('-');

describe('RecoveryCodeDisplay', () => {
  it('shows the code and only enables Continue once the user confirms saving it', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<RecoveryCodeDisplay code={sampleCode} onDone={onDone} />);

    expect(screen.getByTestId('recovery-code')).toHaveTextContent(sampleCode);
    const proceed = screen.getByRole('button', { name: /continue/i });
    expect(proceed).toBeDisabled();

    await user.click(screen.getByLabelText(/i have saved this code/i));
    await user.click(proceed);

    expect(onDone).toHaveBeenCalledOnce();
  });
});
```

`ForgotPasswordPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPasswordPanel from './ForgotPasswordPanel';
import { jsonResponse } from '../test/http';
import { testCredentials } from '../test/credentials';

const newCode = ['NNNN', 'EEEE', 'WWWW', 'CCCC', 'DDDD'].join('-');
const oldCode = ['OOOO', 'LLLL', 'DDDD', 'CCCC', 'XXXX'].join('-');

async function fillRecoveryForm(confirm = testCredentials.adminPassword) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /use a recovery code/i }));
  await user.type(screen.getByLabelText('Username'), testCredentials.adminUsername);
  await user.type(screen.getByLabelText('Recovery code'), oldCode);
  await user.type(screen.getByLabelText('New password'), testCredentials.adminPassword);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
  return user;
}

describe('ForgotPasswordPanel', () => {
  it('tells non-admins to ask their administrator', () => {
    render(<ForgotPasswordPanel onBack={vi.fn()} />);
    expect(screen.getByText(/another administrator can reset your password/i)).toBeInTheDocument();
  });

  it('submits the recovery form and shows the newly issued code', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { recoveryCode: newCode }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPanel onBack={vi.fn()} />);

    await fillRecoveryForm();

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent(newCode);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/recover', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toEqual({ username: testCredentials.adminUsername, recoveryCode: oldCode, newPassword: testCredentials.adminPassword });
  });

  it('shows the server error on a rejected code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'Invalid username or recovery code.' })));
    render(<ForgotPasswordPanel onBack={vi.fn()} />);

    await fillRecoveryForm();

    expect(await screen.findByText('Invalid username or recovery code.')).toBeInTheDocument();
  });

  it('blocks submission when the passwords differ', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPanel onBack={vi.fn()} />);

    await fillRecoveryForm(testCredentials.adminPassword + 'x');

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Append to `LoginScreen.test.tsx` inside the `describe('LoginScreen', ...)` block:

```tsx
  it('opens the forgot-password panel and returns to sign in', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.getByRole('button', { name: /use a recovery code/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from repo root): `cd src/Pulse.Edge.UI && npx vitest run RecoveryCodeDisplay ForgotPasswordPanel LoginScreen`
Expected: FAIL — modules not found / forgot button missing.

- [ ] **Step 4: Implement `RecoveryCodeDisplay` + CSS**

`RecoveryCode.css` (follow the `pulse` skill tokens; these match the existing auth styles in `index.css`):

```css
.recovery-code-panel { text-align: left; }
.recovery-notice { margin: 0 0 12px; font-size: 13px; color: var(--text-secondary); }
.recovery-code { display: block; margin: 4px 0 12px; padding: 14px; border: 1px dashed var(--border-color); border-radius: 8px; font-family: var(--font-mono); font-size: 18px; letter-spacing: 1px; text-align: center; user-select: all; overflow-wrap: anywhere; }
.recovery-code-actions { display: flex; gap: 8px; margin-bottom: 12px; }
.recovery-code-actions .onboarding-btn { flex: 1; justify-content: center; }
.recovery-saved-check { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; }
.recovery-link { margin-top: 12px; border: 0; background: none; padding: 0; color: var(--primary-color); font: inherit; font-size: 13px; cursor: pointer; }
.recovery-banner { margin: 0 0 12px; padding: 9px 11px; border: 1px solid var(--warn); border-radius: 6px; font-size: 13px; }
```

`RecoveryCodeDisplay.tsx`:

```tsx
import { useState } from 'react';
import { ArrowRight, Copy, Download, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './RecoveryCode.css';

type Props = { code: string; onDone: () => void; notice?: string };

export default function RecoveryCodeDisplay({ code, onDone, notice }: Props) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (permissions/insecure context); the code stays visible and downloadable.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`PULSE Edge recovery code\n${code}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pulse-edge-recovery-code.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="recovery-code-panel">
    <div className="first-admin-heading"><KeyRound size={18} /><div><strong>{t('recovery.saveTitle')}</strong><span>{t('recovery.saveBody')}</span></div></div>
    {notice && <p className="recovery-notice">{notice}</p>}
    <code className="recovery-code" data-testid="recovery-code">{code}</code>
    <div className="recovery-code-actions">
      <button type="button" className="onboarding-btn onboarding-btn-action-back" onClick={() => void copy()}><Copy size={15} /> {copied ? t('recovery.copied') : t('recovery.copy')}</button>
      <button type="button" className="onboarding-btn onboarding-btn-action-back" onClick={download}><Download size={15} /> {t('recovery.download')}</button>
    </div>
    <label className="recovery-saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> {t('recovery.savedCheckbox')}</label>
    <button type="button" className="onboarding-btn onboarding-btn-primary" style={{ width: '100%' }} disabled={!saved} onClick={onDone}>{t('recovery.continue')} <ArrowRight size={16} /></button>
  </div>;
}
```

- [ ] **Step 5: Implement `ForgotPasswordPanel`**

```tsx
import { useState } from 'react';
import { ArrowLeft, KeyRound, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';
import './RecoveryCode.css';

type Mode = 'choose' | 'recover' | 'saved';

export default function ForgotPasswordPanel({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('choose');
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState('');

  if (mode === 'saved') {
    return <RecoveryCodeDisplay code={issuedCode} notice={t('recovery.successNotice')} onDone={onBack} />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) { setError(t('recovery.mismatch')); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, recoveryCode, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || t('recovery.failed')); return; }
      setIssuedCode(data.recoveryCode);
      setMode('saved');
    } catch {
      setError(t('recovery.failed'));
    } finally {
      setBusy(false);
    }
  };

  return <div className="recovery-code-panel">
    <h1>{t('recovery.title')}</h1>
    {mode === 'choose' ? <>
      <div className="first-admin-heading"><UserCog size={18} /><div><strong>{t('recovery.askAdminTitle')}</strong><span>{t('recovery.askAdminBody')}</span></div></div>
      <button type="button" className="onboarding-btn onboarding-btn-primary" style={{ width: '100%' }} onClick={() => setMode('recover')}><KeyRound size={16} /> {t('recovery.useCodeBtn')}</button>
    </> : <form onSubmit={e => void submit(e)}>
      <label className="form-label" htmlFor="recover-username">{t('login.username')}</label>
      <input id="recover-username" className="form-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required />
      <label className="form-label auth-password-label" htmlFor="recover-code">{t('recovery.codeLabel')}</label>
      <input id="recover-code" className="form-input" autoComplete="off" spellCheck={false} value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} required />
      <label className="form-label auth-password-label" htmlFor="recover-new">{t('recovery.newPassword')}</label>
      <input id="recover-new" className="form-input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
      <label className="form-label auth-password-label" htmlFor="recover-confirm">{t('recovery.confirmPassword')}</label>
      <input id="recover-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
      <small className="onboarding-input-tip">{t('recovery.passwordRules')}</small>
      {error && <div className="auth-error">{error}</div>}
      <button className="onboarding-btn onboarding-btn-primary auth-submit" disabled={busy}>{busy ? t('recovery.submitting') : t('recovery.submit')}</button>
    </form>}
    <button type="button" className="recovery-link" onClick={onBack}><ArrowLeft size={13} /> {t('recovery.backToSignIn')}</button>
  </div>;
}
```

> The `Username` label reuses `login.username`; in tests the English value is `Username`, matching `getByLabelText('Username')`.

- [ ] **Step 6: Wire into `LoginScreen`**

In `LoginScreen.tsx`: import `ForgotPasswordPanel from './ForgotPasswordPanel'` and `'./RecoveryCode.css'`, add `const [forgot, setForgot] = useState(false);`, and replace everything from `<h1>{t('login.title')}</h1>` through the closing `</form>` with:

```tsx
      {forgot ? <ForgotPasswordPanel onBack={() => setForgot(false)} /> : <>
        <h1>{t('login.title')}</h1>
        <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const result = await login(username, password); setError(result || ''); setBusy(false); }}>
          <label className="form-label" htmlFor="login-username">{t('login.username')}</label>
          <input id="login-username" className="form-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
          <label className="form-label auth-password-label" htmlFor="login-password">{t('login.password')}</label>
          <input id="login-password" className="form-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div className="auth-error">{error}</div>}
          <button className="onboarding-btn onboarding-btn-primary auth-submit" disabled={busy}>{busy ? t('login.signingIn') : <>{t('login.signInBtn')} <LogIn size={17} /></>}</button>
        </form>
        <button type="button" className="recovery-link" onClick={() => setForgot(true)}>{t('recovery.forgotLink')}</button>
      </>}
```

- [ ] **Step 7: Run tests, lint, and build**

Run: `cd src/Pulse.Edge.UI && npx vitest run RecoveryCodeDisplay ForgotPasswordPanel LoginScreen` → PASS.
Run (repo root): `pnpm lint:ui && pnpm build:ui` → zero errors, build succeeds (also proves `th.ts` matches `typeof en`).

- [ ] **Step 8: Commit**

```bash
git add src/Pulse.Edge.UI/src/i18n/locales/en.ts src/Pulse.Edge.UI/src/i18n/locales/th.ts src/Pulse.Edge.UI/src/components/RecoveryCodeDisplay.tsx src/Pulse.Edge.UI/src/components/RecoveryCode.css src/Pulse.Edge.UI/src/components/ForgotPasswordPanel.tsx src/Pulse.Edge.UI/src/components/LoginScreen.tsx src/Pulse.Edge.UI/src/components/*.test.tsx
git commit -m "feat(ui): add forgot-password flow with recovery code"
```

---

### Task 7: UI — first-admin code step and self-service regenerate

**Invoke the `pulse` skill first.**

**Files:**
- Modify: `src/Pulse.Edge.UI/src/context/auth.ts`, `src/Pulse.Edge.UI/src/context/AuthContext.tsx`
- Modify: `src/Pulse.Edge.UI/src/components/OnboardingWizard.tsx` (both first-admin forms, ~lines 546–569 and ~732–760)
- Create: `src/Pulse.Edge.UI/src/components/MyRecoveryCode.tsx`
- Modify: `src/Pulse.Edge.UI/src/components/UserManagement.tsx`
- Modify: `src/Pulse.Edge.UI/src/components/LoginScreen.test.tsx` (mock shape)
- Test: `src/Pulse.Edge.UI/src/context/AuthContext.test.tsx`, `src/Pulse.Edge.UI/src/components/MyRecoveryCode.test.tsx`

**Interfaces:**
- Consumes: `RecoveryCodeDisplay` and `recovery.*` keys (Task 6); `POST /api/auth/first-admin` `recoveryCode`, `GET /api/auth/me`, `POST /api/auth/recovery-code` (Task 4).
- Produces: `createFirstAdmin: (username: string, password: string) => Promise<{ error: string | null; recoveryCode: string | null }>`; `MyRecoveryCode()` (default export).

- [ ] **Step 1: Write the failing tests**

Append to `AuthContext.test.tsx` (reuses its `stubFetch`):

```tsx
function FirstAdminConsumer() {
  const { createFirstAdmin } = useAuth();
  const [result, setResult] = useState('unset');
  return <div>
    <span data-testid="result">{result}</span>
    <button onClick={async () => setResult(JSON.stringify(await createFirstAdmin(testCredentials.adminUsername, testCredentials.adminPassword)))}>create</button>
  </div>;
}

describe('createFirstAdmin', () => {
  it('returns the recovery code issued with the first admin', async () => {
    const issued = ['FFFF', 'IIII', 'RRRR', 'SSSS', 'TTTT'].join('-');
    stubFetch({
      'GET /api/auth/setup-status': () => jsonResponse(200, { state: 'NeedsFirstAdmin', user: null }),
      'POST /api/auth/first-admin': () => jsonResponse(200, { recoveryCode: issued }),
    });
    const user = userEvent.setup();
    render(<AuthProvider><FirstAdminConsumer /></AuthProvider>);

    await user.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent(JSON.stringify({ error: null, recoveryCode: issued })));
  });
});
```

`MyRecoveryCode.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyRecoveryCode from './MyRecoveryCode';
import { jsonResponse } from '../test/http';
import { testCredentials } from '../test/credentials';

const issued = ['RRRR', 'EEEE', 'GGGG', 'EEEE', 'NNNN'].join('-');

describe('MyRecoveryCode', () => {
  it('warns an admin without a code and lets them generate one', async () => {
    const fetchMock = vi.fn(async (url: string) => url === '/api/auth/me'
      ? jsonResponse(200, { role: 'Admin', hasRecoveryCode: false, recoveryCodeCreatedAtUtc: null })
      : jsonResponse(200, { recoveryCode: issued }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<MyRecoveryCode />);

    expect(await screen.findByText(/you have no recovery code/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /regenerate my recovery code/i }));
    await user.type(screen.getByLabelText('Current password'), testCredentials.adminPassword);
    await user.click(screen.getByRole('button', { name: /generate code/i }));

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent(issued);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/recovery-code', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the server error for a wrong current password', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
      ? jsonResponse(200, { role: 'Admin', hasRecoveryCode: true, recoveryCodeCreatedAtUtc: '2026-10-01T00:00:00Z' })
      : jsonResponse(400, { error: 'Current password is incorrect.' })));
    const user = userEvent.setup();
    render(<MyRecoveryCode />);

    await user.click(await screen.findByRole('button', { name: /regenerate my recovery code/i }));
    await user.type(screen.getByLabelText('Current password'), testCredentials.adminPassword);
    await user.click(screen.getByRole('button', { name: /generate code/i }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/Pulse.Edge.UI && npx vitest run AuthContext MyRecoveryCode`
Expected: FAIL — `createFirstAdmin` returns `null`; `MyRecoveryCode` missing.

- [ ] **Step 3: Change `createFirstAdmin` to return the code**

In `auth.ts`, change the type:

```ts
  createFirstAdmin: (username: string, password: string) => Promise<{ error: string | null; recoveryCode: string | null }>;
```

In `AuthContext.tsx`, add next to `submit`:

```tsx
  const createFirstAdmin = async (username: string, password: string) => {
    const res = await fetch('/api/auth/first-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'Authentication failed.', recoveryCode: null };
    await refresh();
    return { error: null, recoveryCode: data.recoveryCode ?? null };
  };
```

and in the provider value replace `createFirstAdmin: (u, p) => submit('/api/auth/first-admin', u, p)` with `createFirstAdmin`.

In `LoginScreen.test.tsx`'s `renderLogin`, change the mock to `createFirstAdmin: vi.fn(async () => ({ error: null, recoveryCode: null })),`.

- [ ] **Step 4: Onboarding — show the code before entering the dashboard**

In `OnboardingWizard.tsx`:
- import `RecoveryCodeDisplay from './RecoveryCodeDisplay'`;
- add state `const [firstAdminCode, setFirstAdminCode] = useState<string | null>(null);`;
- in **both** first-admin `onSubmit` handlers replace

```tsx
                        const error = await createFirstAdmin(adminUsername, adminPassword);
                        setIsSubmitting(false);
                        if (error) setAdminError(error); else onComplete();
```
with
```tsx
                        const result = await createFirstAdmin(adminUsername, adminPassword);
                        setIsSubmitting(false);
                        if (result.error) setAdminError(result.error);
                        else if (result.recoveryCode) setFirstAdminCode(result.recoveryCode);
                        else onComplete();
```
- at **both** sites, wrap the `requireFirstAdmin ? (<form …>) : (…)` conditional so the code screen wins once issued (after the first admin exists, `requireFirstAdmin` flips to false because `refresh()` loaded the user — the code screen must still show):

```tsx
                    {firstAdminCode ? (
                      <RecoveryCodeDisplay code={firstAdminCode} onDone={onComplete} />
                    ) : requireFirstAdmin ? (
                      /* …existing form unchanged… */
                    ) : (
                      /* …existing Enter Dashboard button unchanged… */
                    )}
```

For the second site (inside `pairingData.cloudStatus !== 'Connected' && pairingData.cloudStatus !== 'Revoked' && (…)`), apply the same three-way conditional inside those parentheses.

- [ ] **Step 5: Implement `MyRecoveryCode` and mount it**

```tsx
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';
import './RecoveryCode.css';

type Me = { role: string; hasRecoveryCode: boolean; recoveryCodeCreatedAtUtc: string | null };

export default function MyRecoveryCode() {
  const { t } = useTranslation();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch('/api/auth/me');
    if (res.ok) setMe(await res.json());
  };
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() as Promise<Me> : null)
      .then(data => { if (active) setMe(data); });
    return () => { active = false; };
  }, []);

  if (!me || me.role !== 'Admin') return null;
  if (issued) return <RecoveryCodeDisplay code={issued} onDone={() => { setIssued(null); setOpen(false); setCurrentPassword(''); void load(); }} />;

  const generate = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    const res = await fetch('/api/auth/recovery-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || t('recovery.regenerateFailed')); return; }
    setIssued(data.recoveryCode);
  };

  return <div className="recovery-code-panel">
    {me.hasRecoveryCode
      ? me.recoveryCodeCreatedAtUtc && <p className="recovery-notice">{t('recovery.issuedOn', { date: new Date(me.recoveryCodeCreatedAtUtc).toLocaleDateString() })}</p>
      : <p className="recovery-banner">{t('recovery.missingBanner')}</p>}
    {!open
      ? <button type="button" className="btn-primary" onClick={() => setOpen(true)}><KeyRound size={15} /> {t('recovery.regenerate')}</button>
      : <form className="user-create-row" onSubmit={e => void generate(e)}>
        <label className="form-label" htmlFor="current-password">{t('recovery.currentPassword')}</label>
        <input id="current-password" className="form-input" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
        <button className="btn-primary">{t('recovery.generate')}</button>
      </form>}
    {error && <div className="auth-error">{error}</div>}
  </div>;
}
```

In `UserManagement.tsx`: `import MyRecoveryCode from './MyRecoveryCode';` and render `<MyRecoveryCode />` directly after the `<p className="text-secondary user-management-copy">…</p>` line.

- [ ] **Step 6: Run the UI suite, lint, build**

Run (repo root): `pnpm test:ui && pnpm lint:ui && pnpm build:ui`
Expected: all vitest files PASS, zero lint errors, build succeeds.

- [ ] **Step 7: Manual check in the running app**

Run `./start-edge.sh` against a scratch data dir (`PULSE_EDGE_DATA_DIR=$(mktemp -d) ./start-edge.sh`), open `http://localhost:8080`, and verify: onboarding shows the code after creating the admin and Continue is gated by the checkbox; Settings → Local Access shows the issued date and regenerates; sign out → "Forgot password?" → recovery with the saved code works and shows a new code; a wrong code shows the generic error. Check both EN and TH.

- [ ] **Step 8: Commit**

```bash
git add src/Pulse.Edge.UI/src/context/auth.ts src/Pulse.Edge.UI/src/context/AuthContext.tsx src/Pulse.Edge.UI/src/context/AuthContext.test.tsx src/Pulse.Edge.UI/src/components/OnboardingWizard.tsx src/Pulse.Edge.UI/src/components/MyRecoveryCode.tsx src/Pulse.Edge.UI/src/components/MyRecoveryCode.test.tsx src/Pulse.Edge.UI/src/components/UserManagement.tsx src/Pulse.Edge.UI/src/components/LoginScreen.test.tsx
git commit -m "feat(ui): show recovery code at first-admin setup and allow regeneration"
```

---

### Task 8: Documentation, risk register, full verification

**Files:**
- Modify: `docs/PULSE_Edge_Local_Authentication_Spec.md`
- Modify: `docs/PULSE_Edge_Security_Exception_Register.md`
- Modify: `docs/PULSE_Edge_Production_Readiness_Roadmap.md` (Decision and risk log table at ~line 461; Follow-up dashboard)

- [ ] **Step 1: Auth spec** — add a `## Password recovery` section after `## Reset behavior` covering, in prose: admin-only recovery codes (format, shown once at first-admin and on regenerate, single use, consumed on recovery, cleared on demotion); `POST /api/auth/recover` (anonymous, `login` rate limit, generic 401, clears lockout, does not re-enable disabled accounts); `POST /api/auth/recovery-code` (admin, current password); session revocation via `pulse:stamp` on reset/recovery/disable/role change; and a `### Console reset (runbook)` subsection with the Windows steps verbatim from spec §6.3, the Linux equivalent, and the exit-code table (`0` success, `1` database/usage error, `2` unknown user, `3` password rules/confirmation).

- [ ] **Step 2: Exception register** — append a row:

```markdown
| R-012 | 2026-10-06 | Local console `reset-password` command has no OS elevation check, and the Windows installer grants `users-modify` on `C:\ProgramData\PULSE Edge` | Dominant field failure is staff forgetting access to a rarely touched appliance; recovery must stay low-friction. The box sits on the plant floor / OT network, and local OS logon already implies trust. The command is not advertised in the UI | Any locally logged-in OS user can reset any Edge password (or edit `edge.db` directly) — local OS access ⇒ Edge admin access | Customer or regulatory requirement for separation between OS users and Edge administrators |
```

- [ ] **Step 3: Roadmap** — add to the Decision and risk log table:

```markdown
| R-012 | 2026-10-06 | Decision | Password recovery: admin recovery codes + local `reset-password` console command; password resets now revoke sessions (security stamp). Console path accepts local-OS-access ⇒ Edge-admin (see Security Exception Register R-012). Spec: `docs/superpowers/specs/2026-10-06-edge-password-recovery-design.md`. | Engineering | 2026-10-06 | Accepted |
```

In the Follow-up dashboard, note under the G1 auth test-coverage item that recovery/session-revocation tests were added, with evidence pending the CI run (do **not** tick the gate item — evidence must exist first).

- [ ] **Step 4: Full verification (the CI gate, locally)**

```bash
dotnet restore Pulse.Edge.slnx --locked-mode
dotnet build Pulse.Edge.slnx --warnaserror
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj
dotnet list Pulse.Edge.slnx package --vulnerable --include-transitive
pnpm lint:ui && pnpm build:ui && pnpm test:ui
```
Expected: restore OK (no package changes were made), build clean, all tests pass, no vulnerable packages, lint zero errors, UI build and tests pass.

- [ ] **Step 5: Commit**

```bash
git add docs/PULSE_Edge_Local_Authentication_Spec.md docs/PULSE_Edge_Security_Exception_Register.md docs/PULSE_Edge_Production_Readiness_Roadmap.md
git commit -m "docs(auth): document password recovery, console reset runbook, and R-012"
```

After CI passes on the PR, save the run link under `docs/readiness-evidence/` and update the roadmap follow-up in a final commit.
