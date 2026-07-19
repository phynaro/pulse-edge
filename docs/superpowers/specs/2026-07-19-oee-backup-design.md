# OEE Channels in Configuration Backup (Format v2) — Design Spec

**Date:** 2026-07-19
**Status:** Approved design, pending implementation plan
**Closes:** Roadmap decision-log item D-001 (OEE channels excluded from backup in the initial OEE slice, PR #20)
**Context:** `src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs`, contract `know-how/cloud_oee_ingestion.md`

---

## 1. Goal

Include OEE channel configuration in the configuration backup/restore feature without ever violating the cloud contract's sequence rule ("per-channel, strictly monotonic, never reused" — the cloud silently drops any `(channel, seq)` it has already stored, so a rewound counter means silent data loss).

Out of scope: backing up outbox *messages* (they are data in flight, not configuration), runtime state (`LastState`/`LastCode`/`LastStateChangedAt`), and any UI beyond the existing restore-preview counts.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Old v1 backup files after the bump | **Accepted**: validator allows {1, 2}; a v1 file restores with zero OEE channels |
| `NextSeq` on restore | **Local wins + jump gap**: existing channel keeps its live local counter; a channel missing locally is restored with `NextSeq = backup value + 10 000` |
| Where the logic lives | Extend `ConfigurationBackupService` in place (no new helper class) |

---

## 2. Format change

- `ConfigurationBackupService.CurrentFormatVersion` → **2**. `Validate` accepts FormatVersion 1 or 2; anything else is rejected with the existing "Unsupported backup format version" error.
- `ConfigurationBackupPayload` gains a **trailing** member `List<OeeChannel>? OeeChannels = null`, annotated `[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]`.
  - **Why the annotation is load-bearing:** the checksum is computed by re-serializing the payload. A v1 file deserializes with `OeeChannels = null`; with the annotation, re-serialization omits the member entirely, producing byte-identical JSON to what v1 originally hashed — so v1 checksums keep validating. Without it, every v1 file would fail the checksum check.
- `CreateAsync` always writes a real list (empty when no channels exist), so every new backup is v2 with the member present.

## 3. Backup contents (per channel)

Sanitized projection, mirroring how adapters are stored with `Status = "Disconnected"`:

Included: `Id` (informational only — never used on restore), `ExternalId`, `Name`, `Enabled`, `RunDataPointId`, `FaultDataPointId`, `CodeDataPointId`, `GoodDataPointId`, `RejectDataPointId`, `DebounceSeconds`, `NextSeq`, `UpdatedAt`.
Excluded: `LastState`, `LastCode`, `LastStateChangedAt` (runtime diagnostics).

## 4. Restore semantics — match by ExternalId

The wholesale delete-and-reinsert used for the other five collections is **not** used for channels, because `OeeOutboxMessages.ChannelId` references channel row Ids: blind reinsertion could attach undelivered messages to the wrong machine or collide on the `(ChannelId, Seq)` unique index. Inside the existing restore transaction:

1. **Backup channel exists locally** (same `ExternalId`): update `Name`, `Enabled`, role bindings, `DebounceSeconds` in place. **Keep** the local row `Id`, the local `NextSeq` (always ≥ anything the cloud has seen), and the channel's outbox rows.
2. **Backup channel missing locally**: insert a fresh row (new autoincrement `Id`; the backup's `Id` is ignored) with `NextSeq = backup.NextSeq + 10_000`. The jump leaps over any history the cloud recorded after the backup was taken; the worst case is one gap the cloud flags as suspect — reuse is impossible.
3. **Local channel absent from the backup**: delete it **and** its outbox rows (consistent wholesale semantics, no orphans).
4. Every updated/inserted channel gets `UpdatedAt = DateTime.UtcNow`, which advances the `OeeSyncService` declaration watermark — a restore automatically re-declares channels on the next sync iteration with no extra wiring.

For a v1 file (no `OeeChannels` member), restore treats the set as empty — which per rule 3 deletes all local channels and their outbox rows. This matches the feature's existing wholesale contract ("restore makes the device match the backup") and is called out in the restore-preview UI by the counts (OEE channels: 0).

## 5. Validation additions (v2 payloads)

Mirroring the existing tag cross-reference checks, run only when `OeeChannels` is non-null:

- `ExternalId` non-empty and unique within the backup.
- `RunDataPointId` non-empty and present among the payload's DataPoints; each optional binding (`Fault`/`Code`/`Good`/`Reject`), when set, must also be present.
- `RejectDataPointId` requires `GoodDataPointId` (same rule the API enforces).
- `DebounceSeconds` in 0–60; `NextSeq ≥ 0`.

## 6. Surface updates

- `ConfigurationBackupCounts` gains `OeeChannels` (trailing member); `Inspect` populates it (0 for v1 files).
- Restore-preview UI (`ConfigurationBackupPanel.tsx`) shows an "OEE channels" count row; its component test updated.
- Roadmap: D-001 row marked resolved with the PR reference (at PR time).

## 7. Testing

- **Roundtrip:** create backup with channels → wipe → restore → channels present with correct config, `UpdatedAt` advanced.
- **Seq rules:** (a) existing channel keeps local `NextSeq` even when the backup carries a smaller value; (b) missing channel restored at `backup + 10 000`; (c) local channel absent from backup is deleted with its outbox rows purged.
- **v1 compatibility:** a serialized v1 fixture (no `OeeChannels` member) passes checksum validation, inspects with `OeeChannels = 0`, and restores (wiping local channels per §4).
- **Checksum stability:** a v2 document with `OeeChannels = null` (hand-built) serializes without the member — regression guard for the annotation.
- **Validation:** each §5 rule rejected with a distinct error message.
- UI: counts row renders in the panel test.

## 8. Risks & notes

- The +10 000 jump is a heuristic, not a proof: a channel deleted locally, whose device then produced >10 000 messages cloud-side *after the backup was taken and before deletion*, could still theoretically rewind. Accepted: that requires ~7 days of continuous 1-per-minute syncs between backup and delete, and the alternative (querying the cloud for its high-water mark) needs a new cloud API — out of scope, noted for the contract's v2 if ever needed.
- Backups taken on this build cannot be restored on older builds (v2 rejected there). One-way compatibility is the norm for this format and is surfaced by the existing version error message.
