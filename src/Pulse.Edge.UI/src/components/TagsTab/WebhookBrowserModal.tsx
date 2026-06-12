import { useState, useEffect } from 'react';
import { AlertTriangle, Clipboard, Check } from 'lucide-react';
import type { DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface WebhookKey {
  path: string;
  dataType: string;
  value: unknown;
}

interface WebhookPayloadItem {
  topic: string;
  lastSeen: string | null;
  keys: WebhookKey[];
  payload: string;
}

interface SelectedWebhookKey {
  path: string;
  dataType: string;
  value: unknown;
}

interface WebhookConfiguringTag {
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

interface WebhookBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  toast: ToastFn;
  onSaveSuccess: () => void;
}

export default function WebhookBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  toast,
  onSaveSuccess
}: WebhookBrowserModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payloadItem, setPayloadItem] = useState<WebhookPayloadItem | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Record<string, SelectedWebhookKey>>({});
  const [step, setStep] = useState(1);
  const [configuringTags, setConfiguringTags] = useState<WebhookConfiguringTag[]>([]);
  const [isCopied, setIsCopied] = useState(false);

  const activeAdapter = adapters.find(a => a.id === adapterId);
  const selectedCount = Object.keys(selectedKeys).length;

  let config: Record<string, string> = {};
  try {
    if (activeAdapter) {
      config = JSON.parse(activeAdapter.configJson || '{}');
    }
  } catch {}

  const webhookUrl = activeAdapter
    ? `${window.location.origin}/api/webhooks/receive/${activeAdapter.id}?token=${config.Token || ''}`
    : '';

  const handleCopyUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setIsCopied(true);
      toast.success('Webhook URL copied to clipboard.');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      toast.error('Failed to copy Webhook URL.');
    }
  };

  const fetchWebhookPayload = async (targetAdapterId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/adapters/webhook/browse', {
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
        setError(data.message || 'No payload has been received yet by this Webhook.');
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
      fetchWebhookPayload(adapterId);
    }
  }, [isOpen, adapterId]);

  const handleToggleKey = (keyItem: WebhookKey) => {
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

  const handleUpdateConfiguringTag = (index: number, key: keyof WebhookConfiguringTag, value: string) => {
    setConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value } as WebhookConfiguringTag;
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

      if (successes > 0) toast.success(`Successfully created ${successes} Webhook tags.`);
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
      title="Webhook Payload Browser & Parser"
      subtitle={activeAdapter ? `${activeAdapter.name} (REST Webhook)` : undefined}
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      {step === 1 ? (
        <div className="browser-layout">
          <div className="browser-left-pane">
            <div className="webhook-copiable-url-section">
              <label className="form-label form-label-bold">Webhook URL (Ready for Client)</label>
              <div className="webhook-url-copy-row">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="form-input text-mono text-sm bg-neutral-dim cursor-default"
                />
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="btn-copy-url"
                  title="Copy URL"
                >
                  {isCopied ? <Check size={14} className="text-success" /> : <Clipboard size={14} />}
                </button>
              </div>
            </div>

            {loading && !payloadItem ? (
              <div className="browser-loading-center">
                <div className="opc-spinner" />
                <span className="browser-loading-text">Retrieving latest payload...</span>
              </div>
            ) : error ? (
              <div className="browser-error-center">
                <AlertTriangle color="var(--warning-color)" size={32} />
                <span className="browser-error-title">No Payload Yet</span>
                <span className="browser-error-msg">{error}</span>
                <div className="webhook-setup-instructions">
                  <p>Send a POST request with a JSON payload to the Webhook URL above to populate the payload browser.</p>
                  <pre className="webhook-pre-instruction">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"temperature": 23.5, "ts": 1718020800000}'`}
                  </pre>
                </div>
                <button type="button" onClick={() => fetchWebhookPayload(adapterId)} className="btn-browser-retry">
                  Refresh Payload
                </button>
              </div>
            ) : payloadItem ? (
              <div className="webhook-browser-content">
                <div className="webhook-payload-header">
                  <span className="webhook-last-seen-label">
                    Last Received: {formatToLocalTimeString(payloadItem.lastSeen)}
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchWebhookPayload(adapterId)}
                    className="btn-webhook-refresh"
                  >
                    Refresh
                  </button>
                </div>

                <div className="webhook-payload-preview-box">
                  <span className="webhook-label-sm">Raw Payload Preview</span>
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
                      <div className="browser-item-id">REST Webhook</div>
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
          <span className="browser-step2-label">Step 2: Configure Webhook Tag Properties</span>
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
