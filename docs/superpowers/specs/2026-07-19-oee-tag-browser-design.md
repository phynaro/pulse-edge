# OEE Tag-Role Browser Picker — Design Spec

**Date:** 2026-07-19
**Status:** Approved design, pending implementation plan
**Context:** `src/Pulse.Edge.UI/src/components/OeeTab.tsx` (current pickers: five plain `CustomSelect` dropdowns), pattern source `src/Pulse.Edge.UI/src/components/DataSourcesTab/BindMetricModal.tsx` (the stream tag browser)

---

## 1. Goal

Replace the OEE channel modal's five plain tag dropdowns with the stream tag browser's picking experience: searchable, adapter-filterable tag list with live values, in the established `browser-*` modal style. UI-only — the channel form state, validation, save path, and backend are untouched.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Interaction model | **Browse per role**: each role field shows the chosen tag + a "Browse…" button opening a single-select browser modal |
| Code structure | New focused component reusing the `browser-*` CSS family; `BindMetricModal` is NOT refactored into a shared abstraction (two consumers with different selection semantics don't justify it) |
| Stream-mapping filter | Not carried over — a tag serving both telemetry and OEE is normal; stream binding is shown as informational metadata only |

## 2. New component — `OeeTagBrowserModal`

`src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.tsx` (OeeTab moves toward the sibling folder convention; `OeeTab.tsx` itself stays where it is).

```ts
interface OeeTagBrowserModalProps {
  roleLabel: string;                    // e.g. "Run signal"
  roleHint: string;                     // e.g. "nonzero = running"
  currentTagId: string | null;          // pre-highlighted when editing
  allowClear: boolean;                  // true for optional roles (fault/code/good/reject)
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  onSelect: (tagId: string | null) => void;  // null = cleared (only when allowClear)
  onClose: () => void;
}
```

Renders `ModalShell size="browser"` with `bodyClassName="browser-modal-body"`, title `Select {roleLabel} Tag`, subtitle = `roleHint`. Anatomy mirrors `BindMetricModal`'s left pane, full-width (no right pane — single select):

- **Search** (`tag-search-inner` + `form-input`): matches address, description, adapter name, metric, stream id — same predicate as `BindMetricModal.filteredDatapoints`.
- **Adapter filter** (`CustomSelect`): "All Adapters" + `{name} ({protocol})` per adapter.
- **Tag list** (`browser-node-list` / `browser-node-item`): name line = `description (address)` or `address`; metadata line = adapter name, data type, `scanIntervalMs`ms; live value chip via `formatLiveValue` (imported from `../DataSourcesTab/utils`); when the tag is stream-bound, a muted informational note `(Stream: {dataSourceId} → {metric})` — no filtering on it.
- **Selection**: clicking a row sets it as the pending selection (`is-selected` highlight; no checkboxes). `currentTagId` is the initial pending selection.
- **Footer** (`browser-footer`): left, the pending selection's address (or "No tag selected"); right, `Cancel`, optional `Clear Binding` (rendered only when `allowClear`, calls `onSelect(null)` and closes), and primary `Use This Tag` (disabled until a pending selection exists; calls `onSelect(id)` and closes).

Empty-filter state reuses the `tag-list-empty` presentation ("No tags match the filter criteria.").

## 3. Changes in `OeeTab.tsx`

- The `tagSelect` helper is replaced by a field-row renderer per role: role label (+ `*` for run), a compact display of the bound tag — `description (address)` + data type, or muted `not wired` — and a **Browse…** button (`btn-secondary`).
- New state: `activeBrowseRole: 'run' | 'fault' | 'code' | 'good' | 'reject' | null`. The modal renders when non-null with that role's label/hint/current value; `allowClear` is false for `run`, true otherwise. `onSelect` writes the id (or empty string for null) into the existing `form` field for that role.
- Role labels/hints stay the current wording (e.g. "Fault signal (nonzero = fault; leave unwired if the PLC has none)" splits into label "Fault signal" + hint "nonzero = fault; leave unwired if the PLC has none").
- `adapters` sourcing: the same way sibling tabs get them (context `useEdge()` or a prop from `App.tsx` — whichever `TagsTab` uses; resolved in the plan, not invented here). Adapter data may be empty when the Protocols tab hasn't polled yet — the modal must render fine with `adapters = []` (filter shows only "All Adapters"; metadata line shows "Unknown" like `BindMetricModal` does).
- Save path, validation, API calls: unchanged. Modal stacking (browser modal above the channel modal) follows the established `CreateTagWizard` → protocol-browser pattern.

## 4. Testing

- New `OeeTagBrowserModal.test.tsx`: renders tag rows from props; search narrows the list; adapter filter narrows the list; clicking a row then "Use This Tag" fires `onSelect` with the id; `Clear Binding` fires `onSelect(null)` and only renders when `allowClear`; `currentTagId` row starts highlighted.
- `OeeTab.test.tsx`: extend — clicking a role's Browse… opens the modal; selecting a tag updates the field row display. Existing 2 tests keep passing.
- Gates: `pnpm lint:ui`, `pnpm test:ui`, `pnpm build:ui`, backend untouched (no dotnet changes).

## 5. Out of scope

- Refactoring `BindMetricModal` or extracting a shared browser core (revisit at a third consumer).
- Backend/API changes, protocol browse-from-device (OPC UA/S7 discovery) inside the OEE picker — commissioned tags only.
- Multi-role assignment flow (rejected during brainstorming in favor of browse-per-role).
