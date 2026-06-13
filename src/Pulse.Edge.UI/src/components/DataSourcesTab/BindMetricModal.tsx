import React, { useState, useMemo } from 'react';
import { Search, AlertCircle } from 'lucide-react';
import type { DataSource, DataPoint, DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';
import { formatLiveValue } from './utils';

type ToastFn = ReturnType<typeof useToast>['toast'];

function streamThemeClass(type?: string): string {
  if (type === 'Production') return 'theme-production';
  if (type === 'Energy') return 'theme-energy';
  return 'theme-general';
}

interface BindMetricModalProps {
  dataSourceId: string;
  initialMetric: string;
  datasources: DataSource[];
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  fetchData: () => Promise<void>;
  toast: ToastFn;
  onClose: () => void;
}

export default function BindMetricModal({
  dataSourceId,
  initialMetric,
  datasources,
  datapoints,
  adapters,
  fetchData,
  toast,
  onClose
}: BindMetricModalProps) {
  const [newDpMetric, setNewDpMetric] = useState(initialMetric);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagAdapterFilter, setTagAdapterFilter] = useState('All');
  const [tagMappingFilter, setTagMappingFilter] = useState('Free');

  const activeDs = datasources.find(x => x.id === dataSourceId);
  const themeClass = streamThemeClass(activeDs?.type);

  const filteredDatapoints = useMemo(() => {
    return datapoints.filter(dp => {
      if (tagAdapterFilter !== 'All' && dp.adapterId !== tagAdapterFilter) return false;
      const isMapped = dp.dataSourceId && dp.dataSourceId !== '';
      if (tagMappingFilter === 'Free' && isMapped) return false;
      if (tagMappingFilter === 'Mapped' && !isMapped) return false;
      if (tagSearchQuery.trim() !== '') {
        const query = tagSearchQuery.toLowerCase();
        const addressMatch = dp.address?.toLowerCase().includes(query);
        const descMatch = dp.description ? dp.description.toLowerCase().includes(query) : false;
        const adp = adapters.find(a => a.id === dp.adapterId);
        const adapterMatch = adp ? adp.name.toLowerCase().includes(query) : false;
        const metricMatch = dp.metric ? dp.metric.toLowerCase().includes(query) : false;
        const streamMatch = dp.dataSourceId ? dp.dataSourceId.toLowerCase().includes(query) : false;
        if (!addressMatch && !descMatch && !adapterMatch && !metricMatch && !streamMatch) return false;
      }
      return true;
    });
  }, [datapoints, tagAdapterFilter, tagMappingFilter, tagSearchQuery, adapters]);

  const handleAddDataPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTagId || !dataSourceId || !newDpMetric) {
      toast.warning('Please select a physical tag and specify a metric key.');
      return;
    }

    const tagToBind = datapoints.find(dp => dp.id === selectedTagId);
    if (!tagToBind) {
      toast.error('Selected physical tag not found.');
      return;
    }

    try {
      const existingBoundDp = datapoints.find(
        dp => dp.dataSourceId === dataSourceId && dp.metric === newDpMetric
      );

      if (existingBoundDp && existingBoundDp.id !== selectedTagId) {
        const unbindRes = await fetch(`/api/datapoints/${existingBoundDp.id}`, { method: 'DELETE' });
        if (!unbindRes.ok) {
          toast.warning(`Note: Failed to unbind old tag for ${newDpMetric}. Binding new tag anyway.`);
        }
      }

      const payload = { ...tagToBind, dataSourceId: dataSourceId, metric: newDpMetric };
      const res = await fetch('/api/datapoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        toast.success('Physical tag bound to metric successfully.');
        fetchData();
        onClose();
      } else {
        toast.error('Failed to bind physical tag.');
      }
    } catch (err) {
      console.error('Failed to bind data point:', err);
      toast.error('Failed to bind data point.');
    }
  };

  const metricInputLocked = activeDs ? activeDs.type !== 'General' : false;

  return (
    <ModalShell
      title="Bind Metric Tag"
      subtitle="Establish a telemetry source driver tag mapping."
      size="wide"
      onClose={onClose}
    >
      <form onSubmit={handleAddDataPoint} className="form-stack">
        <div className={`bind-stream-banner ${themeClass}`}>
          <div>
            <span className="bind-stream-target-label">Target Stream</span>
            <span className="bind-stream-name">{activeDs?.name || dataSourceId}</span>
          </div>
          <span className={`bind-stream-id-badge ${themeClass}`}>
            ID: {dataSourceId}
          </span>
        </div>

        <div className="form-group form-group-flush form-group-stack">
          <label className="form-label form-label-bold">Select Connection Tag</label>
          {datapoints.length === 0 ? (
            <div className="confirm-warning-box">
              No physical tags configured. Please configure tags under the "Tags" tab first.
            </div>
          ) : (
            <>
              <div className="bind-filter-controls">
                <div className="bind-search-wrap">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Search tags by address, description, adapter..."
                    value={tagSearchQuery}
                    onChange={(e) => setTagSearchQuery(e.target.value)}
                    className="bind-search-input"
                  />
                </div>

                <div className="bind-filter-row">
                  <div className="bind-filter-col">
                    <label className="bind-filter-label">Connection / Adapter</label>
                    <CustomSelect
                      value={tagAdapterFilter}
                      onChange={setTagAdapterFilter}
                      options={[
                        { value: 'All', label: 'All Adapters' },
                        ...adapters.map(a => ({ value: a.id, label: `${a.name} (${a.protocol})` }))
                      ]}
                    />
                  </div>
                  <div className="bind-filter-col">
                    <label className="bind-filter-label">Mapping Status</label>
                    <div className="mapping-status-toggle">
                      {(['Free', 'All', 'Mapped'] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setTagMappingFilter(status)}
                          className={`mapping-status-btn${tagMappingFilter === status ? ' is-active' : ''}`}
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="tag-list-viewport">
                {filteredDatapoints.length === 0 ? (
                  <div className="tag-list-empty">
                    <AlertCircle size={24} />
                    No tags match the filter criteria.
                  </div>
                ) : (
                  filteredDatapoints.map(dp => {
                    const adp = adapters.find(a => a.id === dp.adapterId);
                    const isSelected = selectedTagId === dp.id;
                    const isMapped = dp.dataSourceId && dp.dataSourceId !== '';
                    const formattedValue = formatLiveValue(dp.lastValue, dp.dataType);

                    return (
                      <div
                        key={dp.id}
                        onClick={() => {
                          setSelectedTagId(dp.id);
                          if ((!newDpMetric || newDpMetric === '') && activeDs?.type === 'General') {
                            const rawAddress = dp.address || '';
                            const cleanMetric = rawAddress
                              .split(';').pop()?.split('=').pop()
                              ?.replace(/[^a-zA-Z0-9_/]/g, '_')
                              ?.replace(/\/+/g, '_')
                              ?.replace(/_+/g, '_')
                              ?.replace(/^_+|_+$/g, '')
                              ?.toLowerCase();
                            if (cleanMetric) setNewDpMetric(cleanMetric);
                          }
                        }}
                        className={`tag-item${isSelected ? ` is-selected ${themeClass}` : ''}`}
                      >
                        <div className="tag-item-top">
                          <div className="tag-item-left">
                            <div className={`tag-radio${isSelected ? ` is-checked ${themeClass}` : ''}`}>
                              {isSelected && <span className="check-mark">✓</span>}
                            </div>
                            <span className={`tag-item-address${isSelected ? ` is-selected ${themeClass}` : ''}`}>
                              {dp.address}
                            </span>
                          </div>

                          <div className="tag-item-badges">
                            {isMapped ? (
                              <span className="tag-mapping-badge is-mapped">
                                Mapped: {dp.dataSourceId} → {dp.metric}
                              </span>
                            ) : (
                              <span className="tag-mapping-badge is-free">Free</span>
                            )}
                          </div>
                        </div>

                        <div className="tag-item-details">
                          <div className="tag-detail-meta">
                            <span className="tag-adapter-badge">{adp ? adp.name : 'Unknown Adapter'}</span>
                            <span>{dp.dataType}</span>
                            <span>•</span>
                            <span>{dp.scanIntervalMs}ms</span>
                          </div>
                          {dp.lastValue !== undefined && dp.lastValue !== null && dp.lastValue !== '' && (
                            <div className="tag-live-indicator">
                              <span className="pulse-dot-live pulse-dot-xs" />
                              <span>Val: {formattedValue}</span>
                            </div>
                          )}
                        </div>

                        {dp.description && (
                          <div className="tag-item-desc-line">{dp.description}</div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        <div className="form-group form-group-flush">
          <label className="form-label form-label-bold">Metric Key (Identifier)</label>
          <input
            className={`form-input form-input-mono-readonly${metricInputLocked ? ' is-locked' : ''}`}
            type="text"
            placeholder="e.g. good_count, temperature, voltage"
            value={newDpMetric}
            onChange={(e) => setNewDpMetric(e.target.value)}
            required
            disabled={metricInputLocked}
          />
          {activeDs && activeDs.type !== 'General' && (
            <span className="form-hint-block">
              ℹ️ Fixed parameter defined by the <strong>{activeDs.type}</strong> template.
            </span>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="submit"
            disabled={datapoints.length === 0 || !selectedTagId || !newDpMetric}
            className="btn-dark-primary"
          >
            Bind Metric
          </button>
          <button
            type="button"
            onClick={() => { onClose(); setSelectedTagId(''); setNewDpMetric(''); }}
            className="btn-secondary btn-flex-1"
          >
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
