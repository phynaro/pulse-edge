# OEE Machines Dashboard Panel — Design Spec

**Date:** 2026-07-19
**Status:** Approved design, pending implementation plan
**Context:** `src/Pulse.Edge.UI/src/components/Dashboard/OperationalOverview.tsx` (three existing `ops-health-panel` sections), `GET /api/oee/status` (shape: `{ channels: [{id, externalId, name, enabled, lastState, lastCode, lastStateChangedAt, nextSeq, pendingCount}], outboxDepth }`), `OeeStatusResponse` type in `src/Pulse.Edge.UI/src/types.ts`.

---

## 1. Goal

Surface OEE machine status on the Dashboard tab as a fourth health panel matching the existing overview-grid anatomy (Adapter health / Tag health / Stream configuration), with click-through to the OEE tab. UI-only; no backend changes.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Presence | Fourth `ops-health-panel` in the overview grid (not status-strip-only; no drilldown-modal integration) |
| Click behavior | Everything clickable navigates to the OEE tab via an `onOpenOee` callback |
| Component boundary | New file `Dashboard/OeeOverviewPanel.tsx`; `OperationalOverview` only passes props through |

## 2. Component — `OeeOverviewPanel`

`src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.tsx`:

```ts
interface Props {
  oeeStatus: OeeStatusResponse | null;   // null = not yet loaded / fetch failed
  onOpenOee: () => void;
}
```

Anatomy (mirrors the sibling panels' classes):

- `<section className="ops-health-panel is-oee">` with `ops-panel-head`: `Gauge` icon (lucide), `<h3>OEE machines</h3>`, `<p>Machine state & delivery</p>`, and the `ops-total` button showing channel count → `onOpenOee`.
- **State classification** (per channel): `fault` | `stopped` | `running` from `lastState`; `no-data` when `lastState` is null. Disabled channels count into their `lastState` bucket like enabled ones (state is still the last honest observation) — no separate disabled bucket (YAGNI; the OEE tab shows enabled flags).
- `ops-segment-rail` over the four states in order `running, stopped, fault, no-data`, widths proportional to counts, `is-running|is-stopped|is-fault|is-nodata` modifiers; each segment button → `onOpenOee`.
- `ops-metric-grid` with the four state counts (dot + count + label), each button → `onOpenOee`.
- Breakdown list (`ops-breakdown`): top 3 machines sorted fault-first, then `pendingCount` descending, then name; each row shows name, state text, and pending count; row buttons → `onOpenOee`. Below it a single line: `Outbox depth: {outboxDepth}`.
- **Empty state** (loaded, `channels.length === 0`): panel body replaced by a short message "No OEE channels configured" with a button "Open OEE tab" → `onOpenOee`.
- **Loading/failed state** (`oeeStatus === null`): the same empty-state layout with text "OEE status unavailable" and no fabricated zeros.

**CSS**: the four `is-*` state modifiers and `is-oee` panel accent may need small additions where the existing `ops-*` styles live (locate them in the pulse-ui package during implementation; reuse existing state colors — success/warning/danger/muted tokens — rather than inventing new ones). If `ops-overview-grid` is fixed at three columns, adjust it to accommodate four panels (wrap or auto-fit) in the same CSS home; verify at common widths.

## 3. Data flow

- `App.tsx`'s existing dashboard-tab effect (the one fetching `/api/adapters`, `/api/datapoints`, `/api/datasources` on the dashboard polling cadence) additionally fetches `/api/oee/status`; failures leave the value `null` without breaking the other fetches.
- New context field `oeeStatus: OeeStatusResponse | null` (+ setter) in `context/edge.ts` / `EdgeContext.tsx`, default `null`. **Superseded at implementation:** `oeeStatus` is App-local `useState` (dashboard-only data, following the `operationalRefreshedAt` precedent) — see the plan's Global Constraints.
- `DashboardTab` reads `oeeStatus` from context and passes it to `OperationalOverview`, which gains `oeeStatus` and `onOpenOee` props and renders `<OeeOverviewPanel …/>` as the fourth section.
- `App.tsx` passes `onOpenOee={() => setActiveTab('oee')}` down through `DashboardTab`.

## 4. Testing

- `OeeOverviewPanel.test.tsx`: state counts and rail rendered from a fake `OeeStatusResponse` (mixed states incl. a null `lastState`); breakdown sorted fault-first; clicking the total button fires `onOpenOee`; empty state at zero channels; unavailable state at `oeeStatus === null`.
- Gates: `pnpm test:ui`, `pnpm lint:ui`, `pnpm build:ui`. Backend untouched.

## 5. Out of scope

- DashboardDetailModal drilldown domain for OEE (navigate to the OEE tab instead).
- Any change to `/api/oee/status`, the status-strip items, or the queue-alert logic (they already reference the OEE outbox).
- Historical OEE metrics/analytics (cloud-side concern).
