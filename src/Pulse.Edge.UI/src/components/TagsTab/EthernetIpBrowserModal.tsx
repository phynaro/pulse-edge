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
  templateId?: number;
}

interface EipConfiguringTag {
  name: string;
  tagName: string;
  dataType: string;
  scanIntervalMs: number;
  description: string;
}

interface EthernetIpBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  toast: ToastFn;
  onSaveSuccess: () => void;
}

interface BrowseTreeNodeProps {
  name: string;
  label: string;
  dataType: string;
  isStructure: boolean;
  templateId?: number;
  dimensions?: number[];
  adapterId: string;
  onToggleSelect: (name: string, dataType: string) => void;
  selectedTags: Record<string, DiscoveredTag>;
}

function BrowseTreeNode({
  name,
  label,
  dataType,
  isStructure,
  templateId,
  dimensions,
  adapterId,
  onToggleSelect,
  selectedTags
}: BrowseTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleExpand = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }

    setIsExpanded(true);

    if (isStructure && templateId && children.length === 0) {
      setLoading(true);
      try {
        const res = await fetch('/api/adapters/ethernetip/template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adapterId, templateId })
        });
        const data = await res.json();
        if (data.success) {
          setChildren(data.members || []);
        }
      } catch (err) {
        console.error("Failed to load struct members:", err);
      } finally {
        setLoading(false);
      }
    }
  };

  const hasArray = dimensions && dimensions.length > 0 && dimensions[0] > 0;
  const isExpandable = isStructure || hasArray;
  const isSelected = !!selectedTags[name];

  return (
    <div className="tree-node" style={{ display: 'flex', flexDirection: 'column' }}>
      <div 
        className={`browser-node-item${isSelected ? ' is-selected' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '6px 12px', minHeight: '40px' }}
        onClick={() => {
          if (!isStructure || hasArray) {
            onToggleSelect(name, dataType);
          } else {
            handleExpand({ stopPropagation: () => {} } as any);
          }
        }}
      >
        {isExpandable ? (
          <button 
            type="button" 
            onClick={handleExpand} 
            className="btn-expand-chevron"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted, #94a3b8)',
              padding: '2px 6px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '20px'
            }}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <div style={{ width: '20px' }} />
        )}
        
        <input 
          type="checkbox" 
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            onToggleSelect(name, dataType);
          }}
          disabled={isStructure && !hasArray}
          className="browser-checkbox"
          onClick={(e) => e.stopPropagation()}
        />
        
        <div className="browser-node-details" style={{ flex: 1 }}>
          <div className="browser-node-name" style={{ fontSize: '13px', fontWeight: isStructure ? '600' : 'normal' }}>
            {label}
            {hasArray && ` [${dimensions[0]}]`}
          </div>
        </div>
        
        {dataType && (
          <span 
            className="browser-type-chip" 
            style={{ 
              fontSize: '10px', 
              padding: '2px 6px', 
              borderRadius: '4px', 
              background: isStructure ? 'rgba(14, 165, 233, 0.15)' : 'rgba(255, 255, 255, 0.08)',
              color: isStructure ? '#38bdf8' : 'var(--text-muted)'
            }}
          >
            {dataType}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="tree-node-children" style={{ paddingLeft: '1.25rem', borderLeft: '1px dashed rgba(255, 255, 255, 0.1)', marginLeft: '1.25rem' }}>
          {loading && (
            <div style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: '12px' }}>
              Loading members...
            </div>
          )}
          
          {isStructure && children.map(member => (
            <BrowseTreeNode 
              key={member.name}
              name={`${name}.${member.name}`}
              label={member.name}
              dataType={member.dataType}
              isStructure={member.isStructure}
              templateId={member.templateId}
              adapterId={adapterId}
              onToggleSelect={onToggleSelect}
              selectedTags={selectedTags}
            />
          ))}

          {hasArray && Array.from({ length: Math.min(dimensions[0], 256) }).map((_, idx) => (
            <BrowseTreeNode 
              key={idx}
              name={`${name}[${idx}]`}
              label={`[${idx}]`}
              dataType={dataType}
              isStructure={false}
              adapterId={adapterId}
              onToggleSelect={onToggleSelect}
              selectedTags={selectedTags}
            />
          ))}
          
          {hasArray && dimensions[0] > 256 && (
            <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Showing first 256 elements of {dimensions[0]}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EthernetIpBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  toast,
  onSaveSuccess
}: EthernetIpBrowserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [discoveredTags, setDiscoveredTags] = useState<DiscoveredTag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Record<string, DiscoveredTag>>({});

  const handleToggleNode = (name: string, dataType: string) => {
    setSelectedTags(prev => {
      const next = { ...prev };
      if (next[name]) {
        delete next[name];
      } else {
        next[name] = {
          name,
          dataType,
          typeHex: '0x00',
          dimensions: [],
          templateId: 0
        };
      }
      return next;
    });
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [step, setStep] = useState(1);
  const [configuringTags, setConfiguringTags] = useState<EipConfiguringTag[]>([]);

  const activeAdapter = adapters.find(a => a.id === adapterId);
  const selectedCount = Object.keys(selectedTags).length;

  const fetchPlcTags = async (targetAdapterId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/adapters/ethernetip/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId: targetAdapterId })
      });
      const data = await res.json();
      if (data.success) {
        setDiscoveredTags(data.tags || []);
      } else {
        setError(data.message || 'Failed to discover PLC tags.');
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
      fetchPlcTags(adapterId);
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

  const handleSelectAllFiltered = (filtered: DiscoveredTag[]) => {
    setSelectedTags(prev => {
      const next = { ...prev };
      filtered.forEach(tag => {
        next[tag.name] = tag;
      });
      return next;
    });
  };

  const handleDeselectAllFiltered = (filtered: DiscoveredTag[]) => {
    setSelectedTags(prev => {
      const next = { ...prev };
      filtered.forEach(tag => {
        delete next[tag.name];
      });
      return next;
    });
  };

  const mapToUiDataType = (plcDataType: string): string => {
    switch (plcDataType.toUpperCase()) {
      case 'BOOL': return 'Boolean';
      case 'SINT':
      case 'INT16': return 'Int16';
      case 'UINT16': return 'UInt16';
      case 'INT32':
      case 'DINT': return 'Int32';
      case 'UINT32':
      case 'UDINT': return 'UInt32';
      case 'INT64':
      case 'LINT': return 'Int64';
      case 'UINT64':
      case 'ULINT': return 'UInt64';
      case 'REAL': return 'Float';
      case 'LREAL': return 'Double';
      case 'STRUCTURE': return 'String';
      default: return 'Int32';
    }
  };

  const handleNextStep = () => {
    const selectedList = Object.values(selectedTags);
    if (selectedList.length === 0) {
      toast.warning('Please select at least one tag to configure.');
      return;
    }
    setConfiguringTags(selectedList.map(tag => {
      const tagName = tag.name.replace(/[^a-zA-Z0-9_]/g, '_');
      return {
        name: tag.name,
        tagName,
        dataType: mapToUiDataType(tag.dataType),
        scanIntervalMs: 1000,
        description: `Discovered tag: ${tag.name}`
      };
    }));
    setStep(2);
  };

  const handleUpdateConfiguringTag = (index: number, key: keyof EipConfiguringTag, value: string | number) => {
    setConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value } as EipConfiguringTag;
      return next;
    });
  };

  const handleSaveTags = async () => {
    let successes = 0;
    let failures = 0;
    setLoading(true);
    try {
      for (const tag of configuringTags) {
        const payload = {
          id: '',
          adapterId,
          dataSourceId: null,
          metric: tag.tagName,
          dataType: tag.dataType,
          scanIntervalMs: Number(tag.scanIntervalMs),
          scaleFactor: 1.0,
          offset: 0.0,
          isEnabled: true,
          byteOrder: 'ABCD',
          description: tag.description || '',
          mqttParseMode: 'Plaintext',
          mqttJsonPath: null,
          address: tag.name
        };
        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) successes++;
        else failures++;
      }
      if (successes > 0) toast.success(`Successfully registered ${successes} Ethernet/IP tags.`);
      if (failures > 0) toast.error(`Failed to register ${failures} tags.`);
      onSaveSuccess();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      toast.error('An error occurred while saving tags: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const filteredDiscoveredTags = discoveredTags.filter(tag =>
    tag.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    tag.dataType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <ModalShell
      title="Ethernet/IP PLC Tag Discoverer"
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
              {filteredDiscoveredTags.length > 0 && (
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button type="button" onClick={() => handleSelectAllFiltered(filteredDiscoveredTags)} className="btn-secondary text-xs">
                    Select All
                  </button>
                  <button type="button" onClick={() => handleDeselectAllFiltered(filteredDiscoveredTags)} className="btn-secondary text-xs">
                    Deselect All
                  </button>
                </div>
              )}
            </div>

            {loading && discoveredTags.length === 0 ? (
              <div className="browser-loading">
                <div className="opc-spinner" />
                <span className="browser-loading-text">Connecting to PLC and querying tag symbol database...</span>
              </div>
            ) : error ? (
              <div className="browser-error-state">
                <AlertTriangle color="var(--danger-color)" size={32} />
                <span className="browser-error-title">Discovery Failed</span>
                <span className="browser-error-desc">{error}</span>
                <button
                  type="button"
                  onClick={() => fetchPlcTags(adapterId)}
                  className="btn-browser-retry"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div className="browser-node-section">
                <span className="browser-available-label">Discovered Symbols ({filteredDiscoveredTags.length})</span>
                {filteredDiscoveredTags.length === 0 ? (
                  <div className="browser-folder-empty">
                    {discoveredTags.length === 0 ? 'No controller tags were discovered. Ensure this Logix PLC supports symbol listing.' : 'No symbols match your filter.'}
                  </div>
                ) : (
                  <div className="browser-node-list" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {filteredDiscoveredTags.map((tag) => (
                      <BrowseTreeNode
                        key={tag.name}
                        name={tag.name}
                        label={tag.name}
                        dataType={tag.dataType}
                        isStructure={tag.dataType.toUpperCase() === 'STRUCTURE'}
                        templateId={tag.templateId}
                        dimensions={tag.dimensions}
                        adapterId={adapterId}
                        onToggleSelect={handleToggleNode}
                        selectedTags={selectedTags}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="browser-right-pane">
            <div className="browser-right-header">
              <span className="browser-section-label">Selected Tags ({selectedCount})</span>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setSelectedTags({})} className="browser-clear-btn">
                  Clear All
                </button>
              )}
            </div>
            {selectedCount === 0 ? (
              <div className="browser-empty-right">
                <span className="browser-empty-icon">📋</span>
                <span className="browser-empty-text">Select PLC symbols on the left to add them as registry tags.</span>
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
          <span className="browser-config-step-label">Step 2: Configure Tag Parameters</span>
          <div className="browser-config-wrap">
            <table className="browser-config-table">
              <thead>
                <tr>
                  <th>PLC Address / Symbol</th>
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
                          { value: 'Int16', label: 'Int16' },
                          { value: 'UInt16', label: 'UInt16' },
                          { value: 'Int32', label: 'Int32' },
                          { value: 'UInt32', label: 'UInt32' },
                          { value: 'Float', label: 'Float' },
                          { value: 'Double', label: 'Double' },
                          { value: 'Int64', label: 'Int64' },
                          { value: 'UInt64', label: 'UInt64' },
                          { value: 'Boolean', label: 'Boolean' },
                          { value: 'String', label: 'String' }
                        ]}
                      />
                    </td>
                    <td className="browser-cell-w-scan">
                      <input
                        type="number"
                        min={10}
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
                {loading ? 'Saving...' : 'Save & Bind Tags'}
              </button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
