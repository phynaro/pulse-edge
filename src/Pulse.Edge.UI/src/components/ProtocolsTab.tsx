import React, { useState, useEffect } from 'react';
import { Network, Plus } from 'lucide-react';
import type { DriverAdapter, DataPoint, MqttDevice } from '../types';
import type { useToast } from '../hooks/useToast';

import AdapterCard from './ProtocolsTab/AdapterCard';
import MqttDeviceModal from './ProtocolsTab/MqttDeviceModal';
import CreateAdapterWizard from './ProtocolsTab/CreateAdapterWizard';
import EditAdapterModal from './ProtocolsTab/EditAdapterModal';
import DeleteAdapterModal from './ProtocolsTab/DeleteAdapterModal';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface ProtocolsTabProps {
  adapters: DriverAdapter[];
  datapoints: DataPoint[];
  mqttDevices: MqttDevice[];
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function ProtocolsTab({
  adapters,
  datapoints,
  mqttDevices,
  fetchData,
  toast
}: ProtocolsTabProps) {
  const [isCreateAdapterOpen, setIsCreateAdapterOpen] = useState(false);
  const [editingAdapter, setEditingAdapter] = useState<DriverAdapter | null>(null);
  const [deletingAdapter, setDeletingAdapter] = useState<DriverAdapter | null>(null);
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<MqttDevice | null>(null);
  const [deviceAdapterId, setDeviceAdapterId] = useState('');

  const [orderedAdapters, setOrderedAdapters] = useState<DriverAdapter[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Sync state with incoming adapters prop & sort by localStorage order
  useEffect(() => {
    const savedOrder = localStorage.getItem('pulse-adapters-order');
    if (savedOrder) {
      try {
        const orderIds = JSON.parse(savedOrder) as string[];
        const sorted = [...adapters].sort((a, b) => {
          const idxA = orderIds.indexOf(a.id);
          const idxB = orderIds.indexOf(b.id);
          if (idxA === -1 && idxB === -1) return 0;
          if (idxA === -1) return 1;
          if (idxB === -1) return -1;
          return idxA - idxB;
        });
        setOrderedAdapters(sorted);
        return;
      } catch (e) {
        console.error('Failed to parse saved adapters order:', e);
      }
    }
    setOrderedAdapters(adapters);
  }, [adapters]);

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

    const updated = [...orderedAdapters];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedItem);

    setDraggedIndex(targetIndex);
    setOrderedAdapters(updated);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    const orderIds = orderedAdapters.map(a => a.id);
    localStorage.setItem('pulse-adapters-order', JSON.stringify(orderIds));
  };

  return (
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Network size={24} className="page-header-icon" />
            Protocol Connection Adapters
          </h2>
          <p className="page-header-desc">
            Manage local hardware connection drivers and configurations.
          </p>
        </div>
        <div className="page-header-actions">
          <button type="button" onClick={() => setIsCreateAdapterOpen(true)} className="btn-primary">
            <Plus size={18} />
            Add Driver Adapter
          </button>
        </div>
      </div>

      <div className="adapter-grid">
        {orderedAdapters.map((proto, index) => (
          <AdapterCard
            key={proto.id}
            adapter={proto}
            mqttDevices={mqttDevices}
            onStartEdit={(a) => setEditingAdapter(a)}
            onStartDelete={(a) => setDeletingAdapter(a)}
            onAddMqttDevice={(adapterId) => {
              setEditingDevice(null);
              setDeviceAdapterId(adapterId);
              setIsDeviceModalOpen(true);
            }}
            onEditMqttDevice={(dev) => {
              setEditingDevice(dev);
              setDeviceAdapterId(dev.adapterId);
              setIsDeviceModalOpen(true);
            }}
            toast={toast}
            fetchData={fetchData}
            index={index}
            draggedIndex={draggedIndex}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {isDeviceModalOpen && (
        <MqttDeviceModal
          key={editingDevice ? editingDevice.id : `new-${deviceAdapterId}`}
          editingDevice={editingDevice}
          adapterId={deviceAdapterId}
          toast={toast}
          fetchData={fetchData}
          onClose={() => {
            setIsDeviceModalOpen(false);
            setEditingDevice(null);
            setDeviceAdapterId('');
          }}
        />
      )}

      {isCreateAdapterOpen && (
        <CreateAdapterWizard
          onClose={() => setIsCreateAdapterOpen(false)}
          toast={toast}
          fetchData={fetchData}
        />
      )}

      {editingAdapter !== null && (
        <EditAdapterModal
          key={editingAdapter.id}
          adapter={editingAdapter}
          toast={toast}
          fetchData={fetchData}
          onClose={() => setEditingAdapter(null)}
        />
      )}

      {deletingAdapter !== null && (
        <DeleteAdapterModal
          adapter={deletingAdapter}
          datapoints={datapoints}
          toast={toast}
          fetchData={fetchData}
          onClose={() => setDeletingAdapter(null)}
        />
      )}
    </div>
  );
}
