import { useState, useMemo } from 'react';
import { Search, AlertCircle } from 'lucide-react';
import type { DataSource, DataPoint, DriverAdapter, StreamTemplate } from '../../types';
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

interface ConfiguringBinding {
  tagId: string;
  address: string;
  dataType: string;
  metric: string;
}

interface BindMetricModalProps {
  dataSourceId: string;
  initialMetric: string;
  datasources: DataSource[];
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  templates: StreamTemplate[];
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
  templates,
  fetchData,
  toast,
  onClose
}: BindMetricModalProps) {
  const [step, setStep] = useState(1);
  const [selectedTagIds, setSelectedTagIds] = useState<Record<string, boolean>>({});
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagAdapterFilter, setTagAdapterFilter] = useState('All');
  const [tagMappingFilter, setTagMappingFilter] = useState('Free');
  const [configuringBindings, setConfiguringBindings] = useState<ConfiguringBinding[]>([]);
  const [loading, setLoading] = useState(false);

  const activeDs = datasources.find(x => x.id === dataSourceId);
  const themeClass = streamThemeClass(activeDs?.type);
  const matchingTemplate = templates.find(t => t.id === activeDs?.type);
  const isTemplate = !!matchingTemplate && activeDs?.type !== 'General';

  let expectedParams: string[] = [];
  if (matchingTemplate) {
    try {
      expectedParams = JSON.parse(matchingTemplate.parametersJson) || [];
    } catch (e) {
      console.error('Failed to parse template parameters:', e);
    }
  }

  const selectedCount = Object.keys(selectedTagIds).length;

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

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds(prev => {
      const next = { ...prev };
      if (next[tagId]) {
        delete next[tagId];
      } else {
        next[tagId] = true;
      }
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredList: DataPoint[]) => {
    setSelectedTagIds(prev => {
      const next = { ...prev };
      filteredList.forEach(dp => {
        next[dp.id] = true;
      });
      return next;
    });
  };

  const handleDeselectAllFiltered = (filteredList: DataPoint[]) => {
    setSelectedTagIds(prev => {
      const next = { ...prev };
      filteredList.forEach(dp => {
        delete next[dp.id];
      });
      return next;
    });
  };

  const handleNextStep = () => {
    const selectedList = Object.keys(selectedTagIds);
    if (selectedList.length === 0) {
      toast.warning('Please select at least one physical tag to configure.');
      return;
    }

    const bindings = selectedList.map((tagId, index) => {
      const dp = datapoints.find(x => x.id === tagId);
      const address = dp?.address || '';

      // Auto-populate default metric key
      let metric = '';
      if (isTemplate) {
        if (index === 0 && initialMetric) {
          metric = initialMetric;
        } else {
          // Find first template parameter that isn't already mapped, or default to the first parameter
          const unmapped = expectedParams.find(p => !datapoints.some(d => d.dataSourceId === dataSourceId && d.metric === p));
          metric = unmapped || expectedParams[0] || '';
        }
      } else {
        if (index === 0 && initialMetric) {
          metric = initialMetric;
        } else {
          const rawAddress = dp?.address || '';
          metric = rawAddress
            .split(';').pop()?.split('=').pop()
            ?.replace(/[^a-zA-Z0-9_/]/g, '_')
            ?.replace(/\/+/g, '_')
            ?.replace(/_+/g, '_')
            ?.replace(/^_+|_+$/g, '')
            ?.toLowerCase() || '';
        }
      }

      return {
        tagId,
        address,
        dataType: dp?.dataType || 'Float',
        metric
      };
    });

    setConfiguringBindings(bindings);
    setStep(2);
  };

  const handleUpdateBindingMetric = (index: number, val: string) => {
    setConfiguringBindings(prev => {
      const next = [...prev];
      next[index] = { ...next[index], metric: val };
      return next;
    });
  };

  const handleSaveBindings = async () => {
    setLoading(true);
    try {
      const invalid = configuringBindings.some(b => !b.metric || b.metric.trim() === '');
      if (invalid) {
        toast.error('All physical tags must have a metric key assigned.');
        setLoading(false);
        return;
      }

      const payload = {
        dataSourceId,
        bindings: configuringBindings.map(b => ({
          dataPointId: b.tagId,
          metric: b.metric.trim()
        }))
      };

      const res = await fetch('/api/datapoints/bulk-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        toast.success(`Successfully bound ${configuringBindings.length} physical tags to metrics.`);
        await fetchData();
        onClose();
      } else {
        const errorData = await res.json().catch(() => ({}));
        toast.error(errorData.message || 'Failed to bind physical tags to metrics.');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'An unknown error occurred.';
      toast.error('An error occurred: ' + errMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell
      title="Bind Metric Tag"
      subtitle={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', verticalAlign: 'middle' }}>
          <span>Establish a telemetry source driver tag mapping.</span>
          <span className={`bind-stream-id-badge ${themeClass}`} style={{ padding: '2px 6px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', height: 'auto', lineHeight: 'normal' }}>
            STREAM: {activeDs?.name || dataSourceId}
          </span>
          <span className={`bind-stream-id-badge ${themeClass}`} style={{ padding: '2px 6px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', height: 'auto', lineHeight: 'normal' }}>
            ID: {dataSourceId}
          </span>
        </span>
      }
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      <div className="form-stack" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

        {step === 1 ? (
          <div className="browser-layout" style={{ flex: 1, minHeight: 0 }}>
            <div className="browser-left-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <div className="browser-search-wrap" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexShrink: 0 }}>
                <div className="tag-search-inner" style={{ flex: 1 }}>
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Search tags by address, description, adapter..."
                    value={tagSearchQuery}
                    onChange={(e) => setTagSearchQuery(e.target.value)}
                    className="form-input"
                  />
                </div>
                {filteredDatapoints.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button type="button" onClick={() => handleSelectAllFiltered(filteredDatapoints)} className="btn-secondary text-xs">
                      Select All
                    </button>
                    <button type="button" onClick={() => handleDeselectAllFiltered(filteredDatapoints)} className="btn-secondary text-xs">
                      Deselect All
                    </button>
                  </div>
                )}
              </div>

              <div className="bind-filter-row" style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem', flexShrink: 0 }}>
                <div className="bind-filter-col" style={{ flex: 1 }}>
                  <label className="bind-filter-label" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Connection / Adapter</label>
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
                  <label className="bind-filter-label" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mapping Status</label>
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

              <div className="browser-node-list" style={{ flex: 1, overflowY: 'auto' }}>
                {filteredDatapoints.length === 0 ? (
                  <div className="tag-list-empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    <AlertCircle size={24} />
                    <span>No tags match the filter criteria.</span>
                  </div>
                ) : (
                  filteredDatapoints.map(dp => {
                    const isSelected = !!selectedTagIds[dp.id];
                    const isMapped = dp.dataSourceId && dp.dataSourceId !== '';
                    const formattedValue = formatLiveValue(dp.lastValue, dp.dataType);
                    const adp = adapters.find(a => a.id === dp.adapterId);

                    return (
                      <div
                        key={dp.id}
                        className={`browser-node-item${isSelected ? ' is-selected' : ''}`}
                        onClick={() => handleToggleTag(dp.id)}
                        style={{ padding: '8px 12px' }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleTag(dp.id)}
                          className="browser-checkbox"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="browser-node-details">
                          <div className="browser-node-name">{dp.address}</div>
                          <div className="browser-node-id" style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'flex', gap: '8px' }}>
                            <span>{adp?.name || 'Unknown'}</span>
                            <span>{dp.dataType}</span>
                            <span>•</span>
                            <span>{dp.scanIntervalMs}ms</span>
                            {isMapped && (
                              <span style={{ color: 'var(--warning-color)' }}>
                                (Mapped: {dp.dataSourceId} → {dp.metric})
                              </span>
                            )}
                          </div>
                        </div>
                        {dp.lastValue !== undefined && dp.lastValue !== null && dp.lastValue !== '' && (
                          <span className="browser-type-chip">Val: {formattedValue}</span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="browser-right-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
              <div className="browser-right-header" style={{ flexShrink: 0 }}>
                <span className="browser-section-label">Selected Tags ({selectedCount})</span>
                {selectedCount > 0 && (
                  <button type="button" onClick={() => setSelectedTagIds({})} className="browser-clear-btn">
                    Clear All
                  </button>
                )}
              </div>
              {selectedCount === 0 ? (
                <div className="browser-empty-right" style={{ flex: 1 }}>
                  <span className="browser-empty-icon">📋</span>
                  <span className="browser-empty-text">Select physical driver tags on the left to bind them to telemetry metrics.</span>
                </div>
              ) : (
                <div className="browser-selected-list" style={{ flex: 1, overflowY: 'auto' }}>
                  {Object.keys(selectedTagIds).map((tagId) => {
                    const dp = datapoints.find(x => x.id === tagId);
                    if (!dp) return null;
                    return (
                      <div key={tagId} className="browser-selected-item">
                        <div className="browser-selected-details">
                          <div className="browser-selected-name">{dp.address}</div>
                          <div className="browser-selected-id">{dp.dataType}</div>
                        </div>
                        <button type="button" onClick={() => handleToggleTag(tagId)} className="btn-browser-remove">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="browser-config-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <span className="browser-config-step-label">Step 2: Define Metric Keys</span>
            <div className="browser-config-wrap">
              <table className="browser-config-table">
                <thead>
                  <tr>
                    <th>Connection Tag Address</th>
                    <th>Data Type</th>
                    <th>Metric Key (Telemetry Identifier)</th>
                  </tr>
                </thead>
                <tbody>
                  {configuringBindings.map((binding, idx) => (
                    <tr key={binding.tagId}>
                      <td className="browser-cell-max">
                        <div className="browser-cell-name">{binding.address}</div>
                      </td>
                      <td style={{ width: '120px', color: 'var(--text-muted)', fontSize: '13px' }}>
                        {binding.dataType}
                      </td>
                      <td>
                        {isTemplate ? (
                          <div className="browser-cell-w-dtype" style={{ width: '100%' }}>
                            <CustomSelect
                              value={binding.metric}
                              onChange={(val) => handleUpdateBindingMetric(idx, val)}
                              className="is-compact"
                              options={expectedParams.map(p => ({ value: p, label: p }))}
                            />
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={binding.metric}
                            onChange={(e) => handleUpdateBindingMetric(idx, e.target.value)}
                            placeholder="e.g. temperature, voltage"
                            className="browser-table-input"
                            style={{ width: '100%' }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="browser-footer" style={{ marginTop: '1rem' }}>
          {step === 1 ? (
            <>
              <span className="browser-footer-count">{selectedCount} tags selected</span>
              <div className="browser-footer-btns">
                <button type="button" onClick={onClose} className="btn-browser-cancel">Cancel</button>
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={selectedCount === 0}
                  className={`btn-browser-next${selectedCount === 0 ? ' is-empty' : ' is-ready'}`}
                >
                  Next Step →
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="browser-footer-count">{configuringBindings.length} tags configured</span>
              <div className="browser-footer-btns">
                <button type="button" onClick={() => setStep(1)} className="btn-browser-cancel">Back</button>
                <button
                  type="button"
                  onClick={handleSaveBindings}
                  disabled={loading}
                  className="btn-browser-save"
                >
                  {loading ? 'Binding...' : 'Save & Bind Metrics'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
