# PULSE Edge — Password Recovery Design

**Date:** 2026-10-06
**Status:** Approved design, pending implementation plan
**Related:** `docs/PULSE_Edge_Local_Authentication_Spec.md`, `docs/PULSE_Edge_Security_Exception_Register.md`

## 1. Problem

Edge uses local cookie auth with no email or external identity provider. Today:

- A forgotten **non-admin** (or second-admin) password is recoverable: an Admin resets it via `PUT /api/users/{id}`.
- A forgotten password on the **only admin** has no recovery path except **factory reset**, which deletes users, configuration, and audit history.

Field reality: Edge boxes are commissioned once and rarely touched afterwards, so forgetting the admin password is the *expected* failure, not an edge case. Plants are often offline / on isolated OT networks, so recovery must work **without internet or email**.

## 2. Goals and non-goals

**Goals**
- A locked-out admin can regain access without a factory reset and without network access beyond the local LAN.
- Recovery never silently leaves an old session alive (a reset must end existing logins).
- Every recovery/reset is audited.

**Non-goals (out of scope)**
- Cloud-assisted reset via PULSE Cloud.
- Email / SMTP reset links.
- Recovery codes for ReadOnly users (an admin resets them).
- Tightening the Windows data-folder ACL, an elevation check in the console command, or a Start Menu reset shortcut — deliberately rejected (see §8).

## 3. Recovery paths (summary)

| Who forgot | Path |
|---|---|
| Any user, while another admin can log in | Existing admin reset (`PUT /api/users/{id}`); login page tells the user to ask their administrator |
| An admin who has their recovery code | Login page → "Forgot password?" → "Use a recovery code" (§5) |
| Anyone with access to the box's OS console | `reset-password` console command (§6) |

## 4. Data model changes (`LocalUser`)

| Column | Type | Default | Purpose |
|---|---|---|---|
| `SecurityStamp` | TEXT NOT NULL | `''` (backfilled at startup) | Random value embedded in the auth cookie; rotated to revoke sessions |
| `RecoveryCodeHash` | TEXT NOT NULL | `''` | PBKDF2 hash of the admin's current recovery code; empty = no code |
| `RecoveryCodeCreatedAtUtc` | TEXT NULL | `NULL` | When the current code was issued |

Applied in `QueueStorageService.InitializeAsync` with the existing idempotent `ALTER TABLE ... ADD COLUMN` pattern (`PRAGMA table_info` check first). After the columns exist, any user with an empty `SecurityStamp` gets a fresh random stamp.

**Upgrade consequence (accepted):** cookies issued before the upgrade carry no stamp claim, so every user is signed out once after upgrading.

## 5. Recovery code

### 5.1 Format and storage
- 20 characters from Crockford Base32 (no `0/O`, `1/I/L`, `U`), generated with `RandomNumberGenerator`, displayed as 5 groups of 4: `K7QM-3XHD-9PRT-W2NF-6BJC` (~100 bits of entropy).
- Input is normalized before verification: uppercased, dashes/whitespace removed, Crockford look-alikes mapped (`O→0`, `I/L→1`).
- Stored only as a hash via `PasswordService.Hash` (PBKDF2-SHA256). The plaintext is shown exactly once and never logged.
- A small `RecoveryCodeService` (in `Pulse.Edge.Api/Security/`) owns generate / normalize / hash / verify.

### 5.2 Issuance
- **First admin:** `POST /api/auth/first-admin` generates a code and returns it in the response (`recoveryCode` field). The onboarding UI shows it on a dedicated step with Copy and Download (.txt) buttons and an "I have saved this code" checkbox that gates Continue.
- **Regenerate own code:** `POST /api/auth/recovery-code` — authenticated, Admin role only, body `{ currentPassword }`. Verifies the current password, replaces the hash, returns the new plaintext once. Audit `RecoveryCodeRegenerated`.
- **Status:** `GET /api/auth/me` gains `hasRecoveryCode` (bool) and `recoveryCodeCreatedAtUtc` for admins. Admins without a code see a reminder banner in User Management.
- Demoting an admin to ReadOnly clears their recovery code.

### 5.3 `POST /api/auth/recover`
Anonymous. Body `{ username, recoveryCode, newPassword }`.

- Rate limited with the existing `login` policy.
- Added to `CurrentUserValidationMiddleware.AnonymousApiPaths` **and** to its post-setup exclusion list (alongside `/api/auth/login`), so it stays reachable after the device is paired.
- Validates `newPassword` with `PasswordService.Validate` first (400 with the rule message on failure — this reveals nothing about accounts).
- Looks up the user. If the user is missing, not an Admin, disabled, or has no code, it still runs one PBKDF2 verify against a fixed dummy hash so timing does not reveal account existence, then fails.
- Any failure → `401 { error: "Invalid username or recovery code." }` + audit `PasswordRecovered` with `Succeeded=false`.
- Success:
  - set the new password hash;
  - rotate `SecurityStamp` (ends all existing sessions for that user);
  - clear `FailedLoginCount` and `LockoutEndUtc` (an active lockout does **not** block recovery);
  - consume the code and issue a new one (single use);
  - audit `PasswordRecovered` `Succeeded=true`;
  - respond `200 { recoveryCode: "<new code>" }`. The user is **not** auto-signed-in; they log in normally after saving the new code.
- A disabled account is never re-enabled by this path.

## 6. Console reset command

### 6.1 Invocation
The API executable (`Pulse.Edge.Api`; installed on Windows as `C:\Program Files\PULSE Edge\PulseEdge.Service.exe`):

```
PulseEdge.Service.exe reset-password --list
PulseEdge.Service.exe reset-password --user <username>
```

`Program.cs` checks `args` **before** building the web host. If `args[0] == "reset-password"`, it runs `PasswordResetCommand` (new class in `Pulse.Edge.Api/Security/`), returns its exit code, and never starts Kestrel. It uses the same `QueueDbContext` path resolution (`PULSE_EDGE_DATA_DIR` override, else ProgramData / platform default), so it targets the same `edge.db` as the running service. It calls `QueueStorageService.InitializeAsync()` first so the new columns exist. Running while the service is up is safe (SQLite locking); no service restart is needed afterwards because login reads users from the database.

### 6.2 Behavior
- `--list`: prints username, role, enabled, locked-out status. No secrets.
- `--user <name>`: case-insensitive lookup; unknown user → message + exit code 2.
  - Interactive console: prompts `New password:` and `Confirm:` with masked input (no echo). Mismatch or `PasswordService.Validate` failure → message, re-prompt (max 3 attempts, then exit code 3).
  - Redirected stdin (scripting): reads two lines from stdin as password and confirmation, no re-prompt.
  - On success: set hash, rotate `SecurityStamp`, clear lockout, **set `IsEnabled = true`**, audit `PasswordResetConsole` with actor `console:<OS username>` and `RemoteIp = "local-console"`. Prints `Password for '<user>' updated. Account unlocked. Existing sessions signed out.` Exit code 0.
- Works for any role. No OS elevation check (see §8).
- Not advertised in the UI; documented in the runbook / auth spec only.

### 6.3 Windows operator procedure (runbook text)
1. At the PC (or via Remote Desktop), open **Command Prompt**.
2. `cd "C:\Program Files\PULSE Edge"`
3. `PulseEdge.Service.exe reset-password --list`
4. `PulseEdge.Service.exe reset-password --user <username>` and enter the new password twice.
5. Log in to the dashboard with the new password.

Linux (`.deb`) equivalent uses the installed binary path with the same arguments, run as a user that can write the data directory.

## 7. Session hardening (SecurityStamp)

- `SignIn` adds claim `pulse:stamp` = current `SecurityStamp`.
- `CurrentUserValidationMiddleware` (which already loads the user per request) additionally rejects the session — sign out + 401 — when the claim is missing or differs from the stored stamp.
- Stamp rotation happens on: recovery (§5.3), console reset (§6), admin password change via `PUT /api/users/{id}`, disabling a user, and role change. Recovery-code regeneration does **not** rotate it.
- If an admin changes **their own** password via `PUT /api/users/{id}`, the endpoint re-issues their cookie with the new stamp so they are not signed out.

## 8. Accepted risk (to add to Security Exception Register)

The Windows installer grants `users-modify` on `C:\ProgramData\PULSE Edge` (`PulseEdge.iss`), and the console command performs no elevation check. Any locally logged-in Windows user can therefore reset an Edge password (or edit `edge.db` directly).

**Rationale:** the dominant field failure is staff forgetting access to a rarely touched appliance; recovery must stay low-friction. The box sits on the plant floor/OT network, and local OS logon already implies trust. The command is undocumented in the UI, so it is not discoverable by casual users.
**Accepted consequence:** local OS access ⇒ Edge admin access.
**Review trigger:** a customer/regulatory requirement for separation between OS users and Edge admins.

New register entry: next free `R-0xx` ID, mirrored in the roadmap Decision and risk log.

## 9. UI (PULSE design system; EN + TH strings)

- **Login screen:** "Forgot password?" link → panel with two options:
  1. "Ask your administrator to reset your password." (informational)
  2. "Use a recovery code" → form (username, recovery code, new password, confirm) → on success, a "Save your new recovery code" screen (Copy / Download / "I have saved this code" checkbox) → back to login.
- **Onboarding wizard:** recovery-code step immediately after first-admin creation (same save component).
- **User Management:** "Regenerate my recovery code" action (current-password prompt → save component); banner when the signed-in admin has no code.
- The console command is not mentioned in the UI.

## 10. Error handling summary

| Situation | Result |
|---|---|
| Recover: wrong code / unknown user / non-admin / disabled / no code | 401 generic message, audit failure |
| Recover: weak new password | 400 with password rule message |
| Recover: too many requests | 429 from `login` rate limiter |
| Regenerate: wrong current password | 400 "Current password is incorrect.", audit failure |
| Console: unknown user | exit 2 |
| Console: password rules / mismatch exhausted | exit 3 |
| Console: database unreachable | error message, exit 1 |
| Stale cookie after stamp rotation | 401, frontend returns to login (existing behavior on 401) |

## 11. Testing

**Backend (xUnit, `src/Pulse.Edge.Tests`)**
- `RecoveryCodeService`: format, normalization (dashes, case, look-alikes), hash/verify round-trip.
- `/api/auth/recover`: success issues a new code and the old one stops working; wrong code; unknown user; ReadOnly user; disabled user; no code set; clears lockout; weak password 400.
- Session revocation: a cookie issued before recovery / admin reset / disable is rejected afterwards; self password change keeps the admin signed in.
- `/api/auth/recovery-code`: requires Admin, wrong current password rejected, new code works.
- First-admin response includes a working recovery code.
- Upgrade path: existing DB without new columns gets them and a non-empty stamp per user.
- `PasswordResetCommand` against a temp data dir (`PULSE_EDGE_DATA_DIR`): `--list`, reset via redirected stdin, re-enables user, rotates stamp, writes audit, exit codes.
- `AuthorizationMatrixTests`: rows for `/api/auth/recover` (anonymous, also post-pairing) and `/api/auth/recovery-code` (Admin only).

**Frontend (vitest)**
- Login "Forgot password?" panel and both options.
- Recovery form: success shows new code; 401 shows generic error.
- Save-code component: Continue disabled until checkbox ticked.
- Onboarding recovery-code step.

## 12. Documentation updates
- `docs/PULSE_Edge_Local_Authentication_Spec.md`: recovery code, recover endpoint, console reset, session-stamp revocation.
- Windows/Linux runbook section for the console reset (§6.3) — in the auth spec or `PULSE_Edge_Windows_Deployment_Specification.md`.
- `docs/PULSE_Edge_Security_Exception_Register.md` + roadmap Decision and risk log: §8 entry.
- Roadmap G1 auth test coverage: evidence under `docs/readiness-evidence/` once CI passes.
