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

  const handleGoToConfigure = () => {
    const list = Object.values(selectedTags).map(tag => {
      // Clean up tag name for binding (e.g. replacing colons with underscores)
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

  const handleUpdateConfiguringTag = (index: number, fields: Partial<BacnetConfiguringTag>) => {
    setConfiguringTags(prev => prev.map((item, i) => i === index ? { ...item, ...fields } : item));
  };

  const handleRegisterTags = async () => {
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

  const allFilteredSelected = filtered.length > 0 && filtered.every(tag => !!selectedTags[tag.name]);

  return (
    <ModalShell
      title={`BACnet Objects Browser: ${activeAdapter?.name || 'Adapter'}`}
      subtitle={step === 1 ? 'Select objects to register as physical tags.' : 'Configure parameters for the selected objects.'}
      size="lg"
      onClose={onClose}
    >
      {step === 1 ? (
        <div className="discovery-modal-body">
          <div className="discovery-toolbar">
            <div className="search-input-wrap">
              <Search className="search-icon-inside" size={16} />
              <input
                type="text"
                className="form-input search-input-pl"
                placeholder="Filter BACnet objects by address or type..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex-row gap-sm">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => allFilteredSelected ? handleDeselectAllFiltered(filtered) : handleSelectAllFiltered(filtered)}
                disabled={filtered.length === 0}
              >
                {allFilteredSelected ? 'Deselect All' : 'Select All Filtered'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="discovery-loading-state">
              <div className="loading-spinner" />
              <div className="loading-label">Discovering BACnet objects over UDP...</div>
            </div>
          ) : error ? (
            <div className="alert-box-danger my-md">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          ) : discoveredTags.length === 0 ? (
            <div className="discovery-empty-state">No BACnet objects discovered. Verify that the device is online and supports Object List read service.</div>
          ) : (
            <div className="discovery-list-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '40px' }} className="text-center">Select</th>
                    <th>Object Reference (Type:Instance)</th>
                    <th>Default Data Type</th>
                    <th>Type Hex</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(tag => {
                    const isSelected = !!selectedTags[tag.name];
                    return (
                      <tr
                        key={tag.name}
                        className={isSelected ? 'is-selected clickable-row' : 'clickable-row'}
                        onClick={() => handleToggleTag(tag)}
                      >
                        <td className="text-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleTag(tag)}
                          />
                        </td>
                        <td className="text-mono-sm font-bold">{tag.name}</td>
                        <td>
                          <span className="badge tag-dtype-badge">{tag.dataType}</span>
                        </td>
                        <td className="text-mono-sm text-secondary">{tag.typeHex}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="modal-footer mt-md">
            <div className="text-secondary text-sm">
              {selectedCount} object{selectedCount === 1 ? '' : 's'} selected
            </div>
            <div className="flex-row gap-sm">
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button
                type="button"
                onClick={handleGoToConfigure}
                disabled={selectedCount === 0}
                className="btn-primary"
              >
                Configure Selection ({selectedCount})
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="discovery-modal-body">
          <div className="discovery-list-container is-configure">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Data Type</th>
                  <th>Scan Rate (ms)</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {configuringTags.map((tag, idx) => (
                  <tr key={tag.name}>
                    <td className="text-mono-sm">
                      <div className="font-bold">{tag.name}</div>
                    </td>
                    <td>
                      <CustomSelect
                        value={tag.dataType}
                        onChange={val => handleUpdateConfiguringTag(idx, { dataType: val })}
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
                    <td>
                      <input
                        type="number"
                        className="form-input text-mono text-center"
                        style={{ width: '100px' }}
                        value={tag.scanIntervalMs}
                        min={100}
                        onChange={e => handleUpdateConfiguringTag(idx, { scanIntervalMs: Math.max(100, Number(e.target.value) || 1000) })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-input"
                        value={tag.description}
                        onChange={e => handleUpdateConfiguringTag(idx, { description: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="modal-footer mt-md">
            <button type="button" onClick={() => setStep(1)} className="btn-secondary">Back</button>
            <button type="button" onClick={handleRegisterTags} className="btn-register">Register Tags ({configuringTags.length})</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
