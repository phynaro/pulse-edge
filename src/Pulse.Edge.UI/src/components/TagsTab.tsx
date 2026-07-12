import React, { useState } from 'react';
import { Tag, Plus, Search, Trash2 } from 'lucide-react';
import type { DataPoint, DriverAdapter, MqttDevice } from '../types';
import type { useToast } from '../hooks/useToast';
import CreateTagWizard from './TagsTab/CreateTagWizard';
import EditTagModal from './TagsTab/EditTagModal';
import DeleteTagModal from './TagsTab/DeleteTagModal';
import BulkDeleteModal from './TagsTab/BulkDeleteModal';
import TagGroupAccordion from './TagsTab/TagGroupAccordion';
import { usePersistentOrder } from '../hooks/usePersistentOrder';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface TagsTabProps {
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  mqttDevices: MqttDevice[];
  handleDeleteDataPoint: (id: string) => Promise<void>;
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function TagsTab({ datapoints, adapters, mqttDevices, handleDeleteDataPoint, fetchData, toast }: TagsTabProps) {
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagProtocolFilter, setTagProtocolFilter] = useState('All');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedTagIds, setSelectedTagIds] = useState<Record<string, boolean>>({});
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
  const [editingPhysicalTag, setEditingPhysicalTag] = useState<DataPoint | null>(null);
  const [deletingPhysicalTag, setDeletingPhysicalTag] = useState<DataPoint | null>(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

  const [draggedAdapterIndex, setDraggedAdapterIndex] = useState<number | null>(null);
  const { orderedItems: orderedAdapters, saveOrder: saveAdapterOrder } = usePersistentOrder(adapters, 'pulse-adapters-order');

  const handleAdapterDragStart = (e: React.DragEvent, index: number) => {
    setDraggedAdapterIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleAdapterDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleAdapterDragEnter = (targetIndex: number) => {
    if (draggedAdapterIndex === null || draggedAdapterIndex === targetIndex) return;

    const updated = [...orderedAdapters];
    const [draggedItem] = updated.splice(draggedAdapterIndex, 1);
    updated.splice(targetIndex, 0, draggedItem);

    setDraggedAdapterIndex(targetIndex);
    saveAdapterOrder(updated);
  };

  const handleAdapterDragEnd = () => {
    setDraggedAdapterIndex(null);
  };

  const isSearchActive = tagSearchQuery.trim() !== '' || tagProtocolFilter !== 'All';

  const isGroupExpanded = (groupId: string, hasMatchingTags: boolean) => {
    if (expandedGroups[groupId] !== undefined) return expandedGroups[groupId];
    return isSearchActive ? hasMatchingTags : false;
  };

  const toggleGroup = (groupId: string, hasMatchingTags: boolean) => {
    setExpandedGroups(prev => {
      const current = isGroupExpanded(groupId, hasMatchingTags);
      return { ...prev, [groupId]: !current };
    });
  };

  const handleExpandAll = () => {
    const nextState: Record<string, boolean> = {};
    adapters.forEach(a => { nextState[a.id] = true; });
    nextState['orphans'] = true;
    setExpandedGroups(nextState);
  };

  const handleCollapseAll = () => {
    const nextState: Record<string, boolean> = {};
    adapters.forEach(a => { nextState[a.id] = false; });
    nextState['orphans'] = false;
    setExpandedGroups(nextState);
  };

  const filteredDatapoints = datapoints.filter(dp => {
    const adp = adapters.find(a => a.id === dp.adapterId);
    const matchesSearch =
      dp.address.toLowerCase().includes(tagSearchQuery.toLowerCase()) ||
      (dp.metric && dp.metric.toLowerCase().includes(tagSearchQuery.toLowerCase())) ||
      (dp.dataSourceId && dp.dataSourceId.toLowerCase().includes(tagSearchQuery.toLowerCase()));

    let matchesProto = true;
    if (tagProtocolFilter !== 'All') {
      if (tagProtocolFilter === 'OPC UA') matchesProto = adp?.protocol === 'OPC_UA';
      else if (tagProtocolFilter === 'MQTT') matchesProto = adp?.protocol === 'MQTT';
      else if (tagProtocolFilter === 'Modbus TCP') matchesProto = adp?.protocol === 'MODBUS_TCP';
      else if (tagProtocolFilter === 'Modbus RTU') matchesProto = adp?.protocol === 'MODBUS_RTU';
      else if (tagProtocolFilter === 'Ethernet/IP') matchesProto = adp?.protocol === 'Ethernet/IP';
      else if (tagProtocolFilter === 'Siemens S7') matchesProto = adp?.protocol === 'Siemens S7';
      else if (tagProtocolFilter === 'REST Webhook') matchesProto = adp?.protocol === 'WEBHOOK';
      else if (tagProtocolFilter === 'REST API') matchesProto = adp?.protocol === 'REST_API';
      else if (tagProtocolFilter === 'BACnet') matchesProto = adp?.protocol === 'BACnet';
      else if (tagProtocolFilter === 'Protocol Simulator') matchesProto = adp?.protocol === 'SIMULATOR';
    }
    return matchesSearch && matchesProto;
  }).sort((a, b) => a.address.localeCompare(b.address, undefined, {
    numeric: true,
    sensitivity: 'base'
  }));

  const [lastClickedTagId, setLastClickedTagId] = useState<string | null>(null);

  const toggleSelectTag = (id: string, e?: React.MouseEvent) => {
    setSelectedTagIds(prev => {
      const isChecking = !prev[id];
      const updated = { ...prev, [id]: isChecking };

      if (e?.shiftKey && lastClickedTagId) {
        const indexCurrent = filteredDatapoints.findIndex(dp => dp.id === id);
        const indexLast = filteredDatapoints.findIndex(dp => dp.id === lastClickedTagId);
        if (indexCurrent !== -1 && indexLast !== -1) {
          const start = Math.min(indexCurrent, indexLast);
          const end = Math.max(indexCurrent, indexLast);
          for (let i = start; i <= end; i++) {
            const tagId = filteredDatapoints[i].id;
            if (isChecking) updated[tagId] = true;
            else delete updated[tagId];
          }
        }
      }

      setLastClickedTagId(id);
      return updated;
    });
  };

  const toggleSelectAllGroup = (tags: DataPoint[]) => {
    const groupIds = tags.map(t => t.id);
    const allSelected = groupIds.every(id => selectedTagIds[id]);
    setSelectedTagIds(prev => {
      const updated = { ...prev };
      groupIds.forEach(id => {
        if (allSelected) delete updated[id];
        else updated[id] = true;
      });
      return updated;
    });
  };

  const onUnbindTag = async (id: string) => {
    await handleDeleteDataPoint(id);
    fetchData();
  };

  const selectedCount = Object.values(selectedTagIds).filter(Boolean).length;

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Tag size={24} className="page-header-icon" />
            Physical Data Points &amp; Tag Registry
          </h2>
          <p className="page-header-desc">
            Define and test physical sensor points (PLC registers, MQTT topics) before binding them to data streams. Verify connection health with live values.
          </p>
        </div>
        <div className="page-header-actions">
          <button onClick={() => setIsCreateTagOpen(true)} className="btn-primary">
            <Plus size={18} />
            Create Physical Tag
          </button>
        </div>
      </div>

      <div className="tag-filter-panel">
        <div className="tag-search-row">
          <div className="tag-search-inner">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search tags by address or metric..."
              value={tagSearchQuery}
              onChange={(e) => setTagSearchQuery(e.target.value)}
              className="form-input"
            />
          </div>
        </div>

        <div className="tag-protocol-chips">
          {['All', 'OPC UA', 'MQTT', 'Modbus TCP', 'Modbus RTU', 'Ethernet/IP', 'Siemens S7', 'REST Webhook', 'REST API', 'BACnet', 'Protocol Simulator'].map((cat) => (
            <button
              key={cat}
              onClick={() => setTagProtocolFilter(cat)}
              className={`tag-protocol-chip${tagProtocolFilter === cat ? ' is-active' : ''}`}
            >
              {cat === 'All' ? 'All Protocols' : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="accordion-summary-bar">
        <div>
          Found <strong className="text-strong">{filteredDatapoints.length}</strong> matching physical tag{filteredDatapoints.length === 1 ? '' : 's'} (total: {datapoints.length})
        </div>
        <div className="accordion-controls-row">
          <button onClick={handleExpandAll} className="accordion-link-btn">Expand All</button>
          <span className="accordion-divider">|</span>
          <button onClick={handleCollapseAll} className="accordion-link-btn">Collapse All</button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="bulk-action-bar">
          <span className="bulk-action-info">
            Selected <strong className="text-strong-danger">{selectedCount}</strong> tag(s) for actions
          </span>
          <div className="bulk-action-buttons">
            <button type="button" onClick={() => setIsBulkDeleteOpen(true)} className="btn-delete-bulk">
              <Trash2 size={14} /> Delete Selected
            </button>
            <button type="button" onClick={() => setSelectedTagIds({})} className="btn-clear-selection">
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {filteredDatapoints.length === 0 ? (
        <div className="tag-empty-dashed">
          <div className="empty-state-icon">🏷️</div>
          <h4 className="empty-state-title">No Physical Tags Found</h4>
          <p className="empty-state-desc">
            Try clearing filters or click "Create Physical Tag" to add a new sensor tag.
          </p>
        </div>
      ) : (
        <div className="accordion-groups" style={{ gap: '10px' }}>
          {orderedAdapters.map((adapter, index) => {
            const adapterTags = filteredDatapoints.filter(dp => dp.adapterId === adapter.id);
            const hasMatchingTags = adapterTags.length > 0;
            if (!hasMatchingTags) return null;
            const isDraggingThis = draggedAdapterIndex === index;
            return (
              <div
                key={adapter.id}
                draggable
                onDragStart={(e) => handleAdapterDragStart(e, index)}
                onDragOver={handleAdapterDragOver}
                onDragEnter={() => handleAdapterDragEnter(index)}
                onDragEnd={handleAdapterDragEnd}
                style={{
                  opacity: isDraggingThis ? 0.4 : 1,
                  transition: 'opacity 0.2s ease, transform 0.2s ease',
                  transform: isDraggingThis ? 'scale(0.99)' : 'none'
                }}
              >
                <TagGroupAccordion
                  adapter={adapter}
                  tags={adapterTags}
                  mqttDevices={mqttDevices}
                  selectedTagIds={selectedTagIds}
                  toggleSelectTag={toggleSelectTag}
                  toggleSelectAllGroup={toggleSelectAllGroup}
                  handleStartEdit={setEditingPhysicalTag}
                  setDeletingPhysicalTag={setDeletingPhysicalTag}
                  onUnbindTag={onUnbindTag}
                  isExpanded={isGroupExpanded(adapter.id, hasMatchingTags)}
                  onToggleExpand={() => toggleGroup(adapter.id, hasMatchingTags)}
                />
              </div>
            );
          })}

          {(() => {
            const orphanedTags = filteredDatapoints.filter(dp => !adapters.some(a => a.id === dp.adapterId));
            if (orphanedTags.length === 0) return null;
            return (
              <TagGroupAccordion
                adapter={null}
                tags={orphanedTags}
                mqttDevices={mqttDevices}
                selectedTagIds={selectedTagIds}
                toggleSelectTag={toggleSelectTag}
                toggleSelectAllGroup={toggleSelectAllGroup}
                handleStartEdit={setEditingPhysicalTag}
                setDeletingPhysicalTag={setDeletingPhysicalTag}
                onUnbindTag={onUnbindTag}
                isExpanded={isGroupExpanded('orphans', true)}
                onToggleExpand={() => toggleGroup('orphans', true)}
              />
            );
          })()}
        </div>
      )}

      {isCreateTagOpen && (
        <CreateTagWizard
          isOpen={isCreateTagOpen}
          onClose={() => setIsCreateTagOpen(false)}
          adapters={adapters}
          mqttDevices={mqttDevices}
          toast={toast}
          fetchData={fetchData}
        />
      )}

      <EditTagModal
        isOpen={editingPhysicalTag !== null}
        onClose={() => setEditingPhysicalTag(null)}
        tag={editingPhysicalTag}
        adapters={adapters}
        mqttDevices={mqttDevices}
        toast={toast}
        fetchData={fetchData}
      />

      <DeleteTagModal
        isOpen={deletingPhysicalTag !== null}
        onClose={() => setDeletingPhysicalTag(null)}
        tag={deletingPhysicalTag}
        toast={toast}
        fetchData={fetchData}
      />

      <BulkDeleteModal
        isOpen={isBulkDeleteOpen}
        onClose={() => setIsBulkDeleteOpen(false)}
        selectedTagIds={selectedTagIds}
        setSelectedTagIds={setSelectedTagIds}
        filteredDatapoints={filteredDatapoints}
        adapters={adapters}
        toast={toast}
        fetchData={fetchData}
      />
    </div>
  );
}
