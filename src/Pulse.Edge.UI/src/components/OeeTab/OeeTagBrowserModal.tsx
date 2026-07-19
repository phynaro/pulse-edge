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
