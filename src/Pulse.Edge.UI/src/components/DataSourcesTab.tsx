import React, { useState, useEffect, useMemo } from 'react';
import { Database, Plus, Settings } from 'lucide-react';
import type { DataSource, DataPoint, DriverAdapter, StreamTemplate } from '../types';
import type { useToast } from '../hooks/useToast';

import FilterBar from './DataSourcesTab/FilterBar';
import DataSourceCard from './DataSourcesTab/DataSourceCard';
import CreateSourceModal from './DataSourcesTab/CreateSourceModal';
import BindMetricModal from './DataSourcesTab/BindMetricModal';
import UnbindConfirmModal from './DataSourcesTab/UnbindConfirmModal';
import ManageTemplatesModal from './DataSourcesTab/ManageTemplatesModal';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface DataSourcesTabProps {
  datasources: DataSource[];
  datapoints: DataPoint[];
  adapters: DriverAdapter[];
  handleToggleStreamEnabled: (ds: DataSource) => Promise<void>;
  handleDeleteDataPoint: (id: string) => Promise<void>;
  handleDeleteStream: (id: string) => Promise<void>;
  handleRenameStream: (ds: DataSource, newName: string) => Promise<void>;
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function DataSourcesTab({
  datasources,
  datapoints,
  adapters,
  handleToggleStreamEnabled,
  handleDeleteDataPoint,
  handleDeleteStream,
  handleRenameStream,
  fetchData,
  toast
}: DataSourcesTabProps) {
  const [streamSearchQuery, setStreamSearchQuery] = useState('');
  const [streamTypeFilter, setStreamTypeFilter] = useState('All');
  const [templates, setTemplates] = useState<StreamTemplate[]>([]);
  const [isManageTemplatesOpen, setIsManageTemplatesOpen] = useState(false);
  const [isCreateSourceOpen, setIsCreateSourceOpen] = useState(false);
  const [isAddPointOpen, setIsAddPointOpen] = useState(false);
  const [deletingDp, setDeletingDp] = useState<DataPoint | null>(null);
  const [newDpDataSourceId, setNewDpDataSourceId] = useState('');
  const [newDpMetric, setNewDpMetric] = useState('');

  const [orderedSources, setOrderedSources] = useState<DataSource[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Sync state with incoming filteredSources prop & sort by localStorage order
  const filteredSources = useMemo(() => {
    return datasources.filter(ds => {
      const matchesSearch = ds.name.toLowerCase().includes(streamSearchQuery.toLowerCase()) ||
                            ds.id.toLowerCase().includes(streamSearchQuery.toLowerCase()) ||
                            (ds.description && ds.description.toLowerCase().includes(streamSearchQuery.toLowerCase()));
      const matchesType = streamTypeFilter === 'All' || ds.type === streamTypeFilter;
      return matchesSearch && matchesType;
    });
  }, [datasources, streamSearchQuery, streamTypeFilter]);

  useEffect(() => {
    const savedOrder = localStorage.getItem('pulse-datasources-order');
    if (savedOrder) {
      try {
        const orderIds = JSON.parse(savedOrder) as string[];
        const sorted = [...filteredSources].sort((a, b) => {
          const idxA = orderIds.indexOf(a.id);
          const idxB = orderIds.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
        setOrderedSources(sorted);
        return;
      } catch (e) {
        console.error('Failed to parse saved datasources order:', e);
      }
    }
    setOrderedSources(filteredSources);
  }, [filteredSources]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnter = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const updated = [...orderedSources];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedItem);

    setDraggedIndex(targetIndex);
    setOrderedSources(updated);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    const visibleIds = orderedSources.map(ds => ds.id);
    const otherIds = datasources.filter(ds => !visibleIds.includes(ds.id)).map(ds => ds.id);
    const finalOrder = [...visibleIds, ...otherIds];
    localStorage.setItem('pulse-datasources-order', JSON.stringify(finalOrder));
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/stream-templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error('Failed to fetch stream templates:', err);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const onUnbindMetric = async (id: string) => {
    await handleDeleteDataPoint(id);
    setDeletingDp(null);
  };

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Database size={24} className="page-header-icon" />
            Telemetry Data Streams
          </h2>
          <p className="page-header-desc">
            Decouple edge raw telemetry signals from cloud business context. Configure connection metrics under logical stream channels.
          </p>
        </div>

        <div className="page-header-actions">
          <button type="button" onClick={() => setIsManageTemplatesOpen(true)} className="btn-secondary">
            <Settings size={18} />
            Manage Templates
          </button>
          <button type="button" onClick={() => setIsCreateSourceOpen(true)} className="btn-primary">
            <Plus size={18} />
            Create Data Source
          </button>
        </div>
      </div>

      <FilterBar
        streamSearchQuery={streamSearchQuery}
        setStreamSearchQuery={setStreamSearchQuery}
        streamTypeFilter={streamTypeFilter}
        setStreamTypeFilter={setStreamTypeFilter}
        templates={templates}
      />

      <div className="ds-grid">
        {orderedSources.length === 0 ? (
          <div className="panel empty-state-dashed">
            <div className="empty-state-icon">📭</div>
            <h4 className="empty-state-title">No Matching Data Sources Found</h4>
            <p className="empty-state-desc">
              Try clearing filters or click "Create Data Source" to establish a new telemetry path.
            </p>
          </div>
        ) : (
          orderedSources.map((ds, index) => (
            <DataSourceCard
              key={ds.id}
              ds={ds}
              datapoints={datapoints}
              adapters={adapters}
              templates={templates}
              handleToggleStreamEnabled={handleToggleStreamEnabled}
              handleDeleteStream={handleDeleteStream}
              handleRenameStream={handleRenameStream}
              setDeletingDp={setDeletingDp}
              onBindTag={(dsId, metric) => {
                setNewDpDataSourceId(dsId);
                setNewDpMetric(metric);
                setIsAddPointOpen(true);
              }}
              index={index}
              draggedIndex={draggedIndex}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragEnd={handleDragEnd}
            />
          ))
        )}
      </div>

      {isCreateSourceOpen && (
        <CreateSourceModal
          onClose={() => setIsCreateSourceOpen(false)}
          datasources={datasources}
          templates={templates}
          fetchData={fetchData}
          toast={toast}
        />
      )}

      {isAddPointOpen && (
        <BindMetricModal
          dataSourceId={newDpDataSourceId}
          initialMetric={newDpMetric}
          datasources={datasources}
          datapoints={datapoints}
          adapters={adapters}
          templates={templates}
          fetchData={fetchData}
          toast={toast}
          onClose={() => {
            setIsAddPointOpen(false);
            setNewDpDataSourceId('');
            setNewDpMetric('');
          }}
        />
      )}

      {deletingDp && (
        <UnbindConfirmModal
          deletingDp={deletingDp}
          onConfirm={onUnbindMetric}
          onCancel={() => setDeletingDp(null)}
        />
      )}

      {isManageTemplatesOpen && (
        <ManageTemplatesModal
          onClose={() => setIsManageTemplatesOpen(false)}
          datasources={datasources}
          templates={templates}
          fetchTemplates={fetchTemplates}
          fetchData={fetchData}
          toast={toast}
        />
      )}
    </div>
  );
}
