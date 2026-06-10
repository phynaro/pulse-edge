
import { Plus, Edit, Trash2 } from 'lucide-react';
import type { DriverAdapter, MqttDevice } from '../../types';
import type { useToast } from '../../hooks/useToast';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface AdapterCardProps {
  adapter: DriverAdapter;
  mqttDevices: MqttDevice[];
  onStartEdit: (adapter: DriverAdapter) => void;
  onStartDelete: (adapter: DriverAdapter) => void;
  onAddMqttDevice: (adapterId: string) => void;
  onEditMqttDevice: (device: MqttDevice) => void;
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function AdapterCard({
  adapter,
  mqttDevices,
  onStartEdit,
  onStartDelete,
  onAddMqttDevice,
  onEditMqttDevice,
  toast,
  fetchData
}: AdapterCardProps) {
  const isActive = adapter.status === 'Connected' && adapter.isEnabled;
  const adapterMqttDevices = mqttDevices.filter(d => d.adapterId === adapter.id);

  const handleDeleteMqttDevice = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this MQTT Device? Any associated metrics will be unlinked.')) {
      return;
    }

    try {
      const res = await fetch(`/api/mqtt-devices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('MQTT Device deleted successfully.');
        fetchData();
      } else {
        toast.error('Failed to delete MQTT Device.');
      }
    } catch (err) {
      console.error('Failed to delete MQTT Device:', err);
      toast.error('Failed to delete MQTT Device.');
    }
  };

  return (
    <div className="panel adapter-card">
      <div>
        <div className="panel-header adapter-panel-header">
          <h3 className="panel-title adapter-panel-title">{adapter.name}</h3>
          <span className={`badge ${isActive ? 'success' : 'warning'}`}>
            {!adapter.isEnabled ? 'Disabled' : adapter.status === 'Connected' ? 'Active' : 'Offline'}
          </span>
        </div>

        <div className="adapter-info-body">
          <div>
            <span className="adapter-info-label">Protocol: </span>
            <span className="badge primary badge-protocol">{adapter.protocol}</span>
          </div>
          <div className="adapter-info-row">
            <span className="adapter-info-label">Host: </span>
            <span className="adapter-info-mono">{adapter.host}</span>
          </div>
          <div>
            <span className="adapter-info-label">Port: </span>
            <span className="adapter-info-mono">{adapter.port}</span>
          </div>

          <div className="adapter-info-section">
            <span className="adapter-config-label">Configuration Parameters:</span>
            {(() => {
              let config: Record<string, unknown> = {};
              let hasError = false;
              try { config = JSON.parse(adapter.configJson || '{}'); } catch { hasError = true; }

              if (hasError) {
                return <span className="adapter-info-error">Invalid JSON config</span>;
              }

              if (adapter.protocol === 'MODBUS_TCP') {
                return (
                  <div className="adapter-badge-group">
                    <span className="badge neutral badge-config">Unit ID: {String(config.UnitId ?? 1)}</span>
                    <span className="badge neutral badge-config">Timeout: {String(config.TimeoutMs ?? 1000)} ms</span>
                    <span className="badge neutral badge-config">Retries: {String(config.Retries ?? 3)}</span>
                  </div>
                );
              } else if (adapter.protocol === 'OPC_UA') {
                const hasAuth = !!config.Username;
                return (
                  <div className="adapter-badge-group">
                    <span className="badge neutral badge-config">Security: {String(config.SecurityMode ?? 'None')}</span>
                    <span className="badge neutral badge-config">Policy: {String(config.SecurityPolicy ?? 'None')}</span>
                    <span className="badge neutral badge-config">Auth: {hasAuth ? 'Credentials' : 'None'}</span>
                  </div>
                );
              } else if (adapter.protocol === 'MQTT') {
                const hasAuth = !!config.Username;
                return (
                  <div className="adapter-badge-group">
                    <span className="badge neutral badge-config">Client: {String(config.ClientId ?? 'pulse-agent')}</span>
                    {config.TopicPrefix != null && String(config.TopicPrefix) !== '' && (
                      <span className="badge neutral badge-config">Prefix: {String(config.TopicPrefix)}</span>
                    )}
                    <span className="badge neutral badge-config">Auth: {hasAuth ? 'Credentials' : 'Anonymous'}</span>
                  </div>
                );
              }
              return <span className="adapter-info-muted">No parameters</span>;
            })()}
          </div>

          {adapter.protocol === 'MQTT' && (
            <div className="adapter-info-section">
              <div className="mqtt-devices-header">
                <span className="mqtt-devices-title">MQTT Devices (Sessions):</span>
                <button type="button" onClick={() => onAddMqttDevice(adapter.id)} className="btn-add-device">
                  <Plus size={12} /> Add Device
                </button>
              </div>

              {adapterMqttDevices.length === 0 ? (
                <div className="mqtt-device-empty">No devices configured.</div>
              ) : (
                <div className="mqtt-device-list">
                  {adapterMqttDevices.map(dev => (
                    <div key={dev.id} className="mqtt-device-item">
                      <div className="mqtt-device-name-row">
                        <span className="mqtt-device-name">{dev.name}</span>
                        <div className="mqtt-device-controls">
                          <span className={`badge badge-device-status ${dev.status === 'Connected' ? 'success' : dev.status === 'Offline' ? 'warning' : 'danger'}`}>
                            {dev.status}
                          </span>
                          <button type="button" onClick={() => onEditMqttDevice(dev)} className="btn-icon-xs" title="Edit Device">
                            <Edit size={12} />
                          </button>
                          <button type="button" onClick={() => handleDeleteMqttDevice(dev.id)} className="btn-icon-xs is-danger" title="Delete Device">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="mqtt-device-meta">
                        <div><span className="meta-label">Topic:</span> <code className="code-break">{dev.topicSubscription}</code></div>
                        <div>
                          <span className="meta-label">Mode:</span>{' '}
                          <span className="badge neutral mqtt-parse-badge">{dev.mqttParseMode === 'JSON' ? 'Single-Topic JSON' : 'Wildcard Multi-Topic'}</span>
                        </div>
                        {dev.lwtTopic && (
                          <div><span className="meta-label">LWT Topic:</span> <code className="code-break">{dev.lwtTopic}</code></div>
                        )}
                        {dev.lastError && (
                          <div className="mqtt-device-error">Error: {dev.lastError}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="adapter-action-row">
        <button onClick={() => onStartEdit(adapter)} className="btn-adapter-edit">
          Edit Adapter Config
        </button>
        <button onClick={() => onStartDelete(adapter)} title="Delete Adapter" className="btn-adapter-delete">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
