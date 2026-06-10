import React, { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface OpcNode {
  nodeId: string;
  displayName: string;
  nodeClass: 'Object' | 'Variable' | string;
  dataType?: string;
}

interface OpcPathItem {
  nodeId: string | null;
  displayName: string;
}

interface OpcConfiguringTag {
  nodeId: string;
  displayName: string;
  tagName: string;
  dataType: string;
  scanIntervalMs: number;
  description: string;
}

interface OpcBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  adapterId: string;
  adapters: DriverAdapter[];
  toast: ToastFn;
  onSaveSuccess: () => void;
}

export default function OpcBrowserModal({
  isOpen,
  onClose,
  adapterId,
  adapters,
  toast,
  onSaveSuccess
}: OpcBrowserModalProps) {
  const [opcBrowserLoading, setOpcBrowserLoading] = useState(false);
  const [opcBrowserError, setOpcBrowserError] = useState('');
  const [opcBrowserNodes, setOpcBrowserNodes] = useState<OpcNode[]>([]);
  const [opcBrowserPath, setOpcBrowserPath] = useState<OpcPathItem[]>([
    { nodeId: null, displayName: 'Root' }
  ]);
  const [opcSelectedNodes, setOpcSelectedNodes] = useState<Record<string, OpcNode>>({});
  const [opcBrowserStep, setOpcBrowserStep] = useState(1);
  const [opcConfiguringTags, setOpcConfiguringTags] = useState<OpcConfiguringTag[]>([]);

  const activeAdapter = adapters.find(a => a.id === adapterId);
  const selectedCount = Object.keys(opcSelectedNodes).length;

  const fetchOpcNodes = async (targetAdapterId: string, nodeId: string | null = null) => {
    setOpcBrowserLoading(true);
    setOpcBrowserError('');
    try {
      const res = await fetch('/api/adapters/opcua/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId: targetAdapterId, nodeId })
      });
      const data = await res.json();
      if (data.success) {
        setOpcBrowserNodes(data.nodes || []);
      } else {
        setOpcBrowserError(data.message || 'Failed to fetch nodes.');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred.';
      setOpcBrowserError(errorMessage);
    } finally {
      setOpcBrowserLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && adapterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpcBrowserStep(1);
      setOpcSelectedNodes({});
      setOpcBrowserPath([{ nodeId: null, displayName: 'Root' }]);
      fetchOpcNodes(adapterId, null);
    }
  }, [isOpen, adapterId]);

  const handleToggleOpcNode = (node: OpcNode) => {
    setOpcSelectedNodes(prev => {
      const next = { ...prev };
      if (next[node.nodeId]) delete next[node.nodeId];
      else next[node.nodeId] = node;
      return next;
    });
  };

  const handleEnterOpcFolder = (node: OpcNode) => {
    const newPath = [...opcBrowserPath, { nodeId: node.nodeId, displayName: node.displayName }];
    setOpcBrowserPath(newPath);
    fetchOpcNodes(adapterId, node.nodeId);
  };

  const handleOpcBreadcrumbClick = (index: number) => {
    const newPath = opcBrowserPath.slice(0, index + 1);
    setOpcBrowserPath(newPath);
    fetchOpcNodes(adapterId, newPath[index].nodeId);
  };

  const handleOpcNextStep = () => {
    const selectedList = Object.values(opcSelectedNodes);
    if (selectedList.length === 0) {
      toast.warning('Please select at least one variable node.');
      return;
    }
    setOpcConfiguringTags(selectedList.map(node => {
      const tagName = node.displayName.replace(/[^a-zA-Z0-9_]/g, '_');
      return {
        nodeId: node.nodeId,
        displayName: node.displayName,
        tagName,
        dataType: node.dataType || 'Double',
        scanIntervalMs: 1000,
        description: tagName
      };
    }));
    setOpcBrowserStep(2);
  };

  const handleUpdateConfiguringTag = (index: number, key: keyof OpcConfiguringTag, value: string | number) => {
    setOpcConfiguringTags(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value } as OpcConfiguringTag;
      return next;
    });
  };

  const handleSaveOpcTags = async () => {
    let successes = 0;
    let failures = 0;
    setOpcBrowserLoading(true);
    try {
      for (const tag of opcConfiguringTags) {
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
          mqttParseMode: 'Plaintext',
          mqttJsonPath: null,
          address: tag.nodeId
        };
        const res = await fetch('/api/datapoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) successes++;
        else failures++;
      }
      if (successes > 0) toast.success(`Successfully created ${successes} OPC UA tags.`);
      if (failures > 0) toast.error(`Failed to create ${failures} tags.`);
      onSaveSuccess();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      toast.error('An error occurred while saving tags: ' + errorMessage);
    } finally {
      setOpcBrowserLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell
      title="OPC UA Node Browser"
      subtitle={activeAdapter ? `${activeAdapter.name} (${activeAdapter.host})` : undefined}
      size="browser"
      bodyClassName="browser-modal-body"
      onClose={onClose}
    >
      {opcBrowserStep === 1 ? (
        <div className="browser-layout">
          <div className="browser-left-pane">
            <div className="browser-breadcrumb-wrap">
              <span className="browser-section-label">Browse Path</span>
              <div className="browser-breadcrumb">
                {opcBrowserPath.map((item, idx) => (
                  <React.Fragment key={idx}>
                    {idx > 0 && <span className="browser-breadcrumb-sep">/</span>}
                    <span
                      onClick={() => handleOpcBreadcrumbClick(idx)}
                      className={`browser-crumb${idx === opcBrowserPath.length - 1 ? ' is-current' : ''}`}
                    >
                      {item.displayName}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {opcBrowserLoading && opcBrowserNodes.length === 0 ? (
              <div className="browser-loading">
                <div className="opc-spinner" />
                <span className="browser-loading-text">Connecting and browsing address space...</span>
              </div>
            ) : opcBrowserError ? (
              <div className="browser-error-state">
                <AlertTriangle color="var(--danger-color)" size={32} />
                <span className="browser-error-title">Browse Failed</span>
                <span className="browser-error-desc">{opcBrowserError}</span>
                <button
                  type="button"
                  onClick={() => fetchOpcNodes(adapterId, opcBrowserPath[opcBrowserPath.length - 1].nodeId)}
                  className="btn-browser-retry"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <div className="browser-node-section">
                <span className="browser-available-label">Available Nodes</span>
                {opcBrowserNodes.length === 0 ? (
                  <div className="browser-folder-empty">
                    This folder is empty or contains no browsable Objects or Variables.
                  </div>
                ) : (
                  <div className="browser-node-list">
                    {opcBrowserNodes.map((node) => {
                      const isSelected = !!opcSelectedNodes[node.nodeId];
                      const isFolder = node.nodeClass === 'Object';
                      return (
                        <div
                          key={node.nodeId}
                          className={`browser-node-item${isSelected ? ' is-selected' : ''}`}
                          onClick={() => { if (!isFolder) handleToggleOpcNode(node); }}
                        >
                          {isFolder ? (
                            <div className="browser-folder-icon">📂</div>
                          ) : (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleOpcNode(node)}
                              className="browser-checkbox"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                          <div className="browser-node-details">
                            <div className="browser-node-name">{node.displayName}</div>
                            <div className="browser-node-id">{node.nodeId}</div>
                          </div>
                          {isFolder ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleEnterOpcFolder(node); }}
                              className="browser-folder-btn"
                            >
                              Open →
                            </button>
                          ) : (
                            node.dataType && <span className="browser-type-chip">{node.dataType}</span>
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
            <div className="browser-right-header">
              <span className="browser-section-label">Selected Nodes ({selectedCount})</span>
              {selectedCount > 0 && (
                <button type="button" onClick={() => setOpcSelectedNodes({})} className="browser-clear-btn">
                  Clear All
                </button>
              )}
            </div>
            {selectedCount === 0 ? (
              <div className="browser-empty-right">
                <span className="browser-empty-icon">📋</span>
                <span className="browser-empty-text">Select variable nodes from the tree on the left to add them as tags.</span>
              </div>
            ) : (
              <div className="browser-selected-list">
                {Object.values(opcSelectedNodes).map((node) => (
                  <div key={node.nodeId} className="browser-selected-item">
                    <div className="browser-selected-details">
                      <div className="browser-selected-name">{node.displayName}</div>
                      <div className="browser-selected-id">{node.nodeId}</div>
                    </div>
                    <button type="button" onClick={() => handleToggleOpcNode(node)} className="btn-browser-remove">✕</button>
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
                  <th>Node Display Name</th>
                  <th>Tag Name</th>
                  <th>Data Type</th>
                  <th>Scan Rate (ms)</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {opcConfiguringTags.map((tag, idx) => (
                  <tr key={tag.nodeId}>
                    <td className="browser-cell-max">
                      <div className="browser-cell-name">{tag.displayName}</div>
                      <div className="browser-cell-id-sm">{tag.nodeId}</div>
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
                          { value: 'Int16', label: 'Int16' }, { value: 'UInt16', label: 'UInt16' },
                          { value: 'Int32', label: 'Int32' }, { value: 'UInt32', label: 'UInt32' },
                          { value: 'Float', label: 'Float' }, { value: 'Double', label: 'Double' },
                          { value: 'Int64', label: 'Int64' }, { value: 'UInt64', label: 'UInt64' },
                          { value: 'Boolean', label: 'Boolean' }, { value: 'String', label: 'String' }
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
        {opcBrowserStep === 1 ? (
          <>
            <span className="browser-footer-count">{selectedCount} nodes selected</span>
            <div className="browser-footer-btns">
              <button type="button" onClick={onClose} className="btn-browser-cancel">Cancel</button>
              <button
                type="button"
                onClick={handleOpcNextStep}
                disabled={selectedCount === 0}
                className={`btn-browser-next${selectedCount === 0 ? ' is-empty' : ' is-ready'}`}
              >
                Next Step →
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpcBrowserStep(1)}
              disabled={opcBrowserLoading}
              className="btn-browser-back"
            >
              ← Back to Tree
            </button>
            <button
              type="button"
              onClick={handleSaveOpcTags}
              disabled={opcBrowserLoading}
              className="btn-browser-save"
            >
              {opcBrowserLoading ? 'Saving Tags...' : 'Save & Add Tags'}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}
