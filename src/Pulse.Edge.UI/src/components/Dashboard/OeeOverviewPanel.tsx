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
            title={`${counts[k]} ${STATE_LABELS[k]} machine${counts[k] === 1 ? '' : 's'}`}
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
