import { useState } from 'react';
import type { MqttDevice } from '../../types';
import CustomSelect from '../CustomSelect';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface MqttDeviceModalProps {
  onClose: () => void;
  editingDevice: MqttDevice | null;
  adapterId: string;
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function MqttDeviceModal({ onClose, editingDevice, adapterId, toast, fetchData }: MqttDeviceModalProps) {
  const [devName, setDevName] = useState(editingDevice?.name || '');
  const [devTopicSubscription, setDevTopicSubscription] = useState(editingDevice?.topicSubscription || '');
  const [devMqttParseMode, setDevMqttParseMode] = useState(editingDevice?.mqttParseMode || 'JSON');
  const devIsEnabled = editingDevice ? editingDevice.isEnabled : true;
  const [devLwtTopic, setDevLwtTopic] = useState(editingDevice?.lwtTopic || '');
  const [devLwtOnlinePayload, setDevLwtOnlinePayload] = useState(editingDevice?.lwtOnlinePayload || 'Online');
  const [devLwtOfflinePayload, setDevLwtOfflinePayload] = useState(editingDevice?.lwtOfflinePayload || 'Offline');

  const handleSaveMqttDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!devName || !devTopicSubscription || !adapterId) {
      toast.warning('Please fill in all required fields.');
      return;
    }
    try {
      const res = await fetch('/api/mqtt-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingDevice?.id || '',
          adapterId,
          name: devName,
          topicSubscription: devTopicSubscription,
          mqttParseMode: devMqttParseMode,
          isEnabled: devIsEnabled,
          lwtTopic: devLwtTopic || null,
          lwtOnlinePayload: devLwtOnlinePayload,
          lwtOfflinePayload: devLwtOfflinePayload,
          status: editingDevice?.status || 'Disconnected',
          lastError: editingDevice?.lastError || null,
          lastUpdated: editingDevice?.lastUpdated || null,
          consecutiveFailures: editingDevice?.consecutiveFailures || 0
        })
      });
      if (res.ok) {
        toast.success(editingDevice ? 'MQTT Device updated successfully.' : 'MQTT Device registered successfully.');
        onClose();
        fetchData();
      } else {
        toast.error('Failed to save MQTT Device configuration.');
      }
    } catch (err) {
      console.error('Failed to save MQTT Device:', err);
      toast.error('Failed to save MQTT Device configuration.');
    }
  };

  return (
    <ModalShell
      title={editingDevice ? 'Edit MQTT Device' : 'Add MQTT Device'}
      subtitle={editingDevice ? 'Modify settings for this MQTT device session.' : 'Define a new MQTT device session.'}
      size="md"
      onClose={onClose}
    >
      <form onSubmit={handleSaveMqttDevice} className="modal-form">
        <div className="form-group">
          <label className="form-label form-label-bold">Device Name</label>
          <input type="text" className="form-input" placeholder="e.g. Packer 01"
            value={devName} onChange={(e) => setDevName(e.target.value)} required />
        </div>

        <div className="form-group">
          <label className="form-label form-label-bold">Topic Subscription</label>
          <input type="text" className="form-input" placeholder="e.g. tele/packer01/SENSOR or tele/packer01/#"
            value={devTopicSubscription} onChange={(e) => setDevTopicSubscription(e.target.value)} required />
        </div>

        <div className="form-group">
          <label className="form-label form-label-bold">MQTT Parse Mode</label>
          <CustomSelect value={devMqttParseMode} onChange={(val) => setDevMqttParseMode(val)} options={[
            { value: 'JSON', label: 'Single-Topic JSON payload' },
            { value: 'Plaintext', label: 'Wildcard Multi-topic (Plaintext values)' }
          ]} />
        </div>

        <div className="lwt-section">
          <h4 className="lwt-title">Last Will &amp; Testament (LWT) / Connection Health</h4>

          <div className="form-group">
            <label className="form-label form-label-bold">LWT Topic (Optional)</label>
            <input type="text" className="form-input" placeholder="e.g. tele/packer01/LWT"
              value={devLwtTopic} onChange={(e) => setDevLwtTopic(e.target.value)} />
          </div>

          <div className="lwt-grid">
            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">LWT Online Value</label>
              <input type="text" className="form-input" value={devLwtOnlinePayload} onChange={(e) => setDevLwtOnlinePayload(e.target.value)} />
            </div>
            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">LWT Offline Value</label>
              <input type="text" className="form-input" value={devLwtOfflinePayload} onChange={(e) => setDevLwtOfflinePayload(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="modal-footer-end">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary">
            {editingDevice ? 'Save Changes' : 'Add Device'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
