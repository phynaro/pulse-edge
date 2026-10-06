# PULSE Edge Local Authentication Specification

## Purpose

Prevent unauthorized access to the PULSE Edge UI and API with local accounts and two roles: `Admin` and `ReadOnly`.

## Access model

- Authentication uses a local username and password and an HTTP-only session cookie.
- `ReadOnly` can view dashboards, diagnostics, buffers, adapters, tags, streams, MQTT devices, and redacted settings.
- `Admin` has read access plus every configuration, discovery, test, reset, and user-management operation.
- Authorization is enforced by the API. Hiding controls in the UI is only a usability aid.
- `/health`, authentication endpoints, setup status, and the inbound adapter webhook remain anonymous. The webhook retains its existing adapter-level validation behavior.

## Lifecycle

The server reports one of these states:

1. `NeedsCloudSetup`: there is no connected cloud configuration and no local user.
2. `NeedsFirstAdmin`: cloud pairing is connected and no local user exists.
3. `Operational`: at least one local user exists.

On a fresh install, cloud onboarding and pairing run first. After pairing succeeds, the final onboarding step creates the first `Admin`, signs it in, and opens the dashboard. The first-admin endpoint accepts exactly one successful claim and is closed whenever any user exists. The deliberately accepted risk is that another network client could claim the first account during this short window.

An upgraded, already-connected installation with no users enters `NeedsFirstAdmin` without repeating cloud setup.

## Reset behavior

- Soft reset requires `Admin`, preserves users and the current session, preserves local configuration, clears cloud pairing, and returns the administrator to cloud onboarding. First-admin creation is skipped.
- Factory reset requires `Admin`, deletes operational data, users, and audit records, invalidates the session, and returns to fresh onboarding. A new first admin is required after cloud pairing.

## Password recovery

Design: [2026-10-06-edge-password-recovery-design.md](superpowers/specs/2026-10-06-edge-password-recovery-design.md). A forgotten password never requires a factory reset. There are three paths:

- **Another admin resets it** (`PUT /api/users/{id}`). The login page's "Forgot password?" panel tells non-admin users to ask their administrator.
- **Admin recovery code** (web, works offline). Only `Admin` accounts hold a recovery code: 20 Crockford Base32 characters shown as five groups of four (e.g. `K7QM-3XHD-9PRT-W2NF-6BJC`). Only a PBKDF2 hash is stored. The plaintext is shown exactly once: when the first admin is created (onboarding blocks Continue until "I have saved this code" is ticked), and when an admin regenerates their own code in Local Access (`POST /api/auth/recovery-code`, requires the current password). Demoting an admin to `ReadOnly` clears their code.
- **Console reset** on the box itself (see the runbook below).

`POST /api/auth/recover` (`{ username, recoveryCode, newPassword }`) is anonymous and stays reachable after cloud pairing. It shares the `login` rate limit and validates the new password against the normal rules (400 on failure). Every other failure — wrong code, unknown user, `ReadOnly` user, disabled account, no code issued — returns the same `401 Invalid username or recovery code.`, and takes the same time, so the endpoint does not reveal which usernames exist. Input is forgiving: case, dashes, spaces, and the look-alikes `O`→`0`, `I`/`L`→`1` are normalized. On success the new password is set, an active lockout is cleared, the used code is consumed and a **new** code is returned (single use), and the user signs in normally. Recovery never re-enables a disabled account.

### Console reset (runbook)

For anyone with access to the box's operating system. The command runs and exits without starting the web server, so it is safe while the service is running, and no restart is needed afterwards. It is intentionally not mentioned in the UI.

**Windows**

1. At the PC (or via Remote Desktop), open **Command Prompt**.
2. `cd "C:\Program Files\PULSE Edge"`
3. `PulseEdge.Service.exe reset-password --list` — shows usernames, roles, enabled/locked state.
4. `PulseEdge.Service.exe reset-password --user <username>` — type the new password twice (input is hidden).
5. Sign in to the dashboard with the new password.

**Linux (`.deb`)** — run the installed binary **as the service user, with its home directory**, so it opens the same database as the service (`/var/lib/pulse-edge/.pulse/edge.db`):

```bash
sudo -u pulse env HOME=/var/lib/pulse-edge /opt/pulse-edge/Pulse.Edge reset-password --list
sudo -u pulse env HOME=/var/lib/pulse-edge /opt/pulse-edge/Pulse.Edge reset-password --user <username>
```

A plain `sudo …` would look in `/root/.pulse` instead. The command always prints the database path it resolved first, and refuses (exit `1`) if no database exists there rather than creating an empty one. `PULSE_EDGE_DATA_DIR` overrides the data directory on any platform.

The reset sets the password, clears any lockout, **re-enables** the account, and signs out its existing sessions. With piped input (scripts/SSH) the two lines are read from stdin and there is no re-prompt; interactively there are three attempts.

| Exit code | Meaning |
|---|---|
| `0` | Success (or `--list` printed) |
| `1` | No database at the resolved path, database error, or unrecognized arguments (usage is printed) |
| `2` | Unknown username |
| `3` | Password rules not met, or the confirmation did not match |

Accepted risk: any locally logged-in OS user can run this command — see [Security Exception Register](PULSE_Edge_Security_Exception_Register.md) R-012.

## User management

Admins can list, create, update, disable, reset passwords for, and delete users. Usernames are case-insensitively unique. The final enabled admin cannot be disabled, deleted, or demoted. Users cannot delete their own active account.

Passwords are stored only as salted PBKDF2-SHA256 hashes. Passwords must be at least 10 characters and include upper-case, lower-case, numeric, and non-alphanumeric characters. Login failures use a generic response and accounts are locked for 15 minutes after five failures.

## Session and audit behavior

Session cookies are HTTP-only, same-site strict, and secure when HTTPS is used. Disabled/deleted users cease to authorize on their next request. Each cookie carries the user's security stamp (`pulse:stamp`); the stamp rotates on any password reset (admin, recovery, or console), disable, or role change, which signs out every existing session for that user on its next request. An admin changing their own password is re-issued a cookie and stays signed in. Users from before this mechanism are signed out once after upgrading. Authentication and user-management events are recorded without passwords, cookies, cloud secrets, or request bodies.

