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

## User management

Admins can list, create, update, disable, reset passwords for, and delete users. Usernames are case-insensitively unique. The final enabled admin cannot be disabled, deleted, or demoted. Users cannot delete their own active account.

Passwords are stored only as salted PBKDF2-SHA256 hashes. Passwords must be at least 10 characters and include upper-case, lower-case, numeric, and non-alphanumeric characters. Login failures use a generic response and accounts are locked for 15 minutes after five failures.

## Session and audit behavior

Session cookies are HTTP-only, same-site strict, and secure when HTTPS is used. Disabled/deleted users cease to authorize on their next request. Authentication and user-management events are recorded without passwords, cookies, cloud secrets, or request bodies.

