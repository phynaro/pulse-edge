# PULSE Edge — G2 Manual Smoke Runbook

Five manual checks left open by Slices 2B and 2C. Run on the Linux staging box
(steps 1–5) before the G2 gate review; record each result inline and commit the
completed copy to `docs/readiness-evidence/g2-smoke-results.md`.

Build under test: `git rev-parse HEAD` = ________  Date: ________  Operator: ________

## 1. Published-build HTTPS (Slice 2B)

On the build machine (macOS: prefix with `COPYFILE_DISABLE=1` when tarring):

    ./build.sh

Install/copy the published build onto the staging box, start the service, then from a
workstation browser open `https://<staging-host>:5288`.

Expected:
- The browser warns about a self-signed certificate (accept it); the UI loads over HTTPS.
- After logging in, DevTools → Application → Cookies shows the session cookie with the
  `Secure` and `HttpOnly` flags set.
- `http://<staging-host>:5288` does not serve the UI in plaintext.

Result: ________

## 2. systemd sandboxing score (Slice 2B)

On the staging box:

    systemd-analyze security pulse-edge --no-pager

Expected: the unit loads with the hardening directives from the shipped unit file applied
(no `Failed to determine unit` error). Record the exposure score; it should be
categorised "OK"/"Medium" or better — investigate anything the tool marks as an
unexpected regression from the Slice 2B baseline.

Score: ________  Result: ________

## 3. Pre-2C upgrade reconnects to cloud (Slice 2C)

Precondition: a device (or VM snapshot) paired to cloud on a pre-Slice-2C build, with
plaintext cloud credentials in `edge.db`.

1. Stop the service; install this build; start the service.
2. Watch the log (`journalctl -u pulse-edge -f`): the startup credential migration runs once.
3. Confirm the device shows Connected in the dashboard and telemetry resumes.
4. Expected side effect: the first browser visit after the upgrade requires a re-login
   (shared DataProtection key ring replaced the ephemeral one).

Result: ________

## 4. DataProtection key ring permissions (Slice 2C)

On the staging box:

    stat -c '%a %U %n' "$(dirname "$(readlink -f /var/lib/pulse-edge)" 2>/dev/null || echo /var/lib/pulse-edge)/dp-keys" 2>/dev/null || stat -c '%a %U %n' <data-dir>/dp-keys

(Use the actual configured data directory if it differs.) Expected: mode `700`, owned by
the service user; the directory contains at least one `key-*.xml`.

Result: ________

## 5. MultiPort two-process pairing (Slice 2C)

On a dev machine (or the staging box) with `hostingMode: MultiPort`:

1. Start the API process, then the Agent process as separate `dotnet run` processes.
2. Confirm in the Agent log that it decrypts the stored cloud credentials (no
   `CryptographicException` / re-pairing prompt) — both processes share `<data dir>/dp-keys`.
3. Confirm Agent diagnostics appear in the API's diagnostic log UI (forwarding works over
   the self-signed local HTTPS with the loopback-scoped trust from Slice 2D).

Result: ________
