import { useState, useEffect } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import type { DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface DiscoveredTag {
  name: string;
  dataType: string;
  typeHex: string;
  dimensions: number[];
}

interface BacnetConfiguringTag {
  name: string;
  tagName: string;
  dataType: string;
  scanIntervalMs: number;
  description: string;
}

interface BacnetBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  toast: ToastFn;
  onSaveSuccess: () => void;
}

export default function BacnetBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  toast,
  onSaveSuccess
}: BacnetBrowserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [discoveredTags, setDiscoveredTags] = useState<DiscoveredTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Record<string, DiscoveredTag>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [step, setStep] = useState(1);
  const [configuringTags, setConfiguringTags] = useState<BacnetConfiguringTag[]>([]);

  const activeAdapter = adapters.find(a => a.id === adapterId);
  const selectedCount = Object.keys(selectedTags).length;

  const fetchBacnetTags = async (targetAdapterId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/adapters/bacnet/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId: targetAdapterId })
      });
      const data = await res.json();
      if (data.success) {
        setDiscoveredTags(data.tags || []);
      } else {
        setError(data.message || 'Failed to discover BACnet objects.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && adapterId) {
      setStep(1);
      setSelectedTags({});
      setSearchTerm('');
      fetchBacnetTags(adapterId);
    }
  }, [isOpen, adapterId]);

  const handleToggleTag = (tag: DiscoveredTag) => {
    setSelectedTags(prev => {
      const next = { ...prev };
      if (next[tag.name]) delete next[tag.name];
      else next[tag.name] = tag;
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredList: DiscoveredTag[]) => {
    setSelectedTags(prev => {
      const next = { ...prev };
      filteredList.forEach(tag => {
        next[tag.name] = tag;
      });
      return next;
    });
  };

  const handleDeselectAllFiltered = (filteredList: DiscoveredTag[]) => {
    setSelectedTags(prev => {
      const next = { ...prev };
      filteredList.forEach(tag => {
        delete next[tag.name];
      });
      return next;
    });
  };

  const handleNextStep = () => {
    const list = Object.values(selectedTags).map(tag => {
      const cleanName = tag.name.replace(/[^a-zA-Z0-9_]/g, '_');
      return {
        name: tag.name,
        tagName: cleanName,
        dataType: tag.dataType,
        scanIntervalMs: 1000,
        description: `BACnet object ${tag.name}`
      };
    });
    setConfiguringTags(list);
    setStep(2);
  };

  const handleUpdateConfiguringTag = (index: number, field: keyof BacnetConfiguringTag, value: any) => {
    setConfiguringTags(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const handleSaveTags = async () => {
    setLoading(true);
    let successes = 0;
    let failures = 0;

    for (const item of configuringTags) {
      const payload = {
        id: '',
        adapterId,
        mqttDeviceId: null,
        dataSourceId: '',
        metric: '',
        address: item.name,
        dataType: item.dataType,
        scanIntervalMs: item.scanIntervalMs,
        scaleFactor: 1.0,
        offset: 0.0,
        isEnabled: true,
        byteOrder: 'ABCD',
        description: item.description,
        mqttParseMode: 'Plaintext',
        mqttJsonPath: null
      };

      try {
        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) successes++;
        else failures++;
      } catch (err) {
        failures++;
      }
    }

    setLoading(false);

    if (successes > 0 && failures === 0) {
      toast.success(`Successfully registered ${successes} BACnet tags.`);
      onSaveSuccess();
    } else if (successes > 0) {
      toast.warning(`Registered ${successes} tags, but ${failures} failed.`);
      onSaveSuccess();
    } else {
      toast.error('Failed to register tags.');
    }
  };

  if (!isOpen) return null;

  const filtered = discoveredTags.filter(tag =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tag.dataType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <ModalShell
      title="BACnet Objects Discoverer"
      subtitle={activeAdapter ? `${activeAdapter.name} (${activeAdapter.host})` : undefined}
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      {step === 1 ? (
        <div className="browser-layout">
          <div className="browser-left-pane">
            <div className="browser-search-wrap" style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div className="tag-search-inner" style={{ flex: 1 }}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Filter discovered symbols by name or type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-input"
                />
              </div>
              {filtered.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button type="button" onClick={() => handleSelectAllFiltered(filtered)} className="btn-secondary text-xs">
                    Select All
                  </button>
                  <button type="button" onClick={() => handleDeselectAllFiltered(filtered)} className="btn-secondary text-xs">
                    Deselect All
                  </button>
                </div>
              )}
            </div>

            {loading && discoveredTags.length === 0 ? (
              <div className="browser-loading">
                <div className="opc-spinner" />
                <span className="browser-loading-text">Connecting to device and querying object database...</span>
              </div>
            ) : error ? (
              <div className="browser-error-state">
                <AlertTriangle color="var(--danger-color)" size={32} />
                <span className="browser-error-title">Discovery Failed</span>
                <span className="browser-error-desc">{error}</span>
                <button
                  type="button"
                  onClick={() => fetchBacnetTags(adapterId)}
                  className="btn-browser-retry"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div className="browser-node-section">
                <span className="browser-available-label">Discovered Objects ({filtered.length})</span>
                {filtered.length === 0 ? (
                  <div className="browser-folder-empty">
                    {discoveredTags.length === 0 ? 'No BACnet objects were discovered. Verify connection settings.' : 'No objects match your filter.'}
                  </div>
                ) : (
                  <div className="browser-node-list">
                    {filtered.map((tag) => {
                      const isSelected = !!selectedTags[tag.name];
                      return (
                        <div
                          key={tag.name}
                          className={`browser-node-item${isSelected ? ' is-selected' : ''}`}
                          onClick={() => handleToggleTag(tag)}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleTag(tag)}
                            className="browser-checkbox"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="browser-node-details">
                            <div className="browser-node-name">{tag.name}</div>
                            <div className="browser-node-id" style={{ color: 'var(--text-muted)' }}>
                              Type: {tag.dataType} (Hex: {tag.typeHex})
                            </div>
                          </div>
                          {tag.dataType && <span className="browser-type-chip">{tag.dataType}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="browser-right-pane">
            <div className="browser-right-header">
              <span className="browser-section-label">Selected Objects ({selectedCount})</span>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setSelectedTags({})} className="browser-clear-btn">
                  Clear All
                </button>
              )}
            </div>
            {selectedCount === 0 ? (
              <div className="browser-empty-right">
                <span className="browser-empty-icon">📋</span>
                <span className="browser-empty-text">Select BACnet objects on the left to add them as registry tags.</span>
              </div>
            ) : (
              <div className="browser-selected-list">
                {Object.values(selectedTags).map((tag) => (
                  <div key={tag.name} className="browser-selected-item">
                    <div className="browser-selected-details">
                      <div className="browser-selected-name">{tag.name}</div>
                      <div className="browser-selected-id">{tag.dataType}</div>
                    </div>
                    <button type="button" onClick={() => handleToggleTag(tag)} className="btn-browser-remove">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="browser-config-body">
          <span className="browser-config-step-label">Step 2: Configure BACnet Object Parameters</span>
          <div className="browser-config-wrap">
            <table className="browser-config-table">
              <thead>
                <tr>
                  <th>BACnet Address</th>
                  <th>Tag Registry Name</th>
                  <th>Data Type</th>
                  <th>Scan Rate (ms)</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {configuringTags.map((tag, idx) => (
                  <tr key={tag.name}>
                    <td className="browser-cell-max">
                      <div className="browser-cell-name">{tag.name}</div>
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
                          { value: 'String', label: 'String' }
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

      <div className="browser-footer">
        {step === 1 ? (
          <>
            <span className="browser-footer-count">{selectedCount} symbols selected</span>
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
            <span className="browser-footer-count">{configuringTags.length} tags configured</span>
            <div className="browser-footer-btns">
              <button type="button" onClick={() => setStep(1)} className="btn-browser-cancel">Back</button>
              <button
                type="button"
                onClick={handleSaveTags}
                disabled={loading}
                className="btn-browser-save"
              >
                {loading ? 'Saving...' : 'Save & Register Tags'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
