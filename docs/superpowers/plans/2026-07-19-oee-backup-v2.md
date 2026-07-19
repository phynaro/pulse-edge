# OEE Channels in Configuration Backup (Format v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include OEE channel configuration in backup/restore (format v2) without ever rewinding a channel's `NextSeq` (the cloud dedups on `(channel, seq)`; a rewound counter means silent data loss).

**Architecture:** Extend `ConfigurationBackupService` in place: a nullable trailing `OeeChannels` payload member (JSON-omitted when null, so v1 checksums keep validating), version acceptance {1, 2}, and a restore path that matches channels by `ExternalId` — never by row Id — applying "local `NextSeq` wins; missing channel restored at backup + 10 000". Spec: `docs/superpowers/specs/2026-07-19-oee-backup-design.md`.

**Tech Stack:** .NET 10, System.Text.Json (`JsonSerializerDefaults.Web`), EF Core + SQLite, xunit; React + vitest for the preview panel.

## Global Constraints

- `dotnet build Pulse.Edge.slnx --warnaserror` — zero warnings. `pnpm lint:ui` zero errors; `pnpm test:ui` green.
- `CurrentFormatVersion` = **2**; validator accepts FormatVersion **1 or 2** only.
- v1 payloads deserialize with `OeeChannels == null` and MUST re-serialize byte-identically (checksum survival) — the `[property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` annotation is load-bearing.
- A FormatVersion 1 document that *contains* an `OeeChannels` member is invalid ("Format v1 backups must not contain OEE channels.").
- Restore seq rules: existing channel (same `ExternalId`) keeps local row Id, local `NextSeq`, and outbox rows; missing channel inserted with `NextSeq = backup.NextSeq + 10_000` (`SeqRestoreJump` const); local channel absent from backup is deleted with its outbox rows purged.
- Every restored/updated channel gets `UpdatedAt = DateTime.UtcNow` (advances the OeeSyncService declaration watermark → automatic re-declaration).
- Backup projection excludes runtime state: `LastState`, `LastCode`, `LastStateChangedAt` stay null in the payload.
- `ConfigurationBackupServiceTests` uses its own temp-path `QueueDbContext(DatabasePath)` — keep that isolation pattern for all new tests.
- Backend tests: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`. Focused UI test: `npx vitest run ConfigurationBackupPanel` from `src/Pulse.Edge.UI` (the `pnpm --filter … -- <file>` form does not filter in this repo).
- Branch `feature/oee-backup-v2`; never push to `main`.

## File Structure

| File | Responsibility |
|---|---|
| `src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs` | All format/validation/restore logic (payload member, version set, channel restore, counts) |
| `src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs` | All backend coverage (extend existing class) |
| `src/Pulse.Edge.UI/src/components/ConfigurationBackupPanel.tsx` + `.test.tsx` | Preview counts row |
| `docs/PULSE_Edge_Production_Readiness_Roadmap.md` | D-001 resolution note |

---

### Task 1: Format v2 — payload member, version acceptance, checksum stability

**Files:**
- Modify: `src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs`
- Test: `src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs` (extend)

**Interfaces:**
- Consumes: `OeeChannel` model (`src/Pulse.Edge.Storage/Models/OeeChannel.cs`), `db.OeeChannels`.
- Produces: `ConfigurationBackupPayload` with trailing `List<OeeChannel>? OeeChannels = null`; `CurrentFormatVersion == 2`; `CreateAsync` populates a sanitized, `ExternalId`-ordered channel list. Later tasks rely on `payload.OeeChannels` and the v1-null convention.

- [ ] **Step 1: Write the failing tests** (append inside the existing class; the seed in `InitializeDatabase` already adds one channel — first enrich it so sanitization is provable, replacing the current probe block)

Replace the existing `db.OeeChannels.Add(new OeeChannel {...})` block in `InitializeDatabase` with:

```csharp
        db.OeeChannels.Add(new OeeChannel
        {
            ExternalId = "line1.filler",
            Name = "Line 1 — Filler",
            Enabled = true,
            RunDataPointId = "point-1",
            GoodDataPointId = "point-1",
            DebounceSeconds = 3,
            NextSeq = 42,
            LastState = "running",           // runtime state — must NOT appear in the backup
            LastCode = "E0",
            LastStateChangedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
```

Append the new tests:

```csharp
    [Fact]
    public async Task Create_ProducesV2_WithSanitizedChannels()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));

        var backup = await service.CreateAsync();

        Assert.Equal(2, backup.FormatVersion);
        var channel = Assert.Single(backup.Configuration.OeeChannels!);
        Assert.Equal("line1.filler", channel.ExternalId);
        Assert.Equal(42, channel.NextSeq);
        Assert.Equal(3, channel.DebounceSeconds);
        Assert.Null(channel.LastState);          // runtime state sanitized out
        Assert.Null(channel.LastCode);
        Assert.Null(channel.LastStateChangedAt);
    }

    [Fact]
    public async Task Serialize_OmitsNullOeeChannels_ForChecksumStability()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync();

        var v1Style = backup with { Configuration = backup.Configuration with { OeeChannels = null } };
        var json = System.Text.Encoding.UTF8.GetString(service.Serialize(v1Style));

        Assert.DoesNotContain("oeeChannels", json); // null member must vanish, or every v1 checksum breaks
        Assert.Contains("oeeChannels", System.Text.Encoding.UTF8.GetString(service.Serialize(backup)));
    }

    [Fact]
    public async Task Inspect_AcceptsV1Document_AndRejectsV1CarryingChannels()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var v2 = await service.CreateAsync();

        // A faithful v1 fixture: channel-less payload, checksum recomputed the way the
        // service does it (Web defaults + indented). The JsonIgnore annotation makes this
        // serialization byte-identical to what a real v1 build produced.
        var v1Payload = v2.Configuration with { OeeChannels = null };
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true };
        var checksum = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(v1Payload, options))).ToLowerInvariant();
        var v1Doc = v2 with { FormatVersion = 1, Configuration = v1Payload, ChecksumSha256 = checksum };

        Assert.True(service.Inspect(v1Doc).IsValid, string.Join("; ", service.Inspect(v1Doc).Errors));

        // v1 must not carry channels.
        var tampered = v1Doc with { Configuration = v2.Configuration, ChecksumSha256 = v2.ChecksumSha256 };
        var inspection = service.Inspect(tampered);
        Assert.False(inspection.IsValid);
        Assert.Contains(inspection.Errors, e => e.Contains("v1", StringComparison.OrdinalIgnoreCase));

        // Unknown version still rejected.
        Assert.False(service.Inspect(v2 with { FormatVersion = 3 }).IsValid);
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`
Expected: FAIL to compile — `OeeChannels` not a member of `ConfigurationBackupPayload`.

- [ ] **Step 3: Implement the format change**

In `ConfigurationBackupService.cs`:

1. Line 12: `public const int CurrentFormatVersion = 2;` and add below it: `public const long SeqRestoreJump = 10_000;` (used in Task 2; declared here so the const lives beside its sibling).
2. Add `using System.Text.Json.Serialization;` to the usings.
3. `ConfigurationBackupPayload` — add the trailing member:

```csharp
public sealed record ConfigurationBackupPayload(
    List<DriverAdapter> Adapters,
    List<DataSource> DataSources,
    List<DataPoint> DataPoints,
    List<MqttDevice> MqttDevices,
    List<StreamTemplate> StreamTemplates,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    List<OeeChannel>? OeeChannels = null);
```

4. `CreateAsync` — add as the sixth constructor argument of the payload (after the StreamTemplates query):

```csharp
            await db.OeeChannels.AsNoTracking().OrderBy(x => x.ExternalId).Select(x => new OeeChannel
            {
                Id = x.Id, ExternalId = x.ExternalId, Name = x.Name, Enabled = x.Enabled,
                RunDataPointId = x.RunDataPointId, FaultDataPointId = x.FaultDataPointId,
                CodeDataPointId = x.CodeDataPointId, GoodDataPointId = x.GoodDataPointId,
                RejectDataPointId = x.RejectDataPointId, DebounceSeconds = x.DebounceSeconds,
                NextSeq = x.NextSeq, UpdatedAt = x.UpdatedAt
                // LastState/LastCode/LastStateChangedAt intentionally omitted — runtime state,
                // like adapters backed up with Status = "Disconnected".
            }).ToListAsync(cancellationToken));
```

5. `Validate` — replace the strict version line (125) with:

```csharp
        if (document.FormatVersion is not (1 or 2)) errors.Add($"Unsupported backup format version {document.FormatVersion}.");
```

and, AFTER the required-collections null check (so `Configuration` is known non-null), add:

```csharp
        if (document.FormatVersion == 1 && document.Configuration.OeeChannels is not null)
            errors.Add("Format v1 backups must not contain OEE channels.");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`
Expected: PASS (existing 2 + new 3). Note: the pre-existing roundtrip test still passes — restore ignores the new member until Task 2, and its OEE assertion (`1 == OeeChannels.Count`) holds because nothing deletes the seeded channel yet.

- [ ] **Step 5: Build clean and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs
git commit -m "feat(backup): format v2 with sanitized OEE channels; v1 accepted channel-less"
```

---

### Task 2: Restore semantics — ExternalId matching, seq safety, outbox purge

**Files:**
- Modify: `src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs` (`RestoreAsync`)
- Test: `src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs` (extend)

**Interfaces:**
- Consumes: `payload.OeeChannels` (Task 1), `SeqRestoreJump` const, `db.OeeOutboxMessages`.
- Produces: restore behavior per spec §4 — later tasks and tests rely on: local `NextSeq` wins; missing → `backup.NextSeq + SeqRestoreJump`; absent-from-backup → deleted + outbox purged; all touched channels `UpdatedAt = now`.

- [ ] **Step 1: Write the failing tests**

```csharp
    [Fact]
    public async Task Restore_ExistingChannel_KeepsLocalSeqIdAndOutbox_ButAppliesBackupConfig()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync(); // carries line1.filler with NextSeq 42, Name "Line 1 — Filler"

        int localId;
        await using (var db = new QueueDbContext(DatabasePath))
        {
            var local = await db.OeeChannels.SingleAsync();
            localId = local.Id;
            local.NextSeq = 500;                  // device kept producing after the backup
            local.Name = "Renamed Since Backup";  // config drift the restore must undo
            db.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = localId, Seq = 499, Type = "sync", Ts = DateTime.UtcNow,
                State = "running", CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        var channel = await verified.OeeChannels.SingleAsync();
        Assert.Equal(localId, channel.Id);                     // row identity kept
        Assert.Equal(500, channel.NextSeq);                    // local counter wins — never rewound to 42
        Assert.Equal("Line 1 — Filler", channel.Name);         // config restored from backup
        Assert.Equal(1, await verified.OeeOutboxMessages.CountAsync(m => m.ChannelId == localId)); // in-flight data kept
    }

    [Fact]
    public async Task Restore_MissingChannel_InsertsWithJumpedSeq()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync(); // NextSeq 42 in the backup

        await using (var db = new QueueDbContext(DatabasePath))
        {
            await db.OeeOutboxMessages.ExecuteDeleteAsync();
            await db.OeeChannels.ExecuteDeleteAsync();          // channel deleted since the backup
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        var channel = await verified.OeeChannels.SingleAsync();
        Assert.Equal("line1.filler", channel.ExternalId);
        Assert.Equal(42 + ConfigurationBackupService.SeqRestoreJump, channel.NextSeq); // leap over unknown cloud history
    }

    [Fact]
    public async Task Restore_ChannelAbsentFromBackup_IsDeletedWithOutboxPurged()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync(); // contains only line1.filler

        int strayId;
        await using (var db = new QueueDbContext(DatabasePath))
        {
            var stray = new OeeChannel
            {
                ExternalId = "commissioned.after.backup", Name = "Stray",
                RunDataPointId = "point-1", UpdatedAt = DateTime.UtcNow,
            };
            db.OeeChannels.Add(stray);
            await db.SaveChangesAsync();
            strayId = stray.Id;
            db.OeeOutboxMessages.Add(new OeeOutboxMessage
            {
                ChannelId = strayId, Seq = 0, Type = "sync", Ts = DateTime.UtcNow,
                State = "stopped", CreatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        Assert.Equal("line1.filler", (await verified.OeeChannels.SingleAsync()).ExternalId);
        Assert.Equal(0, await verified.OeeOutboxMessages.CountAsync(m => m.ChannelId == strayId));
    }

    [Fact]
    public async Task Restore_AdvancesUpdatedAt_SoChannelsAreRedeclared()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var backup = await service.CreateAsync();
        var before = DateTime.UtcNow;

        var restored = await service.RestoreAsync(backup);

        Assert.True(restored.IsValid, string.Join("; ", restored.Errors));
        await using var verified = new QueueDbContext(DatabasePath);
        Assert.True((await verified.OeeChannels.SingleAsync()).UpdatedAt >= before); // watermark moved → OeeSyncService re-declares
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`
Expected: FAIL — `Restore_ExistingChannel…` fails on `Assert.Equal("Line 1 — Filler", channel.Name)` (restore doesn't touch channels yet); `Restore_ChannelAbsentFromBackup…` fails on the stray still existing.

- [ ] **Step 3: Implement the channel restore section**

In `RestoreAsync`, inside the transaction, after `db.StreamTemplates.AddRange(...)` and before `SaveChangesAsync`, add:

```csharp
            // OEE channels: match by ExternalId, never by row Id — outbox rows reference
            // row Ids, and NextSeq must never rewind (the cloud dedups on (channel, seq);
            // a rewound counter means messages silently dropped as duplicates).
            var backupChannels = payload.OeeChannels ?? new List<OeeChannel>();
            var backupExternalIds = backupChannels.Select(c => c.ExternalId).ToHashSet(StringComparer.Ordinal);
            var localChannels = await db.OeeChannels.ToListAsync(cancellationToken);
            var now = DateTime.UtcNow;

            foreach (var local in localChannels.Where(l => !backupExternalIds.Contains(l.ExternalId)))
            {
                // Absent from the backup: wholesale semantics — remove it and its queued messages.
                await db.OeeOutboxMessages.Where(m => m.ChannelId == local.Id).ExecuteDeleteAsync(cancellationToken);
                db.OeeChannels.Remove(local);
            }

            var localByExternalId = localChannels.ToDictionary(c => c.ExternalId, StringComparer.Ordinal);
            foreach (var incoming in backupChannels)
            {
                if (localByExternalId.TryGetValue(incoming.ExternalId, out var existing))
                {
                    // Exists locally: apply config, keep row Id + local NextSeq (always ≥ cloud) + outbox rows.
                    existing.Name = incoming.Name;
                    existing.Enabled = incoming.Enabled;
                    existing.RunDataPointId = incoming.RunDataPointId;
                    existing.FaultDataPointId = incoming.FaultDataPointId;
                    existing.CodeDataPointId = incoming.CodeDataPointId;
                    existing.GoodDataPointId = incoming.GoodDataPointId;
                    existing.RejectDataPointId = incoming.RejectDataPointId;
                    existing.DebounceSeconds = incoming.DebounceSeconds;
                    existing.UpdatedAt = now; // advances the declaration watermark → re-declared next sync
                }
                else
                {
                    // Missing locally: fresh row; jump the counter past any post-backup cloud history.
                    db.OeeChannels.Add(new OeeChannel
                    {
                        ExternalId = incoming.ExternalId,
                        Name = incoming.Name,
                        Enabled = incoming.Enabled,
                        RunDataPointId = incoming.RunDataPointId,
                        FaultDataPointId = incoming.FaultDataPointId,
                        CodeDataPointId = incoming.CodeDataPointId,
                        GoodDataPointId = incoming.GoodDataPointId,
                        RejectDataPointId = incoming.RejectDataPointId,
                        DebounceSeconds = incoming.DebounceSeconds,
                        NextSeq = incoming.NextSeq + SeqRestoreJump,
                        UpdatedAt = now,
                    });
                }
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`
Expected: PASS (all 9). The pre-existing roundtrip test still passes: its seeded channel is in the backup, so restore keeps it (count still 1).

- [ ] **Step 5: Commit**

```bash
git add src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs
git commit -m "feat(backup): ExternalId-matched OEE channel restore with seq-safety rules"
```

---

### Task 3: Validation rules + inspection counts

**Files:**
- Modify: `src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs` (`Validate`, `Inspect`, `ConfigurationBackupCounts`)
- Test: `src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs` (extend)

**Interfaces:**
- Consumes: Task 1 payload member.
- Produces: `ConfigurationBackupCounts` gains trailing `int OeeChannels = 0`; `Inspect(...).Counts.OeeChannels`. Task 4's UI relies on the camelCase field `counts.oeeChannels`.

- [ ] **Step 1: Write the failing tests**

```csharp
    private static ConfigurationBackupDocument Rechecksum(ConfigurationBackupService service, ConfigurationBackupDocument doc)
    {
        // Re-sign a hand-mutated payload so validation reaches the semantic rules
        // instead of stopping at the checksum. Mirrors the service's own options.
        var options = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web) { WriteIndented = true };
        var checksum = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(doc.Configuration, options))).ToLowerInvariant();
        return doc with { ChecksumSha256 = checksum };
    }

    [Fact]
    public async Task Inspect_CountsOeeChannels_AndZeroForV1()
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var v2 = await service.CreateAsync();

        Assert.Equal(1, service.Inspect(v2).Counts.OeeChannels);

        var v1 = Rechecksum(service, v2 with { FormatVersion = 1, Configuration = v2.Configuration with { OeeChannels = null } });
        Assert.Equal(0, service.Inspect(v1).Counts.OeeChannels);
    }

    [Theory]
    [InlineData("dup")]        // duplicate ExternalId
    [InlineData("run")]        // run tag missing from payload
    [InlineData("role")]       // optional role tag missing from payload
    [InlineData("reject")]     // reject without good
    [InlineData("debounce")]   // out of range
    [InlineData("seq")]        // negative NextSeq
    public async Task Inspect_RejectsInvalidChannelPayloads(string kind)
    {
        await InitializeDatabase();
        var service = new ConfigurationBackupService(() => new QueueDbContext(DatabasePath));
        var v2 = await service.CreateAsync();
        var good = v2.Configuration.OeeChannels!.Single();

        List<OeeChannel> channels = kind == "dup"
            ? [good, Clone(good)]            // two channels sharing an ExternalId
            : [Mutate(good, kind)];

        var doc = Rechecksum(service, v2 with { Configuration = v2.Configuration with { OeeChannels = channels } });
        var inspection = service.Inspect(doc);

        Assert.False(inspection.IsValid);
        Assert.Contains(inspection.Errors, e => e.Contains("OEE channel", StringComparison.OrdinalIgnoreCase));
    }

    private static OeeChannel Clone(OeeChannel c) => new()
    {
        ExternalId = c.ExternalId, Name = c.Name, Enabled = c.Enabled,
        RunDataPointId = c.RunDataPointId, FaultDataPointId = c.FaultDataPointId,
        CodeDataPointId = c.CodeDataPointId, GoodDataPointId = c.GoodDataPointId,
        RejectDataPointId = c.RejectDataPointId, DebounceSeconds = c.DebounceSeconds,
        NextSeq = c.NextSeq, UpdatedAt = c.UpdatedAt,
    };

    private static OeeChannel Mutate(OeeChannel good, string kind)
    {
        var c = Clone(good);
        switch (kind)
        {
            case "run": c.RunDataPointId = "no-such-tag"; break;
            case "role": c.FaultDataPointId = "no-such-tag"; break;
            case "reject": c.GoodDataPointId = null; c.RejectDataPointId = "point-1"; break;
            case "debounce": c.DebounceSeconds = 61; break;
            case "seq": c.NextSeq = -1; break;
        }
        return c;
    }
```

Note for the implementer: `OeeChannel` is a plain class, not a record — hence the `Clone` helper instead of a `with` expression.

- [ ] **Step 2: Run to verify failure**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`
Expected: FAIL to compile — `Counts.OeeChannels` not defined; then (after counts exist) validation Theory fails because no rules reject the payloads.

- [ ] **Step 3: Implement counts + validation**

1. `ConfigurationBackupCounts` — add trailing member:

```csharp
public sealed record ConfigurationBackupCounts(int Adapters, int DataSources, int DataPoints, int MqttDevices, int StreamTemplates, int OeeChannels = 0);
```

2. `Inspect` — add the sixth argument: `payload?.OeeChannels?.Count ?? 0`.
3. `Validate` — after the existing DataPoints foreach (line ~149), add:

```csharp
        if (document.Configuration.OeeChannels is { } oeeChannels)
        {
            CheckUnique(oeeChannels.Select(x => x.ExternalId), "OEE channel", errors);
            var pointIds = document.Configuration.DataPoints.Select(x => x.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var channel in oeeChannels)
            {
                if (string.IsNullOrWhiteSpace(channel.RunDataPointId) || !pointIds.Contains(channel.RunDataPointId))
                    errors.Add($"OEE channel '{channel.ExternalId}' references missing run tag '{channel.RunDataPointId}'.");
                foreach (var (role, id) in new[]
                {
                    ("fault", channel.FaultDataPointId), ("code", channel.CodeDataPointId),
                    ("good", channel.GoodDataPointId), ("reject", channel.RejectDataPointId),
                })
                {
                    if (!string.IsNullOrWhiteSpace(id) && !pointIds.Contains(id!))
                        errors.Add($"OEE channel '{channel.ExternalId}' references missing {role} tag '{id}'.");
                }
                if (!string.IsNullOrWhiteSpace(channel.RejectDataPointId) && string.IsNullOrWhiteSpace(channel.GoodDataPointId))
                    errors.Add($"OEE channel '{channel.ExternalId}' has a reject counter but no good counter.");
                if (channel.DebounceSeconds is < 0 or > 60)
                    errors.Add($"OEE channel '{channel.ExternalId}' has an invalid debounce ({channel.DebounceSeconds}s).");
                if (channel.NextSeq < 0)
                    errors.Add($"OEE channel '{channel.ExternalId}' has a negative sequence counter.");
            }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj --filter FullyQualifiedName~ConfigurationBackupServiceTests`
Expected: PASS (all 16, incl. 6 Theory cases).

- [ ] **Step 5: Build clean and commit**

```bash
dotnet build Pulse.Edge.slnx --warnaserror
git add src/Pulse.Edge.Api/Services/ConfigurationBackupService.cs src/Pulse.Edge.Tests/ConfigurationBackupServiceTests.cs
git commit -m "feat(backup): OEE channel validation rules and inspection count"
```

---

### Task 4: UI preview count, roadmap closure, full verification

**Files:**
- Modify: `src/Pulse.Edge.UI/src/components/ConfigurationBackupPanel.tsx`
- Modify: `src/Pulse.Edge.UI/src/components/ConfigurationBackupPanel.test.tsx`
- Modify: `docs/PULSE_Edge_Production_Readiness_Roadmap.md` (D-001 row)

**Interfaces:**
- Consumes: `counts.oeeChannels` (camelCase serialization of Task 3's record member — `JsonSerializerDefaults.Web`).

- [ ] **Step 1: Update the failing test first**

In `ConfigurationBackupPanel.test.tsx`:
- `validInspection.counts` becomes: `{ adapters: 2, dataSources: 3, dataPoints: 40, mqttDevices: 1, streamTemplates: 5, oeeChannels: 4 }`.
- In the `'shows the restore preview for a valid backup'` test, add after the adapter-count assertion:

```tsx
    expect(screen.getByText('4')).toBeInTheDocument(); // OEE channel count
    expect(screen.getByText(/OEE Channels/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run to verify failure**

Run (from `src/Pulse.Edge.UI`): `npx vitest run ConfigurationBackupPanel`
Expected: FAIL — `OEE Channels` not rendered.

- [ ] **Step 3: Implement the panel changes**

In `ConfigurationBackupPanel.tsx`:
1. `Inspection.counts` interface gains `oeeChannels: number;`.
2. In the `backup-count-grid` div, add after the MQTT Devices span:

```tsx
            <span><strong>{inspection.counts.oeeChannels}</strong> OEE Channels</span>
```

3. Update the confirm message (line ~101) to include channels:

```tsx
      message: `This will replace ${inspection.counts.adapters} adapters, ${inspection.counts.dataPoints} tags, ${inspection.counts.dataSources} streams, and ${inspection.counts.oeeChannels} OEE channels. Device identity, cloud pairing, users, and buffered telemetry will be preserved.`,
```

4. Update the panel description sentence (line ~141) to: `Export or replace adapters, tags, MQTT devices, streams, templates, and OEE channels. Device identity, cloud pairing, users, queues, and history stay on this node.`

- [ ] **Step 4: Roadmap closure**

In `docs/PULSE_Edge_Production_Readiness_Roadmap.md`, find the D-001 row (OEE channels not in configuration backup) and append to its text: `Resolved 2026-07-19: format v2 includes OEE channels with ExternalId-matched restore and seq-safety rules (spec docs/superpowers/specs/2026-07-19-oee-backup-design.md).` Match the row's existing format; do not change its D-number.

- [ ] **Step 5: Full verification**

```bash
cd src/Pulse.Edge.UI && npx vitest run ConfigurationBackupPanel && cd ../..
pnpm test:ui
pnpm lint:ui
pnpm build:ui
dotnet build Pulse.Edge.slnx --warnaserror
dotnet test src/Pulse.Edge.Tests/Pulse.Edge.Tests.csproj
```

Expected: all green (backend 158 + ~14 new = ~172; UI suites all pass).

- [ ] **Step 6: Commit**

```bash
git add src/Pulse.Edge.UI/ docs/PULSE_Edge_Production_Readiness_Roadmap.md
git commit -m "feat(backup): OEE channel count in restore preview; close D-001"
```
