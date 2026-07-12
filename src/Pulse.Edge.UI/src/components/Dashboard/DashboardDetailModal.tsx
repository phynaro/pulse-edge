import type { DataPoint, DataSource, DriverAdapter } from '../../types';
import ModalShell from '../ModalShell';
import { getAdapterHealth, getTagHealth, healthLabels, type AdapterHealth, type TagHealth } from './health';

export type DashboardDrilldown =
  | { domain: 'adapters'; filter: AdapterHealth | 'all' | 'protocol'; protocol?: string; label: string }
  | { domain: 'tags'; filter: TagHealth | 'all' | 'adapter'; adapterId?: string; label: string }
  | { domain: 'streams'; filter: 'enabled' | 'disabled' | 'all' | 'category'; category?: string; label: string };

interface Props { selection: DashboardDrilldown; adapters: DriverAdapter[]; datapoints: DataPoint[]; datasources: DataSource[]; onClose: () => void; }

const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Never';

export default function DashboardDetailModal({ selection, adapters, datapoints, datasources, onClose }: Props) {
  const adapterName = (id: string) => adapters.find(a => a.id === id)?.name || 'Unassigned';
  const adapterRows = adapters.filter(a => selection.domain === 'adapters' && (
    selection.filter === 'all' || (selection.filter === 'protocol' ? a.protocol === selection.protocol : getAdapterHealth(a) === selection.filter)
  ));
  const tagRows = datapoints.filter(t => selection.domain === 'tags' && (
    selection.filter === 'all' || (selection.filter === 'adapter' ? t.adapterId === selection.adapterId : getTagHealth(t) === selection.filter)
  ));
  const streamRows = datasources.filter(s => selection.domain === 'streams' && (
    selection.filter === 'all' || (selection.filter === 'category' ? s.type === selection.category : s.isEnabled === (selection.filter === 'enabled'))
  ));
  const count = selection.domain === 'adapters' ? adapterRows.length : selection.domain === 'tags' ? tagRows.length : streamRows.length;

  return <ModalShell title={selection.label} subtitle={`${count} matching ${selection.domain}`} onClose={onClose} size="xl" bodyClassName="ops-detail-body">
    {count === 0 ? <div className="ops-empty">No matching items.</div> : <div className="ops-detail-scroll"><table className="data-table is-compact ops-detail-table">
      {selection.domain === 'adapters' && <><thead><tr><th>Adapter</th><th>Protocol</th><th>Endpoint</th><th>State</th></tr></thead><tbody>{adapterRows.map(a => <tr key={a.id}><td><strong>{a.name}</strong></td><td>{a.protocol.replace('_', ' ')}</td><td className="cell-mono-secondary">{a.host}:{a.port}</td><td><span className={`ops-state is-${getAdapterHealth(a)}`}>{healthLabels[getAdapterHealth(a)]}</span></td></tr>)}</tbody></>}
      {selection.domain === 'tags' && <><thead><tr><th>Tag</th><th>Adapter</th><th>Type</th><th>State</th><th>Value / Error</th><th>Updated</th></tr></thead><tbody>{tagRows.map(t => <tr key={t.id}><td className="cell-mono-secondary"><strong>{t.address}</strong></td><td>{adapterName(t.adapterId)}</td><td>{t.dataType}</td><td><span className={`ops-state is-${getTagHealth(t)}`}>{healthLabels[getTagHealth(t)]}</span></td><td>{t.lastError || (t.lastValue ?? '—')}</td><td>{formatTime(t.lastUpdated)}</td></tr>)}</tbody></>}
      {selection.domain === 'streams' && <><thead><tr><th>Stream</th><th>Category</th><th>State</th><th>Bound Tags</th></tr></thead><tbody>{streamRows.map(s => <tr key={s.id}><td><strong>{s.name}</strong></td><td>{s.type}</td><td><span className={`ops-state is-${s.isEnabled ? 'live' : 'disabled'}`}>{s.isEnabled ? 'Enabled' : 'Disabled'}</span></td><td>{datapoints.filter(t => t.dataSourceId === s.id).length}</td></tr>)}</tbody></>}
    </table></div>}
  </ModalShell>;
}
