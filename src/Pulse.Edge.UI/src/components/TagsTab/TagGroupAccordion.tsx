import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Edit, Trash2 } from 'lucide-react';
import type { DataPoint, DriverAdapter, MqttDevice } from '../../types';

const formatToLocalTimeString = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  return new Date(utcStr).toLocaleTimeString();
};

const isNumericType = (dataType: string): boolean => {
  const lower = (dataType || '').toLowerCase();
  return (
    lower.includes('int') ||
    lower.includes('float') ||
    lower.includes('double') ||
    lower.includes('uint')
  );
};

const formatLiveValue = (value: string | null | undefined, dataType: string): string => {
  if (value === null || value === undefined || value === '') return '—';

  const num = parseFloat(value);
  if (isNaN(num)) return value;

  const lowerDataType = dataType.toLowerCase();

  if (
    lowerDataType.includes('int') ||
    lowerDataType.includes('word') ||
    lowerDataType.includes('bool')
  ) {
    return Math.round(num).toString();
  }

  if (
    lowerDataType.includes('float') ||
    lowerDataType.includes('double') ||
    lowerDataType.includes('single') ||
    lowerDataType.includes('real') ||
    lowerDataType.includes('num')
  ) {
    return parseFloat(num.toFixed(2)).toString();
  }

  return parseFloat(num.toFixed(2)).toString();
};

interface TagGroupAccordionProps {
  adapter: DriverAdapter | null;
  tags: DataPoint[];
  mqttDevices: MqttDevice[];
  selectedTagIds: Record<string, boolean>;
  toggleSelectTag: (id: string, e?: React.MouseEvent) => void;
  toggleSelectAllGroup: (tags: DataPoint[]) => void;
  handleStartEdit: (dp: DataPoint) => void;
  setDeletingPhysicalTag: (dp: DataPoint) => void;
  onUnbindTag: (id: string) => Promise<void>;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function adapterStatusClass(status: string): string {
  if (status === 'Connected') return 'is-online';
  if (status === 'Offline') return 'is-offline';
  return 'is-error';
}

function tagStatusClass(dp: DataPoint, isOrphan: boolean): string {
  if (isOrphan) return 'is-orphan-dot';
  if (dp.consecutiveFailures && dp.consecutiveFailures > 0) return 'is-warn';
  if (dp.lastError) return 'is-error';
  if (dp.lastValue !== null && dp.lastValue !== undefined) return 'is-healthy';
  return 'is-pending-dot';
}

function tagStatusTitle(dp: DataPoint, isOrphan: boolean): string {
  if (isOrphan) return 'Orphaned: No Active Adapter Connection';
  if (dp.lastError) {
    return `Read Error (Consecutive Failures: ${dp.consecutiveFailures || 0}): ${dp.lastError}`;
  }
  if (dp.lastValue !== null && dp.lastValue !== undefined) return `Healthy: ${dp.lastValue}`;
  return 'Connecting...';
}

export default function TagGroupAccordion({
  adapter,
  tags,
  mqttDevices,
  selectedTagIds,
  toggleSelectTag,
  toggleSelectAllGroup,
  handleStartEdit,
  setDeletingPhysicalTag,
  onUnbindTag,
  isExpanded,
  onToggleExpand
}: TagGroupAccordionProps) {
  const [expandedTags, setExpandedTags] = useState<Record<string, boolean>>({});
  const [visibleLimit, setVisibleLimit] = useState(50);

  const isOrphan = adapter === null;
  const isEventDriven = !isOrphan && (adapter.protocol === 'WEBHOOK' || adapter.protocol === 'MQTT');
  const abnormalCount = tags.filter(dp => !!dp.lastError).length;
  const visibleTags = tags.slice(0, visibleLimit);
  const orphanClass = isOrphan ? 'is-orphan' : 'is-normal';

  let pollIntervalMs: number | null = null;
  if (adapter && adapter.protocol === 'REST_API' && adapter.configJson) {
    try {
      const config = JSON.parse(adapter.configJson);
      if (typeof config.PollIntervalMs === 'number') {
        pollIntervalMs = config.PollIntervalMs;
      }
    } catch (e) {
      // ignore
    }
  }

  const toggleTagDetails = (tagId: string) => {
    setExpandedTags(prev => ({ ...prev, [tagId]: !prev[tagId] }));
  };

  useEffect(() => {
    if (!isExpanded) setVisibleLimit(50);
  }, [isExpanded]);

  const renderMqttAddress = (dp: DataPoint) => {
    if (!isOrphan && adapter?.protocol === 'MQTT' && dp.mqttDeviceId) {
      const dev = mqttDevices.find(d => d.id === dp.mqttDeviceId);
      if (dev) {
        return (
          <div className="tag-mqtt-address">
            <span className="font-bold">{dev.name}</span>
            <span className="text-secondary">&gt;&gt;</span>
            <span className="text-mono-sm text-secondary">{dev.topicSubscription}</span>
            <span className="text-secondary">&gt;&gt;</span>
            <span className={`mqtt-parse-badge ${dp.mqttParseMode === 'JSON' ? 'is-json' : 'is-plaintext'}`}>
              {dp.mqttParseMode === 'JSON' ? `JSON: ${dp.mqttJsonPath || dp.address}` : 'Plaintext'}
            </span>
          </div>
        );
      }
    }
    return (
      <div className="tag-mqtt-address">
        <span>{dp.address}</span>
        {!isOrphan && adapter?.protocol === 'MQTT' && (
          <span className={`mqtt-parse-badge ${dp.mqttParseMode === 'JSON' ? 'is-json' : 'is-plaintext'}`}>
            {dp.mqttParseMode === 'JSON' ? `JSON: ${dp.mqttJsonPath}` : 'Plaintext'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={`tag-accordion${isOrphan ? ' is-orphan' : ''}`}>
      <button
        type="button"
        onClick={onToggleExpand}
        className={`tag-accordion-header ${orphanClass}${isExpanded ? ' is-expanded' : ''}`}
      >
        <div className="accordion-header-left">
          <div className={`accordion-chevron${isOrphan ? ' is-orphan' : ''}`}>
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </div>
          <div className="accordion-title-block">
            <div className="accordion-title-row">
              <strong className={`accordion-title${isOrphan ? ' is-orphan' : ''}`}>
                {isOrphan ? 'Unassigned Driver / Orphaned Tags' : adapter.name}
              </strong>
              {!isOrphan ? (
                <>
                  <span className={`badge badge-protocol-xs proto-${adapter.protocol.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}>{adapter.protocol.replace('_', ' ')}</span>
                  <div className="adapter-status-indicator">
                    <span className={`adapter-status-dot-sm ${adapterStatusClass(adapter.status)}`} />
                    <span className="badge-adapter-status">{adapter.status}</span>
                  </div>
                </>
              ) : (
                <span className="badge warning badge-orphan-warn">Missing Adapter</span>
              )}
            </div>
            <div className={`accordion-subtitle ${orphanClass}`}>
              {!isOrphan ? `${adapter.host}:${adapter.port}` : 'Tags associated with driver connections that have been deleted or are unassigned.'}
            </div>
          </div>
        </div>
        <div className="accordion-header-right">
          {!isOrphan && abnormalCount > 0 && (
            <span className="abnormal-badge">⚠️ {abnormalCount} Abnormal</span>
          )}
          <span className={`badge-count ${orphanClass}`}>
            {tags.length} tag{tags.length === 1 ? '' : 's'}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="accordion-body">
          {tags.length === 0 ? (
            <div className="accordion-empty">No physical tags registered.</div>
          ) : (
            <table className="data-table tag-table-wrap">
              <thead>
                <tr className={`tag-table-head-row ${orphanClass}`}>
                  <th className="tag-table-cell-center">
                    <input
                      type="checkbox"
                      className="tag-table-checkbox"
                      checked={tags.length > 0 && tags.every(t => selectedTagIds[t.id])}
                      onChange={() => toggleSelectAllGroup(tags)}
                    />
                  </th>
                  <th className="tag-table-cell-center" />
                  <th className="tag-table-cell-center">Status</th>
                  <th>Tag Address / Register</th>
                  <th>Data Type</th>
                  {!isEventDriven && <th>Scan Rate</th>}
                  <th>Live Value</th>
                  <th>Mapping</th>
                  <th className="tag-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTags.map(dp => {
                  const isMapped = dp.dataSourceId && dp.dataSourceId !== '';
                  const detailsExpanded = !!expandedTags[dp.id];
                  const rowSelected = !!selectedTagIds[dp.id];

                  return (
                    <React.Fragment key={dp.id}>
                      <tr
                        className={`tag-table-row ${orphanClass}${rowSelected ? ' is-selected' : ''}${detailsExpanded ? ' is-expanded' : ''}`}
                        onClick={() => toggleTagDetails(dp.id)}
                      >
                        <td className="tag-table-cell-center" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="tag-table-checkbox"
                            checked={rowSelected}
                            onClick={(e) => toggleSelectTag(dp.id, e)}
                            onChange={() => {}}
                          />
                        </td>
                        <td className="tag-table-cell-center" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleTagDetails(dp.id)}
                            className={`btn-tag-chevron${isOrphan ? ' is-orphan' : ''}`}
                          >
                            {detailsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td className="tag-table-cell-center" onClick={e => e.stopPropagation()}>
                          <span
                            className={`tag-status-dot-sm ${tagStatusClass(dp, isOrphan)}`}
                            title={tagStatusTitle(dp, isOrphan)}
                          />
                        </td>
                        <td className={`tag-address-cell${isOrphan ? ' is-orphan' : ''}`}>
                          {renderMqttAddress(dp)}
                          {dp.description && (
                            <div className={`tag-desc-sub${isOrphan ? ' is-orphan' : ''}`}>{dp.description}</div>
                          )}
                        </td>
                        <td>
                          <span className={`badge tag-dtype-badge${isOrphan ? ' is-orphan' : ''}`}>{dp.dataType}</span>
                        </td>
                        {!isEventDriven && (
                          <td>
                            {adapter?.protocol === 'REST_API'
                              ? `${pollIntervalMs ?? 10000}ms (Adapter)`
                              : `${dp.scanIntervalMs}ms`}
                          </td>
                        )}
                        <td className={`tag-live-cell${isOrphan ? ' is-orphan' : ''}`}>
                          {isOrphan ? (
                            'Offline (No Driver)'
                          ) : dp.lastError ? (
                            <div className="flex-col gap-sm">
                              <span className="tag-live-error-text">Read Error</span>
                              {dp.consecutiveFailures && dp.consecutiveFailures > 0 ? (
                                <span className="tag-retry-badge">
                                  Retry #{Math.min(3, dp.consecutiveFailures)} / Backoff {Math.min(64, Math.pow(2, Math.min(dp.consecutiveFailures, 6)))}x
                                </span>
                              ) : null}
                            </div>
                          ) : dp.lastValue !== null && dp.lastValue !== undefined ? (
                            <span className="tag-live-val-healthy">{formatLiveValue(dp.lastValue, dp.dataType)}</span>
                          ) : (
                            <span className="tag-mapping-unmapped">Connecting...</span>
                          )}
                        </td>
                        <td>
                          {isMapped ? (
                            <span className="badge success tag-mapping-badge-sm">
                              {dp.dataSourceId} ({dp.metric})
                            </span>
                          ) : (
                            <span className="tag-mapping-unmapped">Unmapped</span>
                          )}
                        </td>
                        <td className="tag-actions-col" onClick={e => e.stopPropagation()}>
                          <div className="tag-actions-group">
                            <button
                              type="button"
                              onClick={() => handleStartEdit(dp)}
                              title="Edit Tag Configuration"
                              className="btn-tag-action is-edit"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingPhysicalTag(dp)}
                              title="Delete Tag Configuration"
                              className="btn-tag-action is-delete"
                            >
                              <Trash2 size={14} />
                            </button>
                            {isMapped && (
                              <button
                                type="button"
                                onClick={() => onUnbindTag(dp.id)}
                                title={isOrphan ? 'Unbind Tag' : 'Unbind Tag from Data Stream'}
                                className="btn-unbind"
                              >
                                Unbind
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {detailsExpanded && (
                        <tr className={`tag-detail-row ${orphanClass}`}>
                          <td colSpan={9} onClick={e => e.stopPropagation()}>
                            <div className="tag-detail-grid">
                              <div className={`tag-detail-divider ${orphanClass}`}>
                                <div className={`detail-label${isOrphan ? ' is-orphan' : ''}`}>Description</div>
                                <div className={`tag-detail-desc-value${dp.description ? '' : ' is-empty'}`}>
                                  {dp.description || 'No description provided.'}
                                </div>
                              </div>
                              {isNumericType(dp.dataType) && (
                                <div className="tag-detail-section">
                                  <div className={`detail-label${isOrphan ? ' is-orphan' : ''}`}>Scaling & Math</div>
                                  <div className="detail-value">Scale Factor: <span className="tag-detail-mono">x{dp.scaleFactor}</span></div>
                                  <div className="detail-value detail-value-mt">Offset: <span className="tag-detail-mono">+{dp.offset}</span></div>
                                </div>
                              )}
                              {!isOrphan && adapter.protocol === 'MODBUS_TCP' && (
                                <div className="tag-detail-section">
                                  <div className="detail-label">Endianness (Modbus Only)</div>
                                  <div className="detail-value tag-detail-mono">
                                    Byte Order: {dp.byteOrder || (dp.dataType === 'Int16' || dp.dataType === 'UInt16' ? 'AB' : 'ABCD')}
                                  </div>
                                </div>
                              )}
                              <div className="tag-detail-section">
                                <div className={`detail-label${isOrphan ? ' is-orphan' : ''}`}>Diagnostics Metadata</div>
                                <div className={`detail-meta-mono${isOrphan ? ' is-orphan' : ''}`}>UUID: {dp.id}</div>
                                <div className={`detail-meta${isOrphan ? ' is-orphan' : ''}`}>
                                  {isOrphan
                                    ? `Adapter ID: ${dp.adapterId} (Deleted / Not Found)`
                                    : `Last Evaluated: ${dp.lastUpdated ? formatToLocalTimeString(dp.lastUpdated) : 'Never'}`}
                                </div>
                                {!isOrphan && dp.consecutiveFailures !== undefined && dp.consecutiveFailures > 0 && (
                                  <div className="tag-detail-failures">
                                    Consecutive Failures: {dp.consecutiveFailures} (Scan rate backed off to {Math.min(64, Math.pow(2, Math.min(dp.consecutiveFailures, 6)))}x)
                                  </div>
                                )}
                              </div>
                              {!isOrphan && dp.lastError && (
                                <div className="tag-detail-full">
                                  <div className="detail-label is-orphan">Trace Error Log</div>
                                  <div className="tag-error-box">{dp.lastError}</div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {tags.length > visibleLimit && (
                  <tr className={`show-more-row ${orphanClass}`}>
                    <td colSpan={9}>
                      <button
                        type="button"
                        onClick={() => setVisibleLimit(tags.length)}
                        className={`btn-show-more${isOrphan ? ' is-orphan' : ''}`}
                      >
                        Show More (+{tags.length - visibleLimit} tags)
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
