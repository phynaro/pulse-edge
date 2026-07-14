# Slice 2D — Verification & gate evidence (design)

**Date:** 2026-07-14
**Phase:** G2 (Local security hardening), final slice before the gate review
**Predecessors:** Slice 2A (PR #12), Slice 2B (PR #13), Slice 2C (PR #15)
**Threat model:** [PULSE_Edge_Threat_Model.md](../../PULSE_Edge_Threat_Model.md) §Slice 2D

## Goal

Produce the automated tests, CI scans, and documents the G2 gate demands, close the two
open defense-in-depth follow-ups found in review (restore-endpoint `RequireAuthorization`,
the Agent's accept-any-certificate diagnostic forwarding), and set up the manual smokes so
the G2 gate review can be held with durable evidence.

This slice adds **verification**, not features. The only production-behavior changes are two
tightenings (Tasks 1 and 3a), both covered by tests.

## Scope

### Task 1 — Restore-endpoint authorization follow-up

`BackupEndpoints.cs` currently relies only on in-handler `context.User.IsInRole("Admin")`
checks. Anonymous requests therefore reach the handler and get 403 instead of being
rejected by the authentication pipeline with 401 (and the handler runs code before the check
on some paths).

- Add `.RequireAuthorization()` to all three endpoints (`GET /api/backups/configuration`,
  `POST /api/restores/configuration/inspect`, `POST /api/restores/configuration/apply`).
- Keep the in-handler role check as the Admin gate (non-admin authenticated → 403).
- Add/extend `AuthorizationMatrixTests` rows: anonymous → 401, ReadOnly → 403 for all three.

### Task 2 — Backup abuse tests (malformed + tampered)

The validation logic already exists in `ConfigurationBackupService.Validate` (format and
version checks, SHA-256 checksum over the configuration payload, uniqueness and referential
integrity). Oversized rejection was tested in Slice 2C. What is missing is gate evidence for
**malformed** and **tampered** inputs. New `BackupHardeningTests` cases (as Admin):

- Non-JSON request body → 400 from model binding, not a 500.
- JSON that is not a backup document (wrong `Format`) → rejected with the format error.
- Unsupported `FormatVersion` → rejected.
- **Tampered payload**: take a valid document, mutate the configuration, keep the stale
  `ChecksumSha256` → rejected with the checksum error. This is the tamper-detection check.
- Missing configuration payload / missing collections → rejected.
- Dangling reference (e.g. a data point referencing a missing adapter) → rejected.
- Inspect/apply parity: `inspect` and `apply` reject the same invalid document identically,
  and `apply` performs no partial write (adapter count unchanged after the rejected apply).

No production code change expected; if a case surfaces a 500 instead of a clean 400, fix it
minimally in the endpoint/service.

### Task 3 — TLS-bypass negative tests + diagnostic-forwarding fix

Gate check: "Production TLS verification cannot be bypassed."

**(a) Fix.** `DiagnosticForwardingProvider` (Agent, MultiPort mode) sets
`ServerCertificateCustomValidationCallback = (_, _, _, _) => true`, accepting any
certificate for any host. Its only legitimate purpose is trusting the box's **own**
self-signed local API certificate (introduced in Slice 2B). Scope the callback: accept an
otherwise-invalid certificate only when the request URI host is loopback
(`localhost` / `127.0.0.1` / `::1`); any other host gets default certificate validation.
Unit-test the callback logic directly (loopback + invalid cert → accepted; non-loopback +
invalid cert → rejected; valid chain → accepted regardless).

**(b) Negative tests.**
- Assert the cloud HTTP path (`CloudClient` / its `HttpClient` registration) uses default
  certificate validation: no custom validation callback, and no configuration knob exists
  that can disable TLS verification for the cloud endpoint.
- Keep the Slice 2B enforcement locked in: saving an `http://` cloud endpoint is rejected
  (already covered by `CloudEndpointEnforcementTests`; reference it as evidence).

**Exception:** the loopback-only trust in (a) is recorded in the security exception register
(Task 6) as a scoped, documented deviation.

### Task 4 — Full authorization matrix + completeness guard

Gate work item: "Verify admin and read-only authorization on every endpoint." The current
`AuthorizationMatrixTests` covers 5 of ~60 endpoints.

- Rework the test to enumerate every mapped route from the running app's
  `EndpointDataSource` (method + pattern).
- Maintain a classification table in the test: each endpoint is classified as
  `Anonymous` (e.g. login, and any deliberately-anonymous route), `Authenticated`
  (ReadOnly may call), or `Admin` (ReadOnly → 403).
- Assertions per classification: anonymous request → 401 for `Authenticated`/`Admin`
  routes; ReadOnly user → 403 for `Admin` routes; ReadOnly → non-401/403 for
  `Authenticated` routes. (Full 200-path behavior is out of scope — this matrix verifies
  authorization, not functionality, so 400/404 responses from missing bodies/ids are
  acceptable non-auth outcomes for the ReadOnly-allowed cases.)
- **Completeness guard:** the test fails if the app exposes an endpoint the table does not
  classify, or the table classifies an endpoint that no longer exists. New endpoints cannot
  ship unclassified.
- Infrastructure endpoints that take no HTTP verb semantics (static files, fallback) are
  excluded by explicit filter, with the filter itself asserted (it may only exclude the
  known infrastructure patterns).

### Task 5 — CodeQL + gitleaks in CI

Gate check: "Dependency, static-analysis, and secret scans pass." Dependency scans exist
since G1 (NuGet audit, pnpm audit). Add the missing two; the repo is public so both are free.

- **CodeQL:** new `.github/workflows/codeql.yml` — languages `csharp` and
  `javascript-typescript`, triggers: pull request to `main`, push to `main`, weekly
  schedule. Default query suite. .NET build via the pinned SDK (`global.json`) so autobuild
  succeeds.
- **gitleaks:** new job in `quality.yml` (or the CodeQL workflow) running gitleaks over the
  full history (`fetch-depth: 0`). No custom allowlist entries for real-looking secrets;
  test credentials already go through the `TestCredentials` helper convention. If historical
  hits appear, they are triaged: real secret → rotate + register entry; false positive →
  narrowest possible `.gitleaks.toml` allowlist rule with a comment.
- Branch protection: after both prove green on the slice PR, they are added to the required
  checks for `main` (recorded in the gate review).

### Task 6 — Documents

**(a) Security exception register** — `docs/PULSE_Edge_Security_Exception_Register.md`.
One table row per accepted deviation: ID, date, scope, rationale, accepted consequence,
review trigger. Initial entries:
- R-008 — device/protocol credentials plaintext + backup-recoverable (cloud keys only are
  encrypted).
- R-009 — setup-window trust-on-first-use accepted; no B-06 mechanism.
- R-010 — the Windows-only `config.json.sha256` integrity check (B-11) stays an unkeyed
  hash (detects corruption, not authenticated tampering) while Windows deployment is
  deferred per R-006.
- New: loopback-only certificate trust for MultiPort diagnostic forwarding (Task 3a).
The register cross-references the roadmap Decision and risk log; the roadmap log stays the
master record, the register is the gate-facing view.

**(b) G2 smoke runbook** — `docs/PULSE_Edge_G2_Smoke_Runbook.md`. Step-by-step commands
and expected outputs for the five manual smokes, each with a result field to fill in:
1. Published-build HTTPS browser check (2B): build via `./build.sh`, install on the staging
   box, browse `https://<host>:5288`, confirm the self-signed cert + Secure cookie.
2. `systemd-analyze security pulse-edge` (2B): record the exposure score with the sandbox
   settings applied.
3. Pre-2C upgrade reconnect (2C): a device paired before Slice 2C, upgraded to this build,
   reconnects to cloud (plaintext→encrypted migration ran; one-time UI re-login expected).
4. `dp-keys` permissions (2C): the DataProtection key ring directory is `0700`.
5. MultiPort two-process pairing (2C): API + Agent as separate processes share the key ring
   and the Agent can read the encrypted cloud credentials.
Completed runbook results are committed under `docs/readiness-evidence/`.

### Out of scope

- The G2 gate review itself (separate docs PR after the smokes pass, per the roadmap's
  evidence rule: this slice produces the evidence, the gate PR consumes it).
- B-13 (mTLS), B-15 (OPC UA hardening), B-16 (signed updates) — deferred beyond G2.
- Any UI change.

## Delivery

Single branch `slice-2d-gate-verification`, one PR, per-task reviews plus a whole-branch
review (same cadence as Slices 2A–2C). CI must stay green (`--warnaserror`, `--locked-mode`,
plus the two new scans). After merge: project owner runs the smoke runbook on the staging
box; results land in `docs/readiness-evidence/`; then the G2 gate review is held in a
follow-up docs PR (gate boxes checked with evidence links; dashboard, gate-review log, and
risk log updated).

## Decisions taken in brainstorming

- Scans: CodeQL + gitleaks in CI (durable, repeatable evidence) — chosen over one-off scans
  and over Roslyn-analyzer-only.
- Authz sweep: full matrix over every endpoint **with completeness guard** — chosen over a
  representative subset.
- Manual smokes: guided runbook executed by the owner **before** the gate review — the gate
  is not held with the smokes open.
