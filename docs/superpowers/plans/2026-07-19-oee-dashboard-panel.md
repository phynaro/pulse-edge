# OEE Machines Dashboard Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "OEE machines" health panel to the Dashboard's overview grid — machine-state distribution, top-machines breakdown, outbox depth — with click-through to the OEE tab.

**Architecture:** New presentational `OeeOverviewPanel` (fourth `ops-health-panel`, same anatomy/classes as its three siblings) fed by `/api/oee/status` fetched in App's existing dashboard-cadence effect and held as **App-local state** (like `operationalRefreshedAt`), passed `App → DashboardTab → OperationalOverview → OeeOverviewPanel`. UI-only. Spec: `docs/superpowers/specs/2026-07-19-oee-dashboard-panel-design.md`.

**Tech Stack:** React 19 + Vite, vitest + Testing Library, app-level CSS in `src/Pulse.Edge.UI/src/index.css` (the `ops-*` family lives there, NOT in packages/pulse-ui).

## Global Constraints

- `pnpm test:ui` green, `pnpm lint:ui` zero errors, `pnpm build:ui` clean (repo root). Focused test: `npx vitest run OeeOverviewPanel` from `src/Pulse.Edge.UI`.
- UI-only; `/api/oee/status` and all backend code untouched; status strip and queue-alert logic untouched.
- State classification: `running|stopped|fault` from `lastState`; `nodata` when `lastState` is null. Disabled channels count into their `lastState` bucket (no separate bucket).
- Breakdown: top 3 machines, fault-first, then `pendingCount` descending, then name.
- `oeeStatus === null` (unloaded/failed) renders "OEE status unavailable" — never fabricated zeros. Zero channels renders "No OEE channels configured".
- **Approved deviation from spec §3:** `oeeStatus` is App-local `useState`, not a context field — dashboard-only data follows the `operationalRefreshedAt` precedent; context is for cross-tab data. Everything else per spec.
- State colors reuse existing tokens: running→`--good`, stopped→`--warn`, fault→`--danger`, nodata→`--text-light`.
- Branch `feature/oee-dashboard-panel`; never push to `main`.

## File Structure

| File | Responsibility |
|---|---|
| `src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.tsx` (new) | The panel (pure, props-driven) |
| `src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.test.tsx` (new) | Component tests |
| `src/Pulse.Edge.UI/src/index.css` | Grid 4th column + `is-running/is-stopped/is-fault/is-nodata` colors + small new classes |
| `src/Pulse.Edge.UI/src/components/Dashboard/OperationalOverview.tsx` | Pass-through props + render 4th section |
| `src/Pulse.Edge.UI/src/components/DashboardTab.tsx` | Prop plumbing |
| `src/Pulse.Edge.UI/src/App.tsx` | Fetch + state + props |

---

### Task 1: `OeeOverviewPanel` component + CSS

**Files:**
- Create: `src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.tsx`
- Modify: `src/Pulse.Edge.UI/src/index.css` (~line 822 grid; ~line 830 color block; ~line 845 media query; new classes at the end of the `ops-*` section)
- Test: `src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.test.tsx`

**Interfaces:**
- Consumes: `OeeStatusResponse` from `../../types` (`{ channels: OeeChannelStatus[]; outboxDepth: number }`, `OeeChannelStatus = { id, externalId, name, enabled, lastState, lastCode, lastStateChangedAt, nextSeq, pendingCount }`); `Gauge` from `lucide-react`.
- Produces (Task 2 relies on this): `export default function OeeOverviewPanel(props: { oeeStatus: OeeStatusResponse | null; onOpenOee: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OeeOverviewPanel from './OeeOverviewPanel';
import type { OeeStatusResponse } from '../../types';

const status: OeeStatusResponse = {
  outboxDepth: 7,
  channels: [
    { id: 1, externalId: 'l1', name: 'Filler',     enabled: true,  lastState: 'running', lastCode: null,  lastStateChangedAt: null, nextSeq: 10, pendingCount: 0 },
    { id: 2, externalId: 'l2', name: 'Capper',     enabled: true,  lastState: 'fault',   lastCode: 'E17', lastStateChangedAt: null, nextSeq: 5,  pendingCount: 4 },
    { id: 3, externalId: 'l3', name: 'Palletizer', enabled: true,  lastState: null,      lastCode: null,  lastStateChangedAt: null, nextSeq: 0,  pendingCount: 0 },
    { id: 4, externalId: 'l4', name: 'Labeler',    enabled: false, lastState: 'stopped', lastCode: null,  lastStateChangedAt: null, nextSeq: 2,  pendingCount: 3 },
  ],
};

describe('OeeOverviewPanel', () => {
  it('renders state labels, total, and outbox depth from status', () => {
    const { container } = render(<OeeOverviewPanel oeeStatus={status} onOpenOee={vi.fn()} />);
    expect(screen.getByText('OEE machines')).toBeInTheDocument();
    for (const label of ['running', 'stopped', 'fault', 'no data']) {
      // getAllBy: state labels legitimately appear in both the metric grid and breakdown rows
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByTitle('Open the OEE tab').textContent).toContain('4'); // total button
    expect(screen.getByText(/Outbox depth/)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    // The rail has one segment per state, in order.
    expect(container.querySelectorAll('.ops-segment-rail button')).toHaveLength(4);
  });

  it('sorts the breakdown fault-first', () => {
    const { container } = render(<OeeOverviewPanel oeeStatus={status} onOpenOee={vi.fn()} />);
    const rows = container.querySelectorAll('.ops-oee-breakdown button');
    expect(rows).toHaveLength(3); // top 3 of 4
    expect(rows[0].textContent).toContain('Capper');   // fault first
  });

  it('clicking the total button opens the OEE tab', () => {
    const onOpenOee = vi.fn();
    render(<OeeOverviewPanel oeeStatus={status} onOpenOee={onOpenOee} />);
    fireEvent.click(screen.getByTitle('Open the OEE tab'));
    expect(onOpenOee).toHaveBeenCalled();
  });

  it('shows the empty state at zero channels', () => {
    const onOpenOee = vi.fn();
    render(<OeeOverviewPanel oeeStatus={{ channels: [], outboxDepth: 0 }} onOpenOee={onOpenOee} />);
    expect(screen.getByText('No OEE channels configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open oee tab/i }));
    expect(onOpenOee).toHaveBeenCalled();
  });

  it('shows the unavailable state when status is null', () => {
    render(<OeeOverviewPanel oeeStatus={null} onOpenOee={vi.fn()} />);
    expect(screen.getByText('OEE status unavailable')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `src/Pulse.Edge.UI`): `npx vitest run OeeOverviewPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/Pulse.Edge.UI/src/components/Dashboard/OeeOverviewPanel.tsx
import { Gauge } from 'lucide-react';
import type { OeeStatusResponse } from '../../types';

type MachineState = 'running' | 'stopped' | 'fault' | 'nodata';

const STATE_ORDER: MachineState[] = ['running', 'stopped', 'fault', 'nodata'];
const STATE_LABELS: Record<MachineState, string> = {
  running: 'running', stopped: 'stopped', fault: 'fault', nodata: 'no data',
};

const pct = (value: number, total: number) => (total ? `${(value / total) * 100}%` : '0%');

function classify(lastState: string | null): MachineState {
  if (lastState === 'running' || lastState === 'stopped' || lastState === 'fault') return lastState;
  return 'nodata';
}

interface Props {
  oeeStatus: OeeStatusResponse | null;
  onOpenOee: () => void;
}

export default function OeeOverviewPanel({ oeeStatus, onOpenOee }: Props) {
  const channels = oeeStatus?.channels ?? [];

  if (!oeeStatus || channels.length === 0) {
    return (
      <section className="ops-health-panel is-oee">
        <header className="ops-panel-head">
          <div className="ops-panel-icon"><Gauge size={17} /></div>
          <div><h3>OEE machines</h3><p>Machine state &amp; delivery</p></div>
        </header>
        <div className="ops-empty-note">
          <span>{oeeStatus ? 'No OEE channels configured' : 'OEE status unavailable'}</span>
          <button type="button" className="btn-secondary text-xs" onClick={onOpenOee}>Open OEE tab</button>
        </div>
      </section>
    );
  }

  const counts: Record<MachineState, number> = { running: 0, stopped: 0, fault: 0, nodata: 0 };
  channels.forEach(c => { counts[classify(c.lastState)]++; });

  const topMachines = [...channels]
    .sort((a, b) =>
      (classify(a.lastState) === 'fault' ? 0 : 1) - (classify(b.lastState) === 'fault' ? 0 : 1) ||
      b.pendingCount - a.pendingCount ||
      a.name.localeCompare(b.name))
    .slice(0, 3);

  return (
    <section className="ops-health-panel is-oee">
      <header className="ops-panel-head">
        <div className="ops-panel-icon"><Gauge size={17} /></div>
        <div><h3>OEE machines</h3><p>Machine state &amp; delivery</p></div>
        <button className="ops-total" onClick={onOpenOee} title="Open the OEE tab">
          <strong>{channels.length}</strong><span>Total</span>
        </button>
      </header>
      <div className="ops-segment-rail" aria-label="Machine state distribution">
        {STATE_ORDER.map(k => (
          <button
            key={k}
            className={`is-${k}`}
            style={{ width: pct(counts[k], channels.length) }}
            title={`${counts[k]} ${STATE_LABELS[k]} machines`}
            onClick={onOpenOee}
          />
        ))}
      </div>
      <div className="ops-metric-grid">
        {STATE_ORDER.map(k => (
          <button key={k} onClick={onOpenOee} title={`Machines ${STATE_LABELS[k]} — open OEE tab`}>
            <span className={`ops-dot is-${k}`} /><b>{counts[k]}</b><small>{STATE_LABELS[k]}</small>
          </button>
        ))}
      </div>
      <div className="ops-breakdown ops-oee-breakdown">
        <div className="ops-breakdown-title"><span>Machines</span><span>State</span><span>Pending</span></div>
        {topMachines.map(c => (
          <button key={c.id} onClick={onOpenOee}>
            <span>{c.name}</span>
            <b className={classify(c.lastState) === 'fault' ? 'is-alert' : ''}>{STATE_LABELS[classify(c.lastState)]}</b>
            <b>{c.pendingCount}</b>
          </button>
        ))}
      </div>
      <div className="ops-oee-outbox">Outbox depth: <b>{oeeStatus.outboxDepth}</b></div>
    </section>
  );
}
```

- [ ] **Step 4: CSS additions in `src/Pulse.Edge.UI/src/index.css`**

All anchors are in the `ops-*` block (~lines 820-850); match the file's compact one-line style:

1. Grid gains a fourth column — replace the `.ops-overview-grid` rule (line ~822):

```css
.ops-overview-grid { display:grid; grid-template-columns:minmax(240px,.9fr) minmax(320px,1.2fr) minmax(250px,.95fr) minmax(230px,.85fr); gap:10px; margin-bottom:12px; }
```

2. In the `max-width:1100px` media query (line ~845), remove `.ops-health-panel.is-streams { grid-column:1/-1; }` (with four panels, a clean 2×2 needs no spanner). Keep the rest of that query intact. The `max-width:720px` query needs no change (`is-streams` there already resets to `grid-column:auto` — remove that now-redundant reset too).

3. Extend the state-color line (line ~830) with the four OEE states, following its exact pattern:

```css
.is-running { --ops-color:var(--good); }.is-stopped { --ops-color:var(--warn); }.is-fault { --ops-color:var(--danger); }.is-nodata { --ops-color:var(--text-light); }.ops-segment-rail .is-running { background:var(--good); }.ops-segment-rail .is-stopped { background:var(--warn); }.ops-segment-rail .is-fault { background:var(--danger); }.ops-segment-rail .is-nodata { background:var(--text-light); }
```

4. New classes appended after the existing breakdown rules — first check how `.ops-protocol-breakdown` / `.ops-tag-breakdown` declare their column templates (they set `grid-template-columns` on the title row and buttons) and mirror that selector form with three columns:

```css
.ops-oee-breakdown .ops-breakdown-title, .ops-oee-breakdown button { grid-template-columns:1fr 72px 56px; }
.ops-empty-note { display:flex; flex-direction:column; gap:8px; align-items:flex-start; padding:10px 4px; color:var(--text-muted); font-size:12.5px; }
.ops-oee-outbox { margin-top:6px; font-size:11.5px; color:var(--text-muted); }
```

If the existing breakdowns use a different mechanism (e.g. `display:grid` declared per-breakdown), adapt these selectors to match that mechanism exactly — the goal is identical row anatomy with three columns.

- [ ] **Step 5: Run tests to verify they pass**

Run (from `src/Pulse.Edge.UI`): `npx vitest run OeeOverviewPanel`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/Pulse.Edge.UI/src/components/Dashboard/ src/Pulse.Edge.UI/src/index.css
git commit -m "feat(oee): dashboard OEE machines health panel component"
```

---

### Task 2: Wire the panel into App → DashboardTab → OperationalOverview

**Files:**
- Modify: `src/Pulse.Edge.UI/src/App.tsx` (state ~line 132, effect ~lines 135-161, DashboardTab render ~line 491)
- Modify: `src/Pulse.Edge.UI/src/components/DashboardTab.tsx` (props interface + destructure + OperationalOverview render ~line 212)
- Modify: `src/Pulse.Edge.UI/src/components/Dashboard/OperationalOverview.tsx` (props + fourth section)

**Interfaces:**
- Consumes: Task 1's `OeeOverviewPanel` default export with props `{ oeeStatus: OeeStatusResponse | null; onOpenOee: () => void }`; `OeeStatusResponse` type; `setActiveTab` from `usePathRouting` (already in `EdgeInner`; `'oee'` is already a valid route).
- Produces: `DashboardTabProps` and `OperationalOverview` `Props` each gain `oeeStatus: OeeStatusResponse | null; onOpenOee: () => void;`.

- [ ] **Step 1: App.tsx — state and fetch**

1. Add to the type import from `'./types'` (find the existing `import type {...} from './types'`): `OeeStatusResponse`.
2. Next to `operationalRefreshedAt` (~line 132): `const [oeeStatus, setOeeStatus] = useState<OeeStatusResponse | null>(null);`
3. In `refreshOperationalData` (inside the `activeTab !== 'dashboard'` effect), append AFTER the existing try/catch, still inside the function — an independent fetch so an OEE failure never breaks the operational refresh and vice versa:

```tsx
      // OEE status rides the same cadence but fails independently (null = unavailable).
      try {
        const oeeRes = await fetch('/api/oee/status');
        if (active) setOeeStatus(oeeRes.ok ? await oeeRes.json() : null);
      } catch {
        if (active) setOeeStatus(null);
      }
```

4. In the `<DashboardTab … />` render (~line 491), add two props: `oeeStatus={oeeStatus}` and `onOpenOee={() => setActiveTab('oee')}`.

- [ ] **Step 2: DashboardTab.tsx — plumb through**

1. Add to the type import block: `OeeStatusResponse`.
2. Add to `DashboardTabProps`: `oeeStatus: OeeStatusResponse | null;` and `onOpenOee: () => void;`
3. Add both to the destructured parameters.
4. Extend the `OperationalOverview` render (~line 212):

```tsx
      <OperationalOverview adapters={adapters} datapoints={datapoints} datasources={datasources} onSelect={setDrilldown} oeeStatus={oeeStatus} onOpenOee={onOpenOee}/>
```

- [ ] **Step 3: OperationalOverview.tsx — fourth section**

1. Imports: `import OeeOverviewPanel from './OeeOverviewPanel';` and add `OeeStatusResponse` to the type import from `'../../types'`.
2. Extend `Props`: `interface Props { adapters: DriverAdapter[]; datapoints: DataPoint[]; datasources: DataSource[]; onSelect: (value: DashboardDrilldown) => void; oeeStatus: OeeStatusResponse | null; onOpenOee: () => void; }` and destructure the two new props.
3. Render as the last child of the `ops-overview-grid` div, after the `is-streams` section:

```tsx
    <OeeOverviewPanel oeeStatus={oeeStatus} onOpenOee={onOpenOee}/>
```

- [ ] **Step 4: Gates**

```bash
pnpm build:ui   # tsc catches any missed prop plumbing
pnpm test:ui    # all suites green (35 = 30 prior + 5 new)
pnpm lint:ui    # zero errors
```

- [ ] **Step 5: Visual sanity (recommended, not a gate)**

`./start-edge.sh`, open the dashboard, confirm the fourth panel renders in-grid at desktop width and wraps to 2×2 below ~1100px; with no channels configured the empty state shows; clicking anything in the panel lands on the OEE tab.

- [ ] **Step 6: Commit**

```bash
git add src/Pulse.Edge.UI/
git commit -m "feat(oee): wire OEE machines panel into dashboard overview"
```
