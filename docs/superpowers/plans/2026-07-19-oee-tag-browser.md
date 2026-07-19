# OEE Tag-Role Browser Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OEE channel modal's five plain tag dropdowns with a browse-per-role, single-select tag browser in the stream browser's `browser-*` style.

**Architecture:** New `OeeTagBrowserModal` component (search + adapter filter + live-value tag list, single-select, `ModalShell size="browser"`) reusing the existing `browser-*` CSS family; `OeeTab`'s `tagSelect` helper becomes a field row (chosen-tag display + Browse… button) driven by an `activeBrowseRole` state and a `ROLE_META` map. UI-only — form state, validation, save path, and backend untouched. Spec: `docs/superpowers/specs/2026-07-19-oee-tag-browser-design.md`.

**Tech Stack:** React 19 + Vite, vitest + Testing Library, PULSE design system (`browser-*` / `form-*` classes, `ModalShell`, `CustomSelect`).

## Global Constraints

- `pnpm lint:ui` zero errors; `pnpm test:ui` all green; `pnpm build:ui` clean (run from repo root). Focused test: `npx vitest run <Name>` from `src/Pulse.Edge.UI` (the `pnpm --filter … -- <file>` form does not filter in this repo).
- No backend changes; no changes to `BindMetricModal` or the shared CSS files.
- Stream binding is informational metadata in the list, never a filter; the modal must render correctly with `adapters = []` (adapter shown as "Unknown", filter offers only "All Adapters").
- `run` role: `allowClear = false`; fault/code/good/reject: `allowClear = true`.
- Modal stacking (browser modal above the channel modal) follows the established `CreateTagWizard` → protocol-browser pattern — no new z-index/CSS work.
- Branch `feature/oee-tag-browser`; never push to `main`.

## File Structure

| File | Responsibility |
|---|---|
| `src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.tsx` (new) | Single-select browser modal (search, adapter filter, list, footer actions) |
| `src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.test.tsx` (new) | Component tests |
| `src/Pulse.Edge.UI/src/components/OeeTab.tsx` | Field rows + Browse wiring + `adapters` prop |
| `src/Pulse.Edge.UI/src/components/OeeTab.test.tsx` | Extended coverage |
| `src/Pulse.Edge.UI/src/App.tsx` | Pass `adapters` to `OeeTab` |

---

### Task 1: `OeeTagBrowserModal` component

**Files:**
- Create: `src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.tsx`
- Test: `src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.test.tsx`

**Interfaces:**
- Consumes: `ModalShell` (`../ModalShell`), `CustomSelect` (`../CustomSelect`), `formatLiveValue(value: string | null | undefined, dataType: string): string` (`../DataSourcesTab/utils`), types `DataPoint`, `DriverAdapter` (`../../types`).
- Produces (Task 2 relies on this exact contract):

```ts
interface OeeTagBrowserModalProps {
  roleLabel: string;                    // e.g. "Run signal"
  roleHint: string;                     // e.g. "nonzero = running"
  currentTagId: string | null;          // pre-highlighted when editing
  allowClear: boolean;                  // Clear Binding button shown only when true
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  onSelect: (tagId: string | null) => void;  // null = cleared
  onClose: () => void;
}
export default function OeeTagBrowserModal(props: OeeTagBrowserModalProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OeeTagBrowserModal from './OeeTagBrowserModal';
import type { DataPoint, DriverAdapter } from '../../types';

const adapters = [
  { id: 'a1', name: 'PLC One', protocol: 'MODBUS_TCP' },
  { id: 'a2', name: 'Sim', protocol: 'SIMULATOR' },
] as DriverAdapter[];

const makeDp = (over: Partial<DataPoint>): DataPoint =>
  ({
    id: 'x', adapterId: 'a1', mqttDeviceId: null, dataSourceId: null, metric: null,
    address: 'addr', dataType: 'Boolean', scanIntervalMs: 1000, scaleFactor: 1, offset: 0,
    isEnabled: true, byteOrder: 'ABCD', mqttParseMode: 'Plaintext',
    ...over,
  }) as DataPoint;

const datapoints = [
  makeDp({ id: 'dp-run', address: 'running', description: 'Run bit', lastValue: 'True' }),
  makeDp({ id: 'dp-count', adapterId: 'a2', address: 'total_count', description: 'Good count', dataType: 'Int32', lastValue: '10000', dataSourceId: 'DS1', metric: 'good_count' }),
];

function renderModal(over: Partial<Parameters<typeof OeeTagBrowserModal>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <OeeTagBrowserModal
      roleLabel="Run signal"
      roleHint="nonzero = running"
      currentTagId={null}
      allowClear={false}
      datapoints={datapoints}
      adapters={adapters}
      onSelect={onSelect}
      onClose={onClose}
      {...over}
    />,
  );
  return { onSelect, onClose };
}

describe('OeeTagBrowserModal', () => {
  it('renders tag rows with adapter, type and stream metadata', () => {
    renderModal();
    expect(screen.getByText('Select Run signal Tag')).toBeInTheDocument();
    expect(screen.getByText('Run bit (running)')).toBeInTheDocument();
    expect(screen.getByText('PLC One')).toBeInTheDocument();
    expect(screen.getByText(/Stream: DS1 → good_count/)).toBeInTheDocument(); // informational, not a filter
  });

  it('search narrows the list', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/search tags/i), { target: { value: 'total' } });
    expect(screen.queryByText('Run bit (running)')).not.toBeInTheDocument();
    expect(screen.getByText('Good count (total_count)')).toBeInTheDocument();
  });

  it('adapter filter narrows the list', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /all adapters/i })); // CustomSelect trigger
    fireEvent.click(screen.getByRole('button', { name: /sim \(simulator\)/i }));
    expect(screen.queryByText('Run bit (running)')).not.toBeInTheDocument();
    expect(screen.getByText('Good count (total_count)')).toBeInTheDocument();
  });

  it('selecting a row then confirming fires onSelect with the tag id and closes', () => {
    const { onSelect, onClose } = renderModal();
    const confirm = screen.getByRole('button', { name: /use this tag/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByText('Run bit (running)'));
    fireEvent.click(confirm);
    expect(onSelect).toHaveBeenCalledWith('dp-run');
    expect(onClose).toHaveBeenCalled();
  });

  it('pre-highlights currentTagId and enables confirm immediately', () => {
    renderModal({ currentTagId: 'dp-count' });
    const selected = document.querySelector('.browser-node-item.is-selected');
    expect(selected?.textContent).toContain('Good count (total_count)');
    expect(screen.getByRole('button', { name: /use this tag/i })).toBeEnabled();
  });

  it('Clear Binding renders only when allowClear and fires onSelect(null)', () => {
    renderModal();
    expect(screen.queryByRole('button', { name: /clear binding/i })).not.toBeInTheDocument();

    const { onSelect, onClose } = renderModal({ allowClear: true, currentTagId: 'dp-run' });
    fireEvent.click(screen.getByRole('button', { name: /clear binding/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders sensibly with no adapters', () => {
    renderModal({ adapters: [] });
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0); // adapter name fallback
    expect(screen.getByRole('button', { name: /all adapters/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `src/Pulse.Edge.UI`): `npx vitest run OeeTagBrowserModal`
Expected: FAIL — module `./OeeTagBrowserModal` not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/Pulse.Edge.UI/src/components/OeeTab/OeeTagBrowserModal.tsx
import { useMemo, useState } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import type { DataPoint, DriverAdapter } from '../../types';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';
import { formatLiveValue } from '../DataSourcesTab/utils';

interface OeeTagBrowserModalProps {
  roleLabel: string;
  roleHint: string;
  currentTagId: string | null;
  allowClear: boolean;
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  onSelect: (tagId: string | null) => void;
  onClose: () => void;
}

/**
 * Single-select tag picker in the stream tag browser's visual style
 * (see DataSourcesTab/BindMetricModal.tsx). One tag per OEE role, so:
 * no checkboxes, no right-hand selection pane — click a row, confirm.
 */
export default function OeeTagBrowserModal({
  roleLabel,
  roleHint,
  currentTagId,
  allowClear,
  datapoints,
  adapters,
  onSelect,
  onClose,
}: OeeTagBrowserModalProps) {
  const [search, setSearch] = useState('');
  const [adapterFilter, setAdapterFilter] = useState('All');
  const [pendingId, setPendingId] = useState<string | null>(currentTagId);

  const filtered = useMemo(() => {
    return datapoints.filter(dp => {
      if (adapterFilter !== 'All' && dp.adapterId !== adapterFilter) return false;
      if (search.trim() !== '') {
        const query = search.toLowerCase();
        const adp = adapters.find(a => a.id === dp.adapterId);
        const matches =
          dp.address?.toLowerCase().includes(query) ||
          (dp.description ? dp.description.toLowerCase().includes(query) : false) ||
          (adp ? adp.name.toLowerCase().includes(query) : false) ||
          (dp.metric ? dp.metric.toLowerCase().includes(query) : false) ||
          (dp.dataSourceId ? dp.dataSourceId.toLowerCase().includes(query) : false);
        if (!matches) return false;
      }
      return true;
    });
  }, [datapoints, adapterFilter, search, adapters]);

  const pending = pendingId ? datapoints.find(dp => dp.id === pendingId) : undefined;

  return (
    <ModalShell
      title={`Select ${roleLabel} Tag`}
      subtitle={roleHint}
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="browser-search-wrap" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexShrink: 0 }}>
          <div className="tag-search-inner" style={{ flex: 1 }}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search tags by address, description, adapter..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="form-input"
            />
          </div>
          <div style={{ minWidth: '220px' }}>
            <CustomSelect
              value={adapterFilter}
              onChange={setAdapterFilter}
              options={[
                { value: 'All', label: 'All Adapters' },
                ...adapters.map(a => ({ value: a.id, label: `${a.name} (${a.protocol})` })),
              ]}
            />
          </div>
        </div>

        <div className="browser-node-list" style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="tag-list-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              <AlertCircle size={24} />
              <span>No tags match the filter criteria.</span>
            </div>
          ) : (
            filtered.map(dp => {
              const isSelected = pendingId === dp.id;
              const adp = adapters.find(a => a.id === dp.adapterId);
              const formattedValue = formatLiveValue(dp.lastValue, dp.dataType);
              return (
                <div
                  key={dp.id}
                  className={`browser-node-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => setPendingId(dp.id)}
                  style={{ padding: '8px 12px' }}
                >
                  <div className="browser-node-details">
                    <div className="browser-node-name">
                      {dp.description?.trim() ? `${dp.description.trim()} (${dp.address})` : dp.address}
                    </div>
                    <div className="browser-node-id" style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'flex', gap: '8px' }}>
                      <span>{adp?.name || 'Unknown'}</span>
                      <span>{dp.dataType}</span>
                      <span>•</span>
                      <span>{dp.scanIntervalMs}ms</span>
                      {dp.dataSourceId && (
                        <span>(Stream: {dp.dataSourceId} → {dp.metric})</span>
                      )}
                    </div>
                  </div>
                  {dp.lastValue !== undefined && dp.lastValue !== null && dp.lastValue !== '' && (
                    <span className="browser-type-chip">{formattedValue}</span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="browser-footer">
          <span className="browser-footer-count">{pending ? pending.address : 'No tag selected'}</span>
          <div className="browser-footer-btns">
            <button type="button" onClick={onClose} className="btn-browser-cancel">Cancel</button>
            {allowClear && (
              <button
                type="button"
                onClick={() => { onSelect(null); onClose(); }}
                className="btn-browser-cancel"
              >
                Clear Binding
              </button>
            )}
            <button
              type="button"
              disabled={!pendingId}
              onClick={() => { if (pendingId) { onSelect(pendingId); onClose(); } }}
              className={`btn-browser-next${pendingId ? ' is-ready' : ' is-empty'}`}
            >
              Use This Tag
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `src/Pulse.Edge.UI`): `npx vitest run OeeTagBrowserModal`
Expected: PASS (7 tests). If the `lastValue`/`description` fields trip TypeScript (they are optional diagnostics fields on `DataPoint`), check `src/Pulse.Edge.UI/src/types.ts` for the actual member names before changing anything — the `makeDp` cast covers construction, but the component must only use members that exist on the type.

- [ ] **Step 5: Commit**

```bash
git add src/Pulse.Edge.UI/src/components/OeeTab/
git commit -m "feat(oee): single-select tag browser modal in stream-browser style"
```

---

### Task 2: Wire browse-per-role into OeeTab

**Files:**
- Modify: `src/Pulse.Edge.UI/src/components/OeeTab.tsx` (replace `tagSelect`, add role meta + browse state + modal render, add `adapters` prop, drop the now-unused `CustomSelect` import)
- Modify: `src/Pulse.Edge.UI/src/App.tsx` (pass `adapters` — find the render with `grep -n "OeeTab" src/Pulse.Edge.UI/src/App.tsx`)
- Test: `src/Pulse.Edge.UI/src/components/OeeTab.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1's `OeeTagBrowserModal` props contract; `adapters` from `useEdge()` context already held by `App.tsx` (it is passed as a prop to sibling tabs — same pattern here).
- Produces: `OeeTabProps` becomes `{ datapoints: DataPoint[]; adapters: DriverAdapter[] }`.

- [ ] **Step 1: Extend the failing tests**

In `OeeTab.test.tsx`: every existing `render(<OeeTab datapoints={[]} />)` gains `adapters={[]}`. Then append (reusing the file's existing fetch-stub setup for `/api/oee/status` and `/api/oee/channels` — anchor on how the existing tests stub `fetch` and keep that mechanism):

```tsx
  it('opens the tag browser from a role field and applies the selection', async () => {
    const datapoints = [
      {
        id: 'dp-run', adapterId: 'a1', mqttDeviceId: null, dataSourceId: null, metric: null,
        address: 'running', description: 'Run bit', dataType: 'Boolean', scanIntervalMs: 1000,
        scaleFactor: 1, offset: 0, isEnabled: true, byteOrder: 'ABCD', mqttParseMode: 'Plaintext',
      },
    ] as DataPoint[];
    render(<OeeTab datapoints={datapoints} adapters={[]} />);

    fireEvent.click(await screen.findByRole('button', { name: /add channel/i }));
    // Five role fields, each with a Browse… button; the first is the run signal.
    fireEvent.click(screen.getAllByRole('button', { name: /browse/i })[0]);

    expect(await screen.findByText('Select Run signal Tag')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Run bit (running)'));
    fireEvent.click(screen.getByRole('button', { name: /use this tag/i }));

    // Browser closed; the run field row now shows the chosen tag.
    expect(screen.queryByText('Select Run signal Tag')).not.toBeInTheDocument();
    expect(screen.getByText(/Run bit \(running\)/)).toBeInTheDocument();
  });
```

Add the imports the new test needs (`fireEvent`, `DataPoint` type) following the file's existing import style.

- [ ] **Step 2: Run to verify failure**

Run (from `src/Pulse.Edge.UI`): `npx vitest run OeeTab.test`
Expected: FAIL — `adapters` prop unknown / no Browse… buttons rendered.

- [ ] **Step 3: Implement the OeeTab changes**

All edits in `src/Pulse.Edge.UI/src/components/OeeTab.tsx`:

1. Imports: remove `CustomSelect`; add `import OeeTagBrowserModal from './OeeTab/OeeTagBrowserModal';` and extend the type import to `import type { DataPoint, DriverAdapter, OeeChannel, OeeStatusResponse } from '../types';`
2. Props:

```tsx
interface OeeTabProps {
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
}

export default function OeeTab({ datapoints, adapters }: OeeTabProps) {
```

3. Below `emptyForm`, add the role metadata (module scope):

```tsx
type TagRole = 'run' | 'fault' | 'code' | 'good' | 'reject';

const ROLE_META: Record<TagRole, {
  label: string;
  hint: string;
  field: 'runDataPointId' | 'faultDataPointId' | 'codeDataPointId' | 'goodDataPointId' | 'rejectDataPointId';
  required: boolean;
}> = {
  run:    { label: 'Run signal',            hint: 'nonzero = running',                                    field: 'runDataPointId',    required: true },
  fault:  { label: 'Fault signal',          hint: 'nonzero = fault; leave unwired if the PLC has none',   field: 'faultDataPointId',  required: false },
  code:   { label: 'Fault/reason code tag', hint: 'passed through verbatim',                              field: 'codeDataPointId',   required: false },
  good:   { label: 'Good counter',          hint: 'cumulative totalizer',                                 field: 'goodDataPointId',   required: false },
  reject: { label: 'Reject counter',        hint: 'cumulative totalizer',                                 field: 'rejectDataPointId', required: false },
};

const ROLE_ORDER: TagRole[] = ['run', 'fault', 'code', 'good', 'reject'];
```

4. New state next to the other modal state: `const [activeBrowseRole, setActiveBrowseRole] = useState<TagRole | null>(null);`
5. Replace the whole `tagSelect` helper with:

```tsx
  const tagField = (role: TagRole) => {
    const meta = ROLE_META[role];
    const value = form[meta.field];
    const dp = value ? datapoints.find(d => d.id === value) : undefined;
    return (
      <div className="form-group form-group-flush" key={role}>
        <label className="form-label form-label-bold">{meta.label}{meta.required ? ' *' : ''}</label>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div className="form-input" style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: '2.25rem', cursor: 'default' }}>
            {dp ? (
              <span>
                {dp.description?.trim() ? `${dp.description.trim()} (${dp.address})` : dp.address}
                <span className="text-secondary"> · {dp.dataType}</span>
              </span>
            ) : value ? (
              <span className="text-secondary">Unknown tag ({value})</span>
            ) : (
              <span className="text-secondary">not wired</span>
            )}
          </div>
          <button type="button" className="btn-secondary btn-compact" onClick={() => setActiveBrowseRole(role)}>
            Browse…
          </button>
        </div>
        <span className="form-note">{meta.hint}</span>
      </div>
    );
  };
```

6. In the form JSX, replace the five `tagSelect(...)` calls with:

```tsx
            {ROLE_ORDER.map(role => tagField(role))}
```

7. Render the browser modal, stacked above the channel modal. Change the `{showModal && ( <ModalShell ...> ... </ModalShell> )}` block's wrapper to a fragment and append after the `</ModalShell>`:

```tsx
      {showModal && (
        <>
          <ModalShell /* ...existing channel modal unchanged... */>
            {/* existing form unchanged apart from item 6 */}
          </ModalShell>
          {activeBrowseRole && (
            <OeeTagBrowserModal
              roleLabel={ROLE_META[activeBrowseRole].label}
              roleHint={ROLE_META[activeBrowseRole].hint}
              currentTagId={form[ROLE_META[activeBrowseRole].field] || null}
              allowClear={!ROLE_META[activeBrowseRole].required}
              datapoints={datapoints}
              adapters={adapters}
              onSelect={tagId => {
                const field = ROLE_META[activeBrowseRole].field;
                setForm(f => ({ ...f, [field]: tagId ?? '' }));
              }}
              onClose={() => setActiveBrowseRole(null)}
            />
          )}
        </>
      )}
```

(Keep the existing ModalShell contents byte-identical except for item 6 — this step only adds the fragment wrapper and the stacked modal.)

8. `App.tsx`: on the `<OeeTab datapoints={datapoints} />` render, add `adapters={adapters}` (the `adapters` binding already exists in that scope — sibling tabs use it).

- [ ] **Step 4: Run tests to verify they pass**

Run (from `src/Pulse.Edge.UI`): `npx vitest run OeeTab.test` → PASS (3 tests). Then `npx vitest run OeeTagBrowserModal` → still 7/7.

- [ ] **Step 5: Full gates and commit**

```bash
pnpm test:ui    # all suites green
pnpm lint:ui    # zero errors
pnpm build:ui   # clean tsc + vite build
git add src/Pulse.Edge.UI/
git commit -m "feat(oee): browse-per-role tag picker replacing plain dropdowns"
```
