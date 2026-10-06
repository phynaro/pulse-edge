import { useState } from 'react';
import { Search } from 'lucide-react';
import type { DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

export interface SimulatorVariable {
  address: string;
  name: string;
  category: 'energy' | 'production';
  categoryLabel: string;
  dataType: string;
  unit: string;
  description: string;
  scanIntervalMs: number;
}

const SIMULATOR_VARIABLES: SimulatorVariable[] = [
  // Energy / Power Template
  {
    address: 'voltage',
    name: 'Voltage',
    category: 'energy',
    categoryLabel: 'Power & Energy',
    dataType: 'Float',
    unit: 'V',
    description: 'Simulated Line Voltage (V)',
    scanIntervalMs: 1000,
  },
  {
    address: 'current',
    name: 'Current',
    category: 'energy',
    categoryLabel: 'Power & Energy',
    dataType: 'Float',
    unit: 'A',
    description: 'Simulated Current (A)',
    scanIntervalMs: 1000,
  },
  {
    address: 'power',
    name: 'Active Power',
    category: 'energy',
    categoryLabel: 'Power & Energy',
    dataType: 'Float',
    unit: 'kW',
    description: 'Simulated Active Power (kW)',
    scanIntervalMs: 1000,
  },
  {
    address: 'energy',
    name: 'Accumulated Energy',
    category: 'energy',
    categoryLabel: 'Power & Energy',
    dataType: 'Double',
    unit: 'kWh',
    description: 'Simulated Accumulated Energy (kWh)',
    scanIntervalMs: 1000,
  },
  {
    address: 'power_factor',
    name: 'Power Factor',
    category: 'energy',
    categoryLabel: 'Power & Energy',
    dataType: 'Float',
    unit: '',
    description: 'Simulated Power Factor (0.00 - 1.00)',
    scanIntervalMs: 1000,
  },
  {
    address: 'frequency',
    name: 'Grid Frequency',
    category: 'energy',
    categoryLabel: 'Power & Energy',
    dataType: 'Float',
    unit: 'Hz',
    description: 'Simulated Grid Frequency (Hz)',
    scanIntervalMs: 1000,
  },

  // Production Template
  {
    address: 'running',
    name: 'Machine Running State',
    category: 'production',
    categoryLabel: 'Production & Machine State',
    dataType: 'Boolean',
    unit: '',
    description: 'Simulated Running Status (1=Running, 0=Stopped/Idle)',
    scanIntervalMs: 1000,
  },
  {
    address: 'total_count',
    name: 'Total Produced Count',
    category: 'production',
    categoryLabel: 'Production & Machine State',
    dataType: 'UInt32',
    unit: 'pcs',
    description: 'Simulated Total Produced Units Count (pcs)',
    scanIntervalMs: 1000,
  },
  {
    address: 'reject_count',
    name: 'Total Reject Count',
    category: 'production',
    categoryLabel: 'Production & Machine State',
    dataType: 'UInt32',
    unit: 'pcs',
    description: 'Simulated Defect / Reject Units Count (pcs)',
    scanIntervalMs: 1000,
  },
  {
    address: 'speed',
    name: 'Production Speed Rate',
    category: 'production',
    categoryLabel: 'Production & Machine State',
    dataType: 'Float',
    unit: 'pcs/min',
    description: 'Simulated Instantaneous Speed (pcs/min)',
    scanIntervalMs: 1000,
  },
  {
    address: 'fault_code',
    name: 'Machine Fault Code',
    category: 'production',
    categoryLabel: 'Production & Machine State',
    dataType: 'Int32',
    unit: '',
    description: 'Simulated Fault Code ID (0 = Normal, 1-3 = Fault)',
    scanIntervalMs: 1000,
  },
];

interface SimulatorConfiguringTag {
  address: string;
  name: string;
  tagName: string;
  dataType: string;
  scanIntervalMs: number;
  description: string;
}

interface SimulatorBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  toast: ToastFn;
  onSaveSuccess?: () => void;
}

export default function SimulatorBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  toast,
  onSaveSuccess
}: SimulatorBrowserModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVariables, setSelectedVariables] = useState<Record<string, SimulatorVariable>>({});
  const [step, setStep] = useState(1);
  const [configuringTags, setConfiguringTags] = useState<SimulatorConfiguringTag[]>([]);
  const [loading, setLoading] = useState(false);

  const activeAdapter = adapters.find(a => a.id === adapterId);

  // Parse template from activeAdapter configJson
  let template: 'energy' | 'production' = 'energy';
  if (activeAdapter && activeAdapter.configJson) {
    try {
      const config = JSON.parse(activeAdapter.configJson);
      if ((config.Template || '').toLowerCase() === 'production') {
        template = 'production';
      }
    } catch {
      template = 'energy';
    }
  }

  if (!isOpen) return null;

  // Show ONLY the variables belonging to the currently selected adapter's template
  const adapterVariables = SIMULATOR_VARIABLES.filter(v => v.category === template);

  const filteredVariables = adapterVariables.filter(v => {
    const term = searchTerm.trim().toLowerCase();
    return !term ||
      v.address.toLowerCase().includes(term) ||
      v.name.toLowerCase().includes(term) ||
      v.description.toLowerCase().includes(term);
  });

  const handleToggleVariable = (v: SimulatorVariable) => {
    setSelectedVariables(prev => {
      const next = { ...prev };
      if (next[v.address]) {
        delete next[v.address];
      } else {
        next[v.address] = v;
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    const allSelected = filteredVariables.every(v => selectedVariables[v.address]);
    if (allSelected) {
      setSelectedVariables(prev => {
        const next = { ...prev };
        filteredVariables.forEach(v => delete next[v.address]);
        return next;
      });
    } else {
      setSelectedVariables(prev => {
        const next = { ...prev };
        filteredVariables.forEach(v => { next[v.address] = v; });
        return next;
      });
    }
  };

  const handleNextStep = () => {
    const vars = Object.values(selectedVariables);
    if (vars.length === 0) return;

    setConfiguringTags(vars.map(v => ({
      address: v.address,
      name: v.name,
      tagName: v.address,
      dataType: v.dataType,
      scanIntervalMs: v.scanIntervalMs,
      description: v.description,
    })));
    setStep(2);
  };

  const handleUpdateConfiguringTag = (
    index: number,
    field: keyof SimulatorConfiguringTag,
    value: string | number
  ) => {
    setConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSaveTags = async () => {
    if (!adapterId) {
      toast.warning('Please select a connection driver adapter.');
      return;
    }

    setLoading(true);
    let successes = 0;
    let failures = 0;

    try {
      for (const tag of configuringTags) {
        const payload = {
          adapterId: adapterId,
          mqttDeviceId: null,
          dataSourceId: '',
          metric: '',
          address: tag.address,
          dataType: tag.dataType,
          scanIntervalMs: Number(tag.scanIntervalMs) || 1000,
          scaleFactor: 1.0,
          offset: 0.0,
          isEnabled: true,
          byteOrder: 'ABCD',
          description: tag.description,
          mqttParseMode: 'Plaintext',
          mqttJsonPath: null
        };

        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          successes++;
        } else {
          failures++;
        }
      }

      if (successes > 0) {
        if (failures > 0) toast.warning(`Registered ${successes} simulator tag(s); ${failures} failed.`);
        else toast.success(`Successfully registered ${successes} simulator tag(s).`);
        if (onSaveSuccess) onSaveSuccess();
        onClose();
      } else {
        toast.error('Failed to register simulator tags.');
      }
    } catch (err) {
      console.error('Failed to save simulator tags:', err);
      toast.error('Error saving simulator tags.');
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = Object.keys(selectedVariables).length;

  return (
    <ModalShell
      title="Browse Protocol Simulator Variables"
      subtitle={
        step === 1
          ? `Select simulated variables for ${activeAdapter?.name || 'Adapter'} (${template === 'energy' ? 'Power & Energy Template' : 'Production & Machine State Template'}).`
          : 'Configure tag attributes and polling frequency for selected simulator variables.'
      }
      size="browser"
      onClose={onClose}
    >
      {/* Top Bar showing current adapter info */}
      <div className="browser-top-bar" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Selected Adapter:
          </span>
          <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-primary)' }}>
            {activeAdapter?.name || 'Simulator Adapter'}
          </span>
          <span className="badge success badge-protocol" style={{ textTransform: 'capitalize', fontSize: '10px' }}>
            {template === 'energy' ? '⚡ Power & Energy Template' : '⚙️ Production Template'}
          </span>
        </div>
      </div>

      {step === 1 ? (
        <div className="browser-layout" style={{ flex: 1, minHeight: 0 }}>
          {/* Left Pane: Variable List */}
          <div className="browser-left-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="browser-search-wrap" style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexShrink: 0 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Filter variables by name, address, or description..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '32px', height: '34px', fontSize: '12px' }}
                />
              </div>
              <button
                type="button"
                onClick={handleSelectAll}
                className="btn-secondary btn-compact"
                style={{ height: '34px', whiteSpace: 'nowrap' }}
              >
                {filteredVariables.every(v => selectedVariables[v.address]) ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="browser-node-list" style={{ flex: 1, overflowY: 'auto' }}>
              {filteredVariables.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', opacity: 0.6, fontSize: '13px' }}>
                  No matching simulator variables found for this adapter.
                </div>
              ) : (
                filteredVariables.map((v) => {
                  const isSelected = !!selectedVariables[v.address];
                  return (
                    <div
                      key={v.address}
                      onClick={() => handleToggleVariable(v)}
                      className={`browser-node-item${isSelected ? ' is-selected' : ''}`}
                      style={{ cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="browser-checkbox"
                      />
                      <div className="browser-node-details" style={{ flex: 1 }}>
                        <div className="browser-node-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong>{v.name}</strong>
                          <code style={{ fontSize: '11px', opacity: 0.7, color: 'var(--primary-dark)' }}>{v.address}</code>
                          {v.unit && (
                            <span style={{ fontSize: '10px', background: 'rgba(0, 168, 120, 0.1)', color: '#00a878', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                              {v.unit}
                            </span>
                          )}
                        </div>
                        <div className="browser-node-id" style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'flex', gap: '12px', marginTop: '2px' }}>
                          <span>{v.description}</span>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{v.dataType}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Selected Variables Preview */}
          <div className="browser-right-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="browser-right-header" style={{ flexShrink: 0 }}>
              <span className="browser-section-label">Selected Variables ({selectedCount})</span>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setSelectedVariables({})} className="browser-clear-btn">
                  Clear All
                </button>
              )}
            </div>

            {selectedCount === 0 ? (
              <div className="browser-empty-right" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="browser-empty-icon" style={{ fontSize: '28px' }}>📋</span>
                <span className="browser-empty-text" style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px', textAlign: 'center' }}>
                  Select simulated variables on the left to register them as driver tags.
                </span>
              </div>
            ) : (
              <div className="browser-selected-list" style={{ flex: 1, overflowY: 'auto' }}>
                {Object.values(selectedVariables).map((v) => (
                  <div key={v.address} className="browser-selected-item">
                    <div className="browser-selected-details">
                      <div className="browser-selected-name">{v.name} ({v.address})</div>
                      <div className="browser-selected-id">{v.dataType} {v.unit ? `• ${v.unit}` : ''}</div>
                    </div>
                    <button type="button" onClick={() => handleToggleVariable(v)} className="btn-browser-remove">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* STEP 2: Configure Tag Attributes */
        <div className="browser-config-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <span className="browser-config-step-label" style={{ fontWeight: 700, fontSize: '13px', display: 'block', marginBottom: '10px' }}>
            Step 2: Configure Tag Names & Polling Interval
          </span>
          <div className="browser-config-wrap">
            <table className="browser-config-table">
              <thead>
                <tr>
                  <th>Variable Address</th>
                  <th>Tag Registry Name</th>
                  <th>Data Type</th>
                  <th>Scan Rate (ms)</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {configuringTags.map((tag, idx) => (
                  <tr key={tag.address}>
                    <td className="browser-cell-max">
                      <div className="browser-cell-name">{tag.name}</div>
                      <code style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{tag.address}</code>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={tag.tagName}
                        onChange={(e) => handleUpdateConfiguringTag(idx, 'tagName', e.target.value)}
                        className="browser-table-input"
                      />
                    </td>
                    <td className="browser-cell-w-dtype">
                      <CustomSelect
                        value={tag.dataType}
                        onChange={(val) => handleUpdateConfiguringTag(idx, 'dataType', val)}
                        className="is-compact"
                        options={[
                          { value: 'Float', label: 'Float' },
                          { value: 'Double', label: 'Double' },
                          { value: 'Int16', label: 'Int16' },
                          { value: 'UInt16', label: 'UInt16' },
                          { value: 'Int32', label: 'Int32' },
                          { value: 'UInt32', label: 'UInt32' },
                          { value: 'Boolean', label: 'Boolean' },
                        ]}
                      />
                    </td>
                    <td className="browser-cell-w-scan">
                      <input
                        type="number"
                        min={100}
                        value={tag.scanIntervalMs}
                        onChange={(e) => handleUpdateConfiguringTag(idx, 'scanIntervalMs', parseInt(e.target.value, 10) || 1000)}
                        className="browser-table-input"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={tag.description}
                        onChange={(e) => handleUpdateConfiguringTag(idx, 'description', e.target.value)}
                        placeholder="Optional description"
                        className="browser-table-input"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="browser-footer" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {step === 1 ? (
          <>
            <span className="browser-footer-count" style={{ fontSize: '12px', fontWeight: 600 }}>
              {selectedCount} variable(s) selected
            </span>
            <div className="browser-footer-btns" style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={onClose} className="btn-browser-cancel">
                Cancel
              </button>
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
            <span className="browser-footer-count" style={{ fontSize: '12px', fontWeight: 600 }}>
              {configuringTags.length} tag(s) configured
            </span>
            <div className="browser-footer-btns" style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={() => setStep(1)} className="btn-browser-cancel">
                Back
              </button>
              <button
                type="button"
                onClick={handleSaveTags}
                disabled={loading}
                className="btn-browser-save"
              >
                {loading ? 'Registering...' : 'Save & Register Tags'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
