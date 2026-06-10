import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DriverAdapter, MqttDevice } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface MqttKey {
  path: string;
  dataType: string;
  value: unknown;
}

interface MqttTopicItem {
  topic: string;
  lastSeen: string | null;
  keys: MqttKey[];
}

interface SelectedMqttKey {
  topic: string;
  path: string;
  dataType: string;
  value: unknown;
}

interface MqttConfiguringTag {
  topic: string;
  path: string;
  dataType: string;
  tagName: string;
  scanIntervalMs: number;
  mqttDeviceId: string;
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

const mqttTopicMatches = (subscription: string, topic: string): boolean => {
  if (!subscription) return true;
  if (subscription === topic) return true;
  const subParts = subscription.split('/');
  const topParts = topic.split('/');

  for (let i = 0; i < subParts.length; i++) {
    const subPart = subParts[i];
    if (subPart === '#') return true;
    if (subPart === '+') {
      if (i >= topParts.length) return false;
    } else if (subPart !== topParts[i]) {
      return false;
    }
  }
  return subParts.length === topParts.length;
};

interface MqttBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  mqttDevices: MqttDevice[];
  toast: ToastFn;
  onSaveSuccess: () => void;
  selectedMqttDeviceId?: string;
}

export default function MqttBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  mqttDevices,
  toast,
  onSaveSuccess,
  selectedMqttDeviceId
}: MqttBrowserModalProps) {
  const [mqttBrowserLoading, setMqttBrowserLoading] = useState(false);
  const [mqttBrowserError, setMqttBrowserError] = useState('');
  const [mqttBrowserTopics, setMqttBrowserTopics] = useState<MqttTopicItem[]>([]);
  const [mqttBrowserExpandedTopics, setMqttBrowserExpandedTopics] = useState<Record<string, boolean>>({});
  const [mqttSelectedKeys, setMqttSelectedKeys] = useState<Record<string, SelectedMqttKey>>({});
  const [mqttBrowserStep, setMqttBrowserStep] = useState(1);
  const [mqttConfiguringTags, setMqttConfiguringTags] = useState<MqttConfiguringTag[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState(selectedMqttDeviceId || '');

  const activeAdapter = adapters.find(a => a.id === adapterId);
  const selectedCount = Object.keys(mqttSelectedKeys).length;

  const fetchMqttTopics = async (targetAdapterId: string) => {
    setMqttBrowserLoading(true);
    setMqttBrowserError('');
    try {
      const res = await fetch('/api/adapters/mqtt/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId: targetAdapterId })
      });
      const data = await res.json();
      if (data.success) {
        setMqttBrowserTopics(data.topics || []);
      } else {
        setMqttBrowserError(data.message || 'Failed to fetch MQTT topics.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred.';
      setMqttBrowserError(errorMessage);
    } finally {
      setMqttBrowserLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && adapterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMqttBrowserStep(1);
      setMqttSelectedKeys({});
      setMqttBrowserExpandedTopics({});
      setActiveDeviceId(selectedMqttDeviceId || '');
      fetchMqttTopics(adapterId);
    }
  }, [isOpen, adapterId, selectedMqttDeviceId]);

  const handleToggleMqttKey = (topic: string, keyItem: MqttKey) => {
    const compositeKey = `${topic}||${keyItem.path}`;
    setMqttSelectedKeys(prev => {
      const next = { ...prev };
      if (next[compositeKey]) delete next[compositeKey];
      else {
        next[compositeKey] = {
          topic,
          path: keyItem.path,
          dataType: keyItem.dataType,
          value: keyItem.value
        };
      }
      return next;
    });
  };

  const handleToggleTopicExpand = (topic: string) => {
    setMqttBrowserExpandedTopics(prev => ({ ...prev, [topic]: !prev[topic] }));
  };

  const handleMqttNextStep = () => {
    const selectedList = Object.values(mqttSelectedKeys);
    if (selectedList.length === 0) {
      toast.warning('Please select at least one data key.');
      return;
    }
    const configuring = selectedList.map(item => {
      let cleanTagName: string;
      if (item.path && item.path !== '$') {
        const parts = item.path.replace('$.', '').split('.');
        cleanTagName = parts[parts.length - 1].replace(/[^a-zA-Z0-9_]/g, '_');
      } else {
        const parts = item.topic.split('/');
        cleanTagName = parts[parts.length - 1].replace(/[^a-zA-Z0-9_]/g, '_');
      }

      const matchingDev = activeDeviceId
        ? mqttDevices.find(d => d.id === activeDeviceId)
        : mqttDevices.find(d =>
            d.adapterId === adapterId &&
            (d.topicSubscription === item.topic || item.topic.startsWith(d.topicSubscription.replace('/#', '').replace('/+', '')))
          );

      return {
        topic: item.topic,
        path: item.path,
        dataType: item.dataType || 'Float',
        tagName: cleanTagName,
        scanIntervalMs: 1000,
        mqttDeviceId: matchingDev?.id || '',
        description: ''
      };
    });
    setMqttConfiguringTags(configuring);
    setMqttBrowserStep(2);
  };

  const handleUpdateMqttConfiguringTag = (index: number, key: keyof MqttConfiguringTag, value: string | number) => {
    setMqttConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value } as MqttConfiguringTag;
      return next;
    });
  };

  const handleSaveMqttTags = async () => {
    let successes = 0;
    let failures = 0;
    setMqttBrowserLoading(true);

    try {
      for (const tag of mqttConfiguringTags) {
        const payload = {
          id: '',
          adapterId,
          dataSourceId: '',
          metric: tag.tagName,
          dataType: tag.dataType,
          scanIntervalMs: Number(tag.scanIntervalMs),
          scaleFactor: 1.0,
          offset: 0.0,
          isEnabled: true,
          byteOrder: 'ABCD',
          description: tag.description || '',
          mqttDeviceId: tag.mqttDeviceId || null,
          mqttParseMode: tag.path !== '$' ? 'JSON' : 'Plaintext',
          mqttJsonPath: tag.path !== '$' ? tag.path : null,
          address: tag.mqttDeviceId ? tag.path : tag.topic
        };

        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) successes++;
        else failures++;
      }

      if (successes > 0) toast.success(`Successfully created ${successes} MQTT tags.`);
      if (failures > 0) toast.error(`Failed to create ${failures} tags.`);
      onSaveSuccess();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      toast.error('An error occurred while saving tags: ' + errorMessage);
    } finally {
      setMqttBrowserLoading(false);
    }
  };

  if (!isOpen) return null;

  const selectedDevice = mqttDevices.find(d => d.id === activeDeviceId);
  const filteredTopics = selectedDevice
    ? mqttBrowserTopics.filter(topicItem => mqttTopicMatches(selectedDevice.topicSubscription, topicItem.topic))
    : mqttBrowserTopics;

  return (
    <ModalShell
      title="MQTT Broker Payload Browser"
      subtitle={activeAdapter ? `${activeAdapter.name} (${activeAdapter.host})` : undefined}
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      {mqttBrowserStep === 1 ? (
        <div className="browser-layout">
          <div className="browser-left-pane">
            <div className="mqtt-device-filter">
              <label className="mqtt-device-filter-label">Filter by MQTT Device</label>
              <CustomSelect
                value={activeDeviceId}
                onChange={(val) => setActiveDeviceId(val)}
                placeholder="-- All Topics --"
                options={mqttDevices.filter(d => d.adapterId === adapterId).map(d => ({
                  value: d.id,
                  label: `${d.name} (${d.topicSubscription})`
                }))}
              />
            </div>

            {mqttBrowserLoading && mqttBrowserTopics.length === 0 ? (
              <div className="browser-loading-center">
                <div className="opc-spinner" />
                <span className="browser-loading-text">Listening to broker and loading seen topics...</span>
              </div>
            ) : mqttBrowserError ? (
              <div className="browser-error-center">
                <AlertTriangle color="var(--danger-color)" size={32} />
                <span className="browser-error-title">Browse Failed</span>
                <span className="browser-error-msg">{mqttBrowserError}</span>
                <button type="button" onClick={() => fetchMqttTopics(adapterId)} className="btn-browser-retry">
                  Try Again
                </button>
              </div>
            ) : (
              <div className="mqtt-topics-filter-section">
                <span className="mqtt-topics-label">Discovered Topics ({filteredTopics.length})</span>
                {filteredTopics.length === 0 ? (
                  <div className="mqtt-topic-empty">
                    {activeDeviceId
                      ? `No topics found matching "${selectedDevice?.topicSubscription}".`
                      : 'No topics seen yet. Ensure the MQTT adapter is connected and messages are published to subscribed topics.'}
                  </div>
                ) : (
                  <div className="mqtt-topic-list">
                    {filteredTopics.map((topicItem) => {
                      const isExpanded = !!mqttBrowserExpandedTopics[topicItem.topic];
                      return (
                        <div key={topicItem.topic} className="mqtt-topic-item">
                          <div
                            className="mqtt-topic-header"
                            onClick={() => handleToggleTopicExpand(topicItem.topic)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleTopicExpand(topicItem.topic); }}
                          >
                            <div className="mqtt-topic-left">
                              <span className="text-secondary">{isExpanded ? '▼' : '►'}</span>
                              <div className="mqtt-topic-info">
                                <div className="mqtt-topic-title">{topicItem.topic}</div>
                                <div className="mqtt-topic-lastseen">
                                  Last seen: {formatToLocalTimeString(topicItem.lastSeen)}
                                </div>
                              </div>
                            </div>
                            <span className="mqtt-topic-key-count">{topicItem.keys?.length || 0} keys</span>
                          </div>

                          {isExpanded && (
                            <div className="mqtt-keys-body">
                              {topicItem.keys && topicItem.keys.map((keyItem: MqttKey) => {
                                const compositeKey = `${topicItem.topic}||${keyItem.path}`;
                                const isKeySelected = !!mqttSelectedKeys[compositeKey];
                                return (
                                  <div
                                    key={keyItem.path}
                                    className={`mqtt-key-item${isKeySelected ? ' is-selected' : ''}`}
                                    onClick={() => handleToggleMqttKey(topicItem.topic, keyItem)}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleMqttKey(topicItem.topic, keyItem); }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isKeySelected}
                                      onChange={() => handleToggleMqttKey(topicItem.topic, keyItem)}
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
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="browser-right-pane">
            <div className="browser-selected-header">
              <span className="browser-selected-title">Selected Keys ({selectedCount})</span>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setMqttSelectedKeys({})} className="browser-clear-btn">
                  Clear All
                </button>
              )}
            </div>
            {selectedCount === 0 ? (
              <div className="browser-empty-center">
                <span className="browser-empty-icon">📋</span>
                <span className="browser-empty-text">Select payload paths or raw topics from the left pane to add as telemetry tags.</span>
              </div>
            ) : (
              <div className="browser-selected-list">
                {Object.values(mqttSelectedKeys).map((item: SelectedMqttKey) => {
                  const compositeKey = `${item.topic}||${item.path}`;
                  return (
                    <div key={compositeKey} className="browser-selected-item">
                      <div className="browser-item-info">
                        <div className="browser-item-name">{item.path}</div>
                        <div className="browser-item-id">{item.topic}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setMqttSelectedKeys(prev => {
                            const next = { ...prev };
                            delete next[compositeKey];
                            return next;
                          });
                        }}
                        className="btn-browser-remove"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="browser-config-body">
          <span className="browser-step2-label">Step 2: Configure MQTT Tag Properties</span>
          <div className="browser-config-wrap">
            <table className="browser-config-table">
              <thead>
                <tr>
                  <th>Topic / Payload Path</th>
                  <th>Tag Metric Name</th>
                  <th>Data Type</th>
                  <th>MQTT Device Session</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {mqttConfiguringTags.map((tag, idx) => (
                  <tr key={idx}>
                    <td className="browser-cell-max-lg">
                      <div className="browser-cell-name">{tag.path}</div>
                      <div className="browser-cell-id-sm">{tag.topic}</div>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={tag.tagName}
                        onChange={(e) => handleUpdateMqttConfiguringTag(idx, 'tagName', e.target.value)}
                        className="browser-table-input"
                      />
                    </td>
                    <td className="browser-cell-w-dtype-mqtt">
                      <CustomSelect
                        value={tag.dataType}
                        onChange={(val) => handleUpdateMqttConfiguringTag(idx, 'dataType', val)}
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
                    <td className="browser-cell-w-mqtt-dev">
                      <CustomSelect
                        value={tag.mqttDeviceId}
                        onChange={(val) => handleUpdateMqttConfiguringTag(idx, 'mqttDeviceId', val)}
                        placeholder="-- None (Legacy Flat) --"
                        options={mqttDevices.filter(d => d.adapterId === adapterId).map(d => ({
                          value: d.id,
                          label: d.name
                        }))}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={tag.description}
                        onChange={(e) => handleUpdateMqttConfiguringTag(idx, 'description', e.target.value)}
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
        {mqttBrowserStep === 1 ? (
          <>
            <span className="browser-footer-count">{selectedCount} keys selected</span>
            <div className="browser-footer-btns">
              <button type="button" onClick={onClose} className="btn-browser-cancel">Cancel</button>
              <button
                type="button"
                onClick={handleMqttNextStep}
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
              onClick={() => setMqttBrowserStep(1)}
              disabled={mqttBrowserLoading}
              className="btn-browser-back"
            >
              ← Back to Topics
            </button>
            <button
              type="button"
              onClick={handleSaveMqttTags}
              disabled={mqttBrowserLoading}
              className="btn-browser-save"
            >
              {mqttBrowserLoading ? 'Saving Tags...' : 'Save & Add Tags'}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}
