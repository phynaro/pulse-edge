import { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface RestApiKey {
  path: string;
  dataType: string;
  value: unknown;
}

interface RestApiPayloadItem {
  topic: string;
  lastSeen: string | null;
  keys: RestApiKey[];
  payload: string;
}

interface SelectedRestApiKey {
  path: string;
  dataType: string;
  value: unknown;
}

interface RestApiConfiguringTag {
  path: string;
  dataType: string;
  tagName: string;
  description: string;
}

const formatToLocalTimeString = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  return new Date(utcStr).toLocaleTimeString();
};

interface RestApiBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  toast: ToastFn;
  onSaveSuccess: () => void;
}

export default function RestApiBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  toast,
  onSaveSuccess
}: RestApiBrowserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payloadItem, setPayloadItem] = useState<RestApiPayloadItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, SelectedRestApiKey>>({});
  const [step, setStep] = useState(1);
  const [configuringTags, setConfiguringTags] = useState<RestApiConfiguringTag[]>([]);

  const activeAdapter = adapters.find(a => a.id === adapterId);
  const selectedCount = Object.keys(selectedKeys).length;

  const fetchLivePayload = async (targetAdapterId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/adapters/restapi/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId: targetAdapterId })
      });
      const data = await res.json();
      if (data.success && data.topics && data.topics.length > 0) {
        const item = data.topics[0];
        setPayloadItem({
          topic: item.topic,
          lastSeen: item.lastSeen,
          keys: item.keys || [],
          payload: item.payload || ''
        });
      } else {
        setError(data.message || 'Failed to fetch payload from REST API server.');
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
      setSelectedKeys({});
      setPayloadItem(null);
      fetchLivePayload(adapterId);
    }
  }, [isOpen, adapterId]);

  const handleToggleKey = (keyItem: RestApiKey) => {
    setSelectedKeys(prev => {
      const next = { ...prev };
      if (next[keyItem.path]) {
        delete next[keyItem.path];
      } else {
        next[keyItem.path] = {
          path: keyItem.path,
          dataType: keyItem.dataType,
          value: keyItem.value
        };
      }
      return next;
    });
  };

  const handleNextStep = () => {
    const selectedList = Object.values(selectedKeys);
    if (selectedList.length === 0) {
      toast.warning('Please select at least one JSON key.');
      return;
    }
    const configuring = selectedList.map(item => {
      let cleanTagName = 'tag';
      if (item.path && item.path !== '$') {
        const parts = item.path.replace('$.', '').split('.');
        cleanTagName = parts[parts.length - 1].replace(/[^a-zA-Z0-9_]/g, '_');
      }
      return {
        path: item.path,
        dataType: item.dataType || 'Float',
        tagName: cleanTagName,
        description: ''
      };
    });
    setConfiguringTags(configuring);
    setStep(2);
  };

  const handleUpdateConfiguringTag = (index: number, key: keyof RestApiConfiguringTag, value: string) => {
    setConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value } as RestApiConfiguringTag;
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
          dataSourceId: '',
          metric: tag.tagName,
          dataType: tag.dataType,
          scanIntervalMs: 1000,
          scaleFactor: 1.0,
          offset: 0.0,
          isEnabled: true,
          byteOrder: 'ABCD',
          description: tag.description || '',
          mqttDeviceId: null,
          mqttParseMode: 'JSON',
          mqttJsonPath: tag.path,
          address: tag.path
        };

        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) successes++;
        else failures++;
      }

      if (successes > 0) toast.success(`Successfully created ${successes} REST API tags.`);
      if (failures > 0) toast.error(`Failed to create ${failures} tags.`);
      onSaveSuccess();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      toast.error('An error occurred while saving tags: ' + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell
      title="REST API Live Payload Browser"
      subtitle={activeAdapter ? `${activeAdapter.name} (REST API Poller)` : undefined}
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      {step === 1 ? (
        <div className="browser-layout">
          <div className="browser-left-pane">
            {loading && !payloadItem ? (
              <div className="browser-loading-center">
                <div className="opc-spinner" />
                <span className="browser-loading-text">Fetching live payload from target server...</span>
              </div>
            ) : error ? (
              <div className="browser-error-center">
                <AlertTriangle color="var(--warning-color)" size={32} />
                <span className="browser-error-title">Fetch Failed</span>
                <span className="browser-error-msg">{error}</span>
                <div className="webhook-setup-instructions">
                  <p>Verify that the target REST API server is running, the host and port are reachable, and the method/path settings are correct.</p>
                </div>
                <button type="button" onClick={() => fetchLivePayload(adapterId)} className="btn-browser-retry" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', margin: '1rem auto 0' }}>
                  <RefreshCw size={14} className={loading ? 'spin' : ''} /> Retry Fetch
                </button>
              </div>
            ) : payloadItem ? (
              <div className="webhook-browser-content">
                <div className="webhook-payload-header">
                  <span className="webhook-last-seen-label">
                    Last Fetched: {formatToLocalTimeString(payloadItem.lastSeen)}
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchLivePayload(adapterId)}
                    disabled={loading}
                    className="btn-webhook-refresh"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  >
                    <RefreshCw size={12} className={loading ? 'spin' : ''} /> {loading ? 'Fetching...' : 'Refetch'}
                  </button>
                </div>

                <div className="webhook-payload-preview-box">
                  <span className="webhook-label-sm">Live JSON Response Preview</span>
                  <pre className="webhook-raw-payload-pre">
                    {(() => {
                      try {
                        return JSON.stringify(JSON.parse(payloadItem.payload), null, 2);
                      } catch {
                        return payloadItem.payload;
                      }
                    })()}
                  </pre>
                </div>

                <div className="webhook-keys-section">
                  <span className="mqtt-topics-label">Extracted JSON Paths ({payloadItem.keys.length})</span>
                  <div className="mqtt-topic-list">
                    <div className="mqtt-keys-body" style={{ display: 'block', padding: 0 }}>
                      {payloadItem.keys.map((keyItem) => {
                        const isKeySelected = !!selectedKeys[keyItem.path];
                        return (
                          <div
                            key={keyItem.path}
                            className={`mqtt-key-item${isKeySelected ? ' is-selected' : ''}`}
                            onClick={() => handleToggleKey(keyItem)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleKey(keyItem); }}
                          >
                            <input
                              type="checkbox"
                              checked={isKeySelected}
                              onChange={() => handleToggleKey(keyItem)}
                              className="browser-node-checkbox"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="mqtt-key-details">
                              <div className="mqtt-key-top">
                                <span className="mqtt-key-path">{keyItem.path}</span>
                                <span className="mqtt-key-type-chip">{keyItem.dataType}</span>
                              </div>
                              <div className="mqtt-key-value">
                                Val: <span className="mqtt-key-val-num">{String(keyItem.value)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="browser-right-pane">
            <div className="browser-selected-header">
              <span className="browser-selected-title">Selected Keys ({selectedCount})</span>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setSelectedKeys({})} className="browser-clear-btn">
                  Clear All
                </button>
              )}
            </div>
            {selectedCount === 0 ? (
              <div className="browser-empty-center">
                <span className="browser-empty-icon">📋</span>
                <span className="browser-empty-text">Select JSON paths from the left pane to define telemetry tags.</span>
              </div>
            ) : (
              <div className="browser-selected-list">
                {Object.values(selectedKeys).map((item) => (
                  <div key={item.path} className="browser-selected-item">
                    <div className="browser-item-info">
                      <div className="browser-item-name">{item.path}</div>
                      <div className="browser-item-id">REST API Payload</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKeys(prev => {
                          const next = { ...prev };
                          delete next[item.path];
                          return next;
                        });
                      }}
                      className="btn-browser-remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="browser-config-body">
          <span className="browser-step2-label">Step 2: Configure REST API Tag Properties</span>
          <div className="browser-config-wrap">
            <table className="browser-config-table">
              <thead>
                <tr>
                  <th>JSON Payload Path</th>
                  <th>Tag Metric Name</th>
                  <th>Data Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {configuringTags.map((tag, idx) => (
                  <tr key={idx}>
                    <td className="browser-cell-max-lg">
                      <div className="browser-cell-name">{tag.path}</div>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={tag.tagName}
                        onChange={(e) => handleUpdateConfiguringTag(idx, 'tagName', e.target.value)}
                        className="browser-table-input"
                      />
                    </td>
                    <td className="browser-cell-w-dtype-mqtt">
                      <CustomSelect
                        value={tag.dataType}
                        onChange={(val) => handleUpdateConfiguringTag(idx, 'dataType', val)}
                        className="is-compact"
                        options={[
                          { value: 'Int16', label: 'Int16' }, { value: 'UInt16', label: 'UInt16' },
                          { value: 'Int32', label: 'Int32' }, { value: 'UInt32', label: 'UInt32' },
                          { value: 'Float', label: 'Float' }, { value: 'Double', label: 'Double' },
                          { value: 'Int64', label: 'Int64' }, { value: 'UInt64', label: 'UInt64' },
                          { value: 'Boolean', label: 'Boolean' }, { value: 'String', label: 'String' }
                        ]}
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
            <span className="browser-footer-count">{selectedCount} keys selected</span>
            <div className="browser-footer-btns">
              <button type="button" onClick={onClose} className="btn-browser-cancel">Cancel</button>
              <button
                type="button"
                onClick={handleNextStep}
                disabled={selectedCount === 0}
                className={`btn-browser-next${selectedCount === 0 ? ' is-empty' : ' is-ready'}`}
              >
                Configure Tags →
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={loading}
              className="btn-browser-back"
            >
              ← Back to Payload
            </button>
            <button
              type="button"
              onClick={handleSaveTags}
              disabled={loading}
              className="btn-browser-save"
            >
              {loading ? 'Saving Tags...' : 'Save & Add Tags'}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}
