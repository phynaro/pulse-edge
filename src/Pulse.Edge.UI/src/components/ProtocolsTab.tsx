import { useState } from 'react';
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
        {adapters.map((proto) => (
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
