# GEMINI.md

This file provides guidance to Gemini (Antigravity) when working in this repository.

---

## Project: PULSE

**Asset-Centric Industrial Insight Platform** — built by Integra Innovation Co., Ltd. for Thai factory customers. Every capability (OEE, energy, $/piece, CMMS, RCA) is a lens on one asset spine. Sell painkillers ("stop machine #3 from breaking"); deliver a platform underneath.

Companion documents in [docs/](file:///Users/jirawuth/Projects/pulse-project/docs):
- [Asset-Platform-PRD.docx](file:///Users/jirawuth/Projects/pulse-project/docs/Asset-Platform-PRD.docx) — scope, decision register, build sequence, risks
- [asset-centric-design-reference.html](file:///Users/jirawuth/Projects/pulse-project/docs/asset-centric-design-reference.html) — authoritative technical spec of the data model (§ references point here)
- [asset-platform-sprint-checklist.html](file:///Users/jirawuth/Projects/pulse-project/docs/asset-platform-sprint-checklist.html) — task-level sprint tracker (Sprints 0–4)

---

## Current Work in Progress & Project Status

The foundation sprints (**Sprint 0 to Sprint 4**) have been successfully completed and are fully operational:
- **Sprint 0 (Project Skeleton)**: Monorepo setup, local dev services (Postgres + InfluxDB), CI pipeline (GitHub Actions), and basic PULSE layout shell are live.
- **Sprint 1 (Asset Core & Scoping)**: Organization/site boundaries, ISA-95 asset schema, materialized paths for O(1) roll-ups, and transaction-bound audit trail are complete.
- **Sprint 2 (Hierarchy UI & Import)**: High-performance tree visualization and bulk Excel importer with row-level validation.
- **Sprint 3 (Type & Profile System)**: Inheritable asset types and composable profiles that project namespaced property slots with zero-migration schema structure.
- **Sprint 4 (Unit Registry & Signal Bindings)**: Unit dimensions/conversion factors, temporal signal-to-tag mappings, and hot-path address resolution.

### Recent Feature Implementations & Present Focus:
- **Asset Overview Redesign**: Split-dashboard layout on the web application featuring white surface cards, 4:3 media card with type-icon placeholders and hover file upload, latest documents card, and recent activity timeline.
- **Server-side Actor Resolution**: Enriched database audit trail metadata by automatically resolving actor names on endpoints.
- **Unified Document Store**: Document category organization, versions, checkouts, and attachments to assets.
- **Edge Agent (`pulse-edge`) Enhancements**:
  - Removed BACnet browser fallback and fixed direct UDP test connection logic.
  - Interactive DND (Drag and Drop): Switched the Protocols Tab to drop-to-swap rearrangement, implemented ResizeObserver column calculation, and enabled drag-and-drop sorting for StreamsTab, TagsTab, and Adapter Cards.
  - Commissioning Wizard: Built a 2-step Bind Metric Tag wizard with multi-selection and bulk tag binding.
  - Refactored redundant JSON path parsing using a shared `JsonPathHelper`.

### Immediate Next Steps:
1. Progress telemetry ingestion validation (Sprint 5 ingestion/processing integration with Edge and InfluxDB).
2. Refine the UI/UX polish across both web and edge dashboards, standardizing confirmation dialogs.
3. Optimize performance of hot-path signal mappings and caching strategies.

---

## Tech Stack & Monorepo Structure

The repository is structured as a **pnpm monorepo**:

- [apps/api/](file:///Users/jirawuth/Projects/pulse-project/apps/api) — Fastify backend API (TypeScript)
- [apps/web/](file:///Users/jirawuth/Projects/pulse-project/apps/web) — React frontend application (Vite)
- [packages/db/](file:///Users/jirawuth/Projects/pulse-project/packages/db) — PostgreSQL system of record schema & query client (Drizzle ORM)
- [packages/types/](file:///Users/jirawuth/Projects/pulse-project/packages/types) — Shared TypeScript types

| Layer | Technology |
|:---|:---|
| **Relational core** | PostgreSQL — system of record for asset model via Drizzle ORM |
| **Time-series** | InfluxDB — telemetry store |
| **API / ingestion** | Node.js (TypeScript) — Fastify |
| **UI** | React (Vite) + **PULSE design system** |
| **Deployment unit** | Docker Compose — one stack per on-prem customer deployment |

---

## Development Commands

Always run these commands using `pnpm` from the workspace root or with target filters.

```bash
# Bring the full docker services up (Postgres + InfluxDB)
docker compose up -d

# Generate Drizzle migration files after schema edits
pnpm --filter @pulse/db generate

# Run database migrations
pnpm --filter @pulse/db migrate

# Seed development database (org, site, assets, types, profiles)
pnpm --filter @pulse/db seed

# Start the API development server (Fastify)
pnpm dev:api

# Start the Web development server (Vite + React)
pnpm dev:web

# Run all tests in the workspace (Vitest)
pnpm test

# Run tests in a specific package
pnpm --filter api test

# Run tests in watch mode
pnpm --filter api test:watch

# Run linter across all packages
pnpm lint

# Run TypeScript compilation checks across all packages
pnpm typecheck

# Build all packages for production
pnpm build
```

---

## Architecture

### The Four Orthogonal Axes

An asset is described by four independent dimensions. **Never collapse one into another.**

| Axis | Answers | Cardinality | Rule |
| :--- | :--- | :--- | :--- |
| **Tree** | "Where is it?" | ONE position | Physical containment, ISA-95, materialized path |
| **Type** | "What IS it?" | ONE type | Identity, inheritable, the noun (is-a) |
| **Profiles** | "What can it do?" | MANY | Composable capabilities, the adjectives (has-a), maps 1:1 to sellable modules |
| **Tags** | "What's true now?" | MANY | Cross-cutting labels, structured key/value, fast-changing |

### Data Model Pillars

**Hierarchy (Tree)**
- ISA-95 levels: Enterprise → Site → Area → Work Center → Work Unit → Component
- `level_type` column = semantic kind (modules read this); `parent_id` = structural depth (unlimited)
- Materialized path on every node for O(1) roll-up: `WHERE materialized_path LIKE 'TH.BKK.PACK.%'`
- Functional location (the slot) is separate from asset instance (the physical machine)
- Every asset has an effective parent — auto-create "Unassigned" root per site, never allow null parents

**Identity & Keys**
- All primary keys are **UUIDs** — non-negotiable. Auto-increment is forbidden.
- Customer codes are mutable attributes with history, never primary keys
- `organization_id` / `site_id` on core tables from day 1, resolved in one data-access layer

**Types & Profiles**
- One type per asset (identity/contract, inheritable via `parent_type_id`)
- Many profiles per asset (capability blocks, detachable, each ≈ one sellable module)
- Properties namespaced by source to avoid collisions: `energy_monitored.current` vs `machine.current`
- Start with 5–6 types (`generic_asset`, `machine`, `conveyor`, `energy_meter`, `case_erector`); grow with real module needs

**Tags**
- Structured `key/value` pairs with `category` — never flat strings
- Mutable tags that RCA will need → append to `asset_tag_history`, never overwrite
- Maintain a per-tenant tag dictionary to prevent the swamp

**External References**
- `asset_external_ref` — whole-asset ↔ external system (SAP, serial number, SCADA)
- `asset_signal_binding` — one property ↔ one live telemetry address (MQTT topic, OPC UA node, Modbus register)
- Both tables carry `valid_from`/`valid_to` — temporal validity is mandatory for RCA correctness
- Hot path (signal binding lookup) must be cached in memory by the ingestion service

**Auth Seam**
- Single seeded admin with JWT/session for v1 — the mechanism is deferred
- Current-actor concept resolved in one place (the data-access layer)
- `created_by` / `updated_by` audit fields on all core tables — populated via the actor, never nullable

**OEE Compute Rule**
- Store extensive components (planned_time, good_count, ideal_cycle_time); derive ratios per level
- Never average ratios up the tree — sum extensives, re-derive at each level
- Every computed bucket records data coverage (completeness flag); partial data ≠ authoritative

### Soft-Delete Policy

Assets are **decommissioned, never hard-deleted**. `deleted_at` column on all entities that carry telemetry history.

---

## Build Sequence (Sprints 0–4)

Each sprint ends at a **runnable checkpoint**, not just code that exists.

| Sprint | Focus | Checkpoint |
| :--- | :--- | :--- |
| **0** | Project skeleton | `docker compose up` → full stack live, PULSE shell renders, `/health` reports DB + Influx connected |
| **1** | Asset core + scoping + auth seam | Create asset via API → materialized path computes, prefix roll-up works, audit fields populated. Proven by tests + seed (no UI) |
| **2** | Hierarchy UI + bulk import | Import real 50–200 row asset list, render tree, hit validation error, fix, re-import cleanly |
| **3** | Type & profile system | Apply type → property slots auto-populate; attach OEE profile → more slots appear; validation query flags missing required property |
| **4** | Unit registry + external refs | Bind property to source; wrong-dimension unit rejected; hot-path query returns asset + property + scaling; reverse lookup resolves from external ID |

**Sprint 5+ (telemetry ingestion)** — MQTT ingestion is an **escalate item**: stop and consult product owner before beginning. Do not build a general compute/formula engine — v1 implements OEE's computation specifically.

---

## PULSE Design System

All UI is React + **PULSE**. Use best practices in modern web design (vibrant colors, dark mode, glassmorphism, dynamic animations, and Outfit/DM Sans fonts) to ensure the interface looks extremely premium.

Core design tokens:
- Fonts: `DM Sans` (body) + `Space Mono` (mono/code)
- Primary: `#3ce8bd` (pulse green)
- Background: `#f4f5f7`
- Surface: `#ffffff`
- Layout: Fixed 240px sidebar, 60px sticky topbar, scrollable content area

---

## Decision Register Summary

### LOCKED (do not change without consulting product owner)

- One asset spine — no module owns its own asset model
- Four orthogonal axes — tree / type / profiles / tags kept separate
- UUID primary keys everywhere
- `org_id`/`site_id` scoping seam on core tables from day 1
- Auth seam (current-actor + audit fields) from Sprint 1
- ISA-95 internally, permissive labels externally
- `level_type` vs tree depth — separate columns, never conflate
- Materialized path for roll-up
- Functional location vs instance split in schema
- Customer codes are mutable attributes, not keys
- Property namespacing by source
- Unit registry = semantics only (no compute math in foundation layer)
- Temporal `valid_from`/`valid_to` on external refs and signal bindings
- Soft-delete only
- Store extensive, derive intensive for OEE
- Completeness flag on every computed bucket

### TEAM'S TO DECIDE

Migration tooling, ORM/query-builder, test framework, CI provider, REST vs GraphQL, repository structure (monorepo recommended), pagination conventions, type/profile initial catalogue contents.

### ESCALATE — do not improvise

MQTT ingestion design (Sprint 5), compute/derivation engine generalization, asset relationship graph, asset lifecycle state machine, real auth provider (SSO/OAuth), non-linear unit conversions.

---

## Gemini (Antigravity) Specific Guidelines

When executing tasks as Antigravity, apply the following workflows:

1. **Information Retrieval & Context**:
   - Always read existing specs/checklists before modifying files.
   - Leverage `grep_search` and `view_file` to understand file imports and dependency relationships.

2. **Web App Implementation Rules**:
   - **Rich Aesthetics**: Avoid browser default stylings. Build premium, polished UIs. Use gradients, glassmorphism, and subtle micro-animations.
   - **Responsive Layout**: Adhere to the defined 240px sidebar and 60px topbar constraint.
   - **Vanilla CSS**: Write flexible vanilla CSS. Confirm Tailwind version *only* if explicitly requested.
   - **No Placeholders**: Never use placeholder images. If you need assets, invoke `generate_image`.
   - **SEO & Structure**: Provide descriptive `<title>`, appropriate meta tags, clean HTML5 structure, and unique element `id`s for testing.

3. **Code Editing & Integrity**:
   - Use `replace_file_content` for a single block of edits.
   - Use `multi_replace_file_content` for multiple disjoint edits across a file.
   - Preserve comments, JSDoc strings, and existing formatting context.
   - Always compile/typecheck (`pnpm typecheck`) and run tests (`pnpm test`) after modifying packages.

4. **Task Delegation**:
   - For long-running asynchronous execution or deep codebase research, you can spawn specialized subagents via `invoke_subagent` (e.g., `research` subagent).
   - Suggest slash commands to the user such as `/goal` (thorough overnight runs), `/schedule` (timers/recurring tasks), or `/grill-me` (interactive alignment).
