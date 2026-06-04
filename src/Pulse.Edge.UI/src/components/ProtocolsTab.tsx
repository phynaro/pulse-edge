import React, { useState } from 'react';
import { 
  Plus, 
  RefreshCw, 
  Trash2, 
  AlertTriangle,
  Network
} from 'lucide-react';
import type { DriverAdapter, DataPoint } from '../types';
import type { useToast } from '../hooks/useToast';
import CustomSelect from './CustomSelect';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface ProtocolsTabProps {
  adapters: DriverAdapter[];
  datapoints: DataPoint[];
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

export default function ProtocolsTab({
  adapters,
  datapoints,
  fetchData,
  toast
}: ProtocolsTabProps) {

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAdapterName, setEditAdapterName] = useState('');
  const [editAdapterProtocol, setEditAdapterProtocol] = useState('MQTT');
  const [editAdapterHost, setEditAdapterHost] = useState('');
  const [editAdapterPort, setEditAdapterPort] = useState(1883);
  const [editAdapterIsEnabled, setEditAdapterIsEnabled] = useState(true);

  // Edit form protocol-specific states
  const [editModbusUnitId, setEditModbusUnitId] = useState<number>(1);
  const [editModbusTimeout, setEditModbusTimeout] = useState<number>(1000);
  const [editModbusRetries, setEditModbusRetries] = useState<number>(3);

  const [editOpcSecurityMode, setEditOpcSecurityMode] = useState<string>('None');
  const [editOpcSecurityPolicy, setEditOpcSecurityPolicy] = useState<string>('None');
  const [editOpcUsername, setEditOpcUsername] = useState<string>('');
  const [editOpcPassword, setEditOpcPassword] = useState<string>('');

  const [editMqttClientId, setEditMqttClientId] = useState<string>('pulse-edge-agent');
  const [editMqttTopicPrefix, setEditMqttTopicPrefix] = useState<string>('');
  const [editMqttUsername, setEditMqttUsername] = useState<string>('');
  const [editMqttPassword, setEditMqttPassword] = useState<string>('');

  // Creation state
  const [isCreateAdapterOpen, setIsCreateAdapterOpen] = useState(false);
  const [newAdapterName, setNewAdapterName] = useState('');
  const [newAdapterProtocol, setNewAdapterProtocol] = useState('OPC_UA');
  const [newAdapterHost, setNewAdapterHost] = useState('');
  const [newAdapterPort, setNewAdapterPort] = useState(4840);

  // Creation form protocol-specific states
  const [newModbusUnitId, setNewModbusUnitId] = useState<number>(1);
  const [newModbusTimeout, setNewModbusTimeout] = useState<number>(1000);
  const [newModbusRetries, setNewModbusRetries] = useState<number>(3);

  const [newOpcSecurityMode, setNewOpcSecurityMode] = useState<string>('None');
  const [newOpcSecurityPolicy, setNewOpcSecurityPolicy] = useState<string>('None');
  const [newOpcUsername, setNewOpcUsername] = useState<string>('');
  const [newOpcPassword, setNewOpcPassword] = useState<string>('');

  const [newMqttClientId, setNewMqttClientId] = useState<string>('pulse-edge-agent');
  const [newMqttTopicPrefix, setNewMqttTopicPrefix] = useState<string>('');
  const [newMqttUsername, setNewMqttUsername] = useState<string>('');
  const [newMqttPassword, setNewMqttPassword] = useState<string>('');

  // Deletion state
  const [deletingAdapter, setDeletingAdapter] = useState<DriverAdapter | null>(null);

  // Connection test states
  const [createTestStatus, setCreateTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [createTestMessage, setCreateTestMessage] = useState('');
  const [editTestStatus, setEditTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [editTestMessage, setEditTestMessage] = useState('');

  // OPC UA Discovery States
  const [opcEndpoints, setOpcEndpoints] = useState<any[]>([]);
  const [opcDiscoverStatus, setOpcDiscoverStatus] = useState<'idle' | 'discovering' | 'success' | 'error'>('idle');
  const [opcDiscoverMessage, setOpcDiscoverMessage] = useState('');

  const handleDiscoverOpcUa = async (host: string, port: number) => {
    if (!host) {
      toast.warning('Please enter a Connection Host/IP before discovering.');
      return;
    }

    setOpcDiscoverStatus('discovering');
    setOpcDiscoverMessage('');
    setOpcEndpoints([]);

    const discoveryUrl = `opc.tcp://${host}:${port}`;
    try {
      const res = await fetch('/api/adapters/opcua/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discoveryUrl })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOpcEndpoints(data.endpoints || []);
          setOpcDiscoverStatus('success');
          if (!data.endpoints || data.endpoints.length === 0) {
            setOpcDiscoverMessage('No endpoints were returned by the discovery service.');
          }
        } else {
          setOpcDiscoverStatus('error');
          setOpcDiscoverMessage(data.message);
        }
      } else {
        const errorText = await res.text();
        setOpcDiscoverStatus('error');
        setOpcDiscoverMessage(`HTTP Error ${res.status}: ${errorText || 'Internal Server Error'}`);
      }
    } catch (err) {
      setOpcDiscoverStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      setOpcDiscoverMessage(`Network error: ${msg}`);
    }
  };

  const handleTestConnection = async (host: string, port: number, isEdit: boolean) => {
    const setStatus = isEdit ? setEditTestStatus : setCreateTestStatus;
    const setMessage = isEdit ? setEditTestMessage : setCreateTestMessage;

    if (!host) {
      toast.warning('Please enter a Connection Host/IP before testing.');
      return;
    }

    setStatus('testing');
    setMessage('');

    try {
      const res = await fetch('/api/adapters/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStatus('passed');
          setMessage(data.message);
        } else {
          setStatus('failed');
          setMessage(data.message);
        }
      } else {
        const errorText = await res.text();
        setStatus('failed');
        setMessage(`HTTP Error ${res.status}: ${errorText || 'Internal Server Error'}`);
      }
    } catch (err) {
      setStatus('failed');
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(`Network error: ${msg}`);
    }
  };

  const startEdit = (proto: DriverAdapter) => {
    setEditingId(proto.id);
    setEditAdapterName(proto.name);
    setEditAdapterProtocol(proto.protocol);
    setEditAdapterHost(proto.host);
    setEditAdapterPort(proto.port);
    setEditAdapterIsEnabled(proto.isEnabled);
    setEditTestStatus('idle');
    setEditTestMessage('');

    // Parse config settings from ConfigJson
    try {
      const config = JSON.parse(proto.configJson || '{}');
      if (proto.protocol === 'MODBUS_TCP') {
        setEditModbusUnitId(config.UnitId ?? 1);
        setEditModbusTimeout(config.TimeoutMs ?? 1000);
        setEditModbusRetries(config.Retries ?? 3);
      } else if (proto.protocol === 'OPC_UA') {
        setEditOpcSecurityMode(config.SecurityMode ?? 'None');
        setEditOpcSecurityPolicy(config.SecurityPolicy ?? 'None');
        setEditOpcUsername(config.Username ?? '');
        setEditOpcPassword(config.Password ?? '');
      } else if (proto.protocol === 'MQTT') {
        setEditMqttClientId(config.ClientId ?? 'pulse-edge-agent');
        setEditMqttTopicPrefix(config.TopicPrefix ?? '');
        setEditMqttUsername(config.Username ?? '');
        setEditMqttPassword(config.Password ?? '');
      }
    } catch (e) {
      console.error('Failed to parse configJson on editing:', e);
      // set defaults
      setEditModbusUnitId(1);
      setEditModbusTimeout(1000);
      setEditModbusRetries(3);
      setEditOpcSecurityMode('None');
      setEditOpcSecurityPolicy('None');
      setEditOpcUsername('');
      setEditOpcPassword('');
      setEditMqttClientId('pulse-edge-agent');
      setEditMqttTopicPrefix('');
      setEditMqttUsername('');
      setEditMqttPassword('');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTestStatus('idle');
    setEditTestMessage('');
  };

  const saveProtocol = async (id: string) => {
    if (editTestStatus !== 'passed') {
      const reason = editTestStatus === 'failed' 
        ? `\nReason: ${editTestMessage}` 
        : '\nNo connection test was run.';
      const confirmSave = window.confirm(`Warning: The connection test to ${editAdapterHost}:${editAdapterPort} did not pass.${reason}\n\nAre you sure you want to save this configuration anyway?`);
      if (!confirmSave) {
        return;
      }
    }

    try {
      let configJson = '{}';
      if (editAdapterProtocol === 'MODBUS_TCP') {
        configJson = JSON.stringify({
          UnitId: Number(editModbusUnitId),
          TimeoutMs: Number(editModbusTimeout),
          Retries: Number(editModbusRetries)
        });
      } else if (editAdapterProtocol === 'OPC_UA') {
        configJson = JSON.stringify({
          SecurityMode: editOpcSecurityMode,
          SecurityPolicy: editOpcSecurityPolicy,
          Username: editOpcUsername,
          Password: editOpcPassword
        });
      } else if (editAdapterProtocol === 'MQTT') {
        configJson = JSON.stringify({
          ClientId: editMqttClientId,
          TopicPrefix: editMqttTopicPrefix,
          Username: editMqttUsername,
          Password: editMqttPassword
        });
      }

      const updated = {
        id,
        name: editAdapterName,
        protocol: editAdapterProtocol,
        host: editAdapterHost,
        port: editAdapterPort,
        configJson,
        isEnabled: editAdapterIsEnabled,
        status: adapters.find(x => x.id === id)?.status ?? 'Disconnected'
      };

      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      if (res.ok) {
        toast.success('Driver configuration saved. Edge Agent will apply settings within 5 seconds.');
        setEditingId(null);
        fetchData();
      }
    } catch (e) {
      console.error('Failed to save connection adapter:', e);
      toast.error('Error saving configuration.');
    }
  };

  const handleCreateAdapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdapterName || !newAdapterProtocol || !newAdapterHost) {
      toast.warning('Please fill in all required fields.');
      return;
    }

    if (createTestStatus !== 'passed') {
      const reason = createTestStatus === 'failed' 
        ? `\nReason: ${createTestMessage}` 
        : '\nNo connection test was run.';
      const confirmCreate = window.confirm(`Warning: The connection test to ${newAdapterHost}:${newAdapterPort} did not pass.${reason}\n\nAre you sure you want to create this adapter anyway?`);
      if (!confirmCreate) {
        return;
      }
    }

    try {
      let configJson = '{}';
      if (newAdapterProtocol === 'MODBUS_TCP') {
        configJson = JSON.stringify({
          UnitId: Number(newModbusUnitId),
          TimeoutMs: Number(newModbusTimeout),
          Retries: Number(newModbusRetries)
        });
      } else if (newAdapterProtocol === 'OPC_UA') {
        configJson = JSON.stringify({
          SecurityMode: newOpcSecurityMode,
          SecurityPolicy: newOpcSecurityPolicy,
          Username: newOpcUsername,
          Password: newOpcPassword
        });
      } else if (newAdapterProtocol === 'MQTT') {
        configJson = JSON.stringify({
          ClientId: newMqttClientId,
          TopicPrefix: newMqttTopicPrefix,
          Username: newMqttUsername,
          Password: newMqttPassword
        });
      }

      const payload = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'adapter-' + Math.random().toString(36).substring(2, 9),
        name: newAdapterName,
        protocol: newAdapterProtocol,
        host: newAdapterHost,
        port: Number(newAdapterPort),
        configJson,
        isEnabled: true,
        status: 'Offline'
      };

      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewAdapterName('');
        setNewAdapterProtocol('OPC_UA');
        setNewAdapterHost('');
        setNewAdapterPort(4840);
        setIsCreateAdapterOpen(false);
        toast.success('Protocol adapter created successfully.');
        fetchData();
      } else {
        toast.error('Failed to create protocol adapter.');
      }
    } catch (err) {
      console.error('Failed to create adapter:', err);
      toast.error('Failed to create adapter.');
    }
  };

  const handleDeleteAdapter = async (id: string) => {
    try {
      const res = await fetch(`/api/adapters/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setDeletingAdapter(null);
        toast.success('Protocol adapter and bound metric tags deleted.');
        fetchData();
      } else {
        toast.error('Failed to delete protocol adapter.');
      }
    } catch (err) {
      console.error('Failed to delete adapter:', err);
      toast.error('Failed to delete adapter.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Network size={24} style={{ color: 'var(--primary-color)' }} />
            Protocol Connection Adapters
          </h2>
          <p className="page-header-desc">
            Manage local hardware connection drivers and configurations.
          </p>
        </div>
        <div className="page-header-actions">
          <button 
            onClick={() => {
              setNewAdapterName('');
              setNewAdapterProtocol('OPC_UA');
              setNewAdapterHost('127.0.0.1');
              setNewAdapterPort(4840);
              
              // Reset protocol-specific states to default values
              setNewOpcSecurityMode('None');
              setNewOpcSecurityPolicy('None');
              setNewOpcUsername('');
              setNewOpcPassword('');

              setNewModbusUnitId(1);
              setNewModbusTimeout(1000);
              setNewModbusRetries(3);

              setNewMqttClientId('pulse-edge-agent');
              setNewMqttTopicPrefix('');
              setNewMqttUsername('');
              setNewMqttPassword('');

              setCreateTestStatus('idle');
              setCreateTestMessage('');
              setIsCreateAdapterOpen(true);
            }}
            style={{
              backgroundColor: 'var(--primary-color)',
              color: 'var(--sidebar-bg)',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 14px var(--primary-glow)',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(60, 232, 189, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 4px 14px var(--primary-glow)';
            }}
          >
            <Plus size={18} />
            Add Driver Adapter
          </button>
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        backgroundColor: 'rgba(66, 153, 225, 0.08)',
        border: '1px solid rgba(66, 153, 225, 0.25)',
        color: '#2b6cb0',
        padding: '16px 24px',
        borderRadius: '8px',
        fontSize: '13px',
        fontWeight: 500
      }}>
        <RefreshCw size={18} className="spin-slow" style={{ color: '#2b6cb0', flexShrink: 0 }} />
        <span>
          <strong>Dynamic Socket Synchronization:</strong> Active. Changes made to communication channels are saved instantly to the local SQLite database. The background C# Edge Agent dynamically reloads and re-establishes connections in real-time (within 5 seconds).
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '24px'
      }}>
        {adapters.map((proto) => {
          const isActive = proto.status === 'Connected' && proto.isEnabled;
          return (
            <div className="panel" key={proto.id} style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div className="panel-header" style={{ marginBottom: '16px', paddingBottom: '12px' }}>
                  <h3 className="panel-title" style={{ fontSize: '15px' }}>{proto.name}</h3>
                  <span className={`badge ${isActive ? 'success' : 'warning'}`}>
                    {!proto.isEnabled ? 'Disabled' : proto.status === 'Connected' ? 'Active' : 'Offline'}
                  </span>
                </div>

                <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Protocol: </span>
                    <span className="badge primary" style={{ fontSize: '10px' }}>{proto.protocol}</span>
                  </div>
                  <div style={{ wordBreak: 'break-all' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Host: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{proto.host}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Port: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{proto.port}</span>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '12px', paddingTop: '12px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '11px', display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Configuration Parameters:</span>
                    {(() => {
                      try {
                        const config = JSON.parse(proto.configJson || '{}');
                        if (proto.protocol === 'MODBUS_TCP') {
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Unit ID: {config.UnitId ?? 1}</span>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Timeout: {config.TimeoutMs ?? 1000} ms</span>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Retries: {config.Retries ?? 3}</span>
                            </div>
                          );
                        } else if (proto.protocol === 'OPC_UA') {
                          const hasAuth = !!config.Username;
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Security: {config.SecurityMode ?? 'None'}</span>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Policy: {config.SecurityPolicy ?? 'None'}</span>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Auth: {hasAuth ? 'Credentials' : 'None'}</span>
                            </div>
                          );
                        } else if (proto.protocol === 'MQTT') {
                          const hasAuth = !!config.Username;
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Client: {config.ClientId ?? 'pulse-agent'}</span>
                              {config.TopicPrefix && <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Prefix: {config.TopicPrefix}</span>}
                              <span className="badge neutral" style={{ fontSize: '10px', padding: '3px 6px', textTransform: 'none' }}>Auth: {hasAuth ? 'Credentials' : 'Anonymous'}</span>
                            </div>
                          );
                        }
                      } catch (e) {
                        return <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--danger-color)' }}>Invalid JSON config</span>;
                      }
                      return <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>No parameters</span>;
                    })()}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '16px' }}>
                <button 
                  onClick={() => startEdit(proto)} 
                  style={{
                    flex: 4,
                    backgroundColor: 'var(--surface-color)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-color)';
                    e.currentTarget.style.borderColor = 'var(--primary-dark)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--surface-color)';
                    e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                >
                  Edit Adapter Config
                </button>
                <button 
                  onClick={() => setDeletingAdapter(proto)}
                  title="Delete Adapter"
                  style={{
                    flex: 1,
                    backgroundColor: '#fff5f5',
                    color: '#e53e3e',
                    border: '1px solid #fed7d7',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s'
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* CREATE DRIVER ADAPTER MODAL */}
      {isCreateAdapterOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="panel" style={{
            width: '768px',
            maxWidth: '95%',
            padding: '28px 36px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Create Driver Adapter</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Add a new local hardware connection driver.</span>
              </div>
              <button 
                onClick={() => setIsCreateAdapterOpen(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateAdapter} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '24px'
              }}>
                {/* Column 1: General Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    General Settings
                  </h4>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Adapter Name</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="e.g. PLC Line 1 OPC UA" 
                      value={newAdapterName} 
                      onChange={(e) => setNewAdapterName(e.target.value)} 
                      required 
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Protocol Type</label>
                    <CustomSelect 
                      value={newAdapterProtocol} 
                      onChange={(nextProtocol) => {
                        setNewAdapterProtocol(nextProtocol);
                        if (nextProtocol === 'OPC_UA') {
                          setNewAdapterPort(4840);
                          setNewOpcSecurityMode('None');
                          setNewOpcSecurityPolicy('None');
                          setNewOpcUsername('');
                          setNewOpcPassword('');
                        } else if (nextProtocol === 'MQTT') {
                          setNewAdapterPort(1883);
                          setNewMqttClientId('pulse-edge-agent');
                          setNewMqttTopicPrefix('');
                          setNewMqttUsername('');
                          setNewMqttPassword('');
                        } else if (nextProtocol === 'MODBUS_TCP') {
                          setNewAdapterPort(502);
                          setNewModbusUnitId(1);
                          setNewModbusTimeout(1000);
                          setNewModbusRetries(3);
                        }
                      }} 
                      options={[
                        { value: 'OPC_UA', label: 'OPC UA' },
                        { value: 'MQTT', label: 'MQTT Broker' },
                        { value: 'MODBUS_TCP', label: 'Modbus TCP Node' }
                      ]}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Connection Host / IP</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="e.g. 192.168.1.50 or localhost" 
                      value={newAdapterHost} 
                      onChange={(e) => {
                        setNewAdapterHost(e.target.value);
                        setCreateTestStatus('idle');
                        setCreateTestMessage('');
                      }} 
                      required 
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Port Number</label>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={newAdapterPort} 
                      onChange={(e) => {
                        setNewAdapterPort(Number(e.target.value));
                        setCreateTestStatus('idle');
                        setCreateTestMessage('');
                      }} 
                      required 
                    />
                  </div>

                  {/* Create Connection Test */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px dashed var(--border-color)', paddingTop: '16px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => handleTestConnection(newAdapterHost, newAdapterPort, false)}
                      disabled={createTestStatus === 'testing'}
                      style={{
                        backgroundColor: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-color)',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: createTestStatus === 'testing' ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                        alignSelf: 'flex-start'
                      }}
                      onMouseEnter={(e) => { if (createTestStatus !== 'testing') e.currentTarget.style.backgroundColor = 'var(--bg-color)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <RefreshCw size={14} className={createTestStatus === 'testing' ? 'spin' : ''} />
                      {createTestStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>

                    {createTestStatus !== 'idle' && (
                      <div style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        border: '1px solid',
                        backgroundColor: createTestStatus === 'testing' ? '#ebf8ff'
                          : createTestStatus === 'passed' ? '#f0fff4'
                          : '#fff5f5',
                        borderColor: createTestStatus === 'testing' ? '#bee3f8'
                          : createTestStatus === 'passed' ? '#c6f6d5'
                          : '#fed7d7',
                        color: createTestStatus === 'testing' ? '#2b6cb0'
                          : createTestStatus === 'passed' ? '#22543d'
                          : '#c53030',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}>
                        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {createTestStatus === 'testing' && <RefreshCw size={14} className="spin" />}
                          {createTestStatus === 'passed' && <span>✓ Connection Pass</span>}
                          {createTestStatus === 'failed' && <span>⚠️ Connection Failed</span>}
                          {createTestStatus === 'testing' && <span>Testing connection...</span>}
                        </div>
                        {createTestMessage && <span style={{ fontSize: '11px', wordBreak: 'break-word' }}>{createTestMessage}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Column 2: Protocol-Specific Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    {newAdapterProtocol === 'MODBUS_TCP' && 'Modbus TCP Settings'}
                    {newAdapterProtocol === 'OPC_UA' && 'OPC UA Security Settings'}
                    {newAdapterProtocol === 'MQTT' && 'MQTT Client Settings'}
                  </h4>

                  {newAdapterProtocol === 'MODBUS_TCP' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Unit ID (1 - 255)</label>
                        <input
                          type="number"
                          min="1"
                          max="255"
                          className="form-input"
                          value={newModbusUnitId}
                          onChange={(e) => setNewModbusUnitId(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Timeout (ms)</label>
                        <input
                          type="number"
                          min="50"
                          max="10000"
                          className="form-input"
                          value={newModbusTimeout}
                          onChange={(e) => setNewModbusTimeout(Math.max(50, Number(e.target.value) || 1000))}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Max Retries</label>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          className="form-input"
                          value={newModbusRetries}
                          onChange={(e) => setNewModbusRetries(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {newAdapterProtocol === 'OPC_UA' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* OPC UA Auto-Discovery */}
                      <div style={{
                        padding: '12px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-hover)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>Auto-Discover OPC UA Endpoints</span>
                          <button
                            type="button"
                            onClick={() => handleDiscoverOpcUa(newAdapterHost, newAdapterPort)}
                            disabled={opcDiscoverStatus === 'discovering'}
                            style={{
                              backgroundColor: 'var(--sidebar-bg)',
                              color: '#fff',
                              border: 'none',
                              padding: '6px 12px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              opacity: opcDiscoverStatus === 'discovering' ? 0.6 : 1
                            }}
                          >
                            {opcDiscoverStatus === 'discovering' ? 'Discovering...' : 'Discover'}
                          </button>
                        </div>

                        {opcDiscoverStatus === 'success' && opcEndpoints.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px', backgroundColor: 'var(--bg-color)' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Click an endpoint to apply security settings:</div>
                            {opcEndpoints.map((ep, idx) => {
                              const mode = ep.securityMode;
                              const policy = ep.securityPolicyUri?.split('#').pop() || 'None';
                              return (
                                <div
                                  key={idx}
                                  onClick={() => {
                                    setNewOpcSecurityMode(mode === 'SignAndEncrypt' ? 'SignAndEncrypt' : mode === 'Sign' ? 'Sign' : 'None');
                                    setNewOpcSecurityPolicy(policy);
                                    toast.success(`Applied: ${mode} (${policy})`);
                                  }}
                                  style={{
                                    fontSize: '11px',
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    backgroundColor: 'var(--card-bg)',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
                                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                >
                                  <span style={{ fontWeight: 600 }}>{mode}</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{policy}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {opcDiscoverStatus === 'success' && opcEndpoints.length === 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>No endpoints found.</div>
                        )}

                        {opcDiscoverStatus === 'error' && (
                          <div style={{ fontSize: '11px', color: 'var(--text-danger)', fontWeight: 600 }}>{opcDiscoverMessage}</div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Security Mode</label>
                          <CustomSelect
                            value={newOpcSecurityMode}
                            onChange={setNewOpcSecurityMode}
                            options={[
                              { value: 'None', label: 'None' },
                              { value: 'Sign', label: 'Sign' },
                              { value: 'SignAndEncrypt', label: 'Sign & Encrypt' }
                            ]}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Security Policy</label>
                          <CustomSelect
                            value={newOpcSecurityPolicy}
                            onChange={setNewOpcSecurityPolicy}
                            options={[
                              { value: 'None', label: 'None' },
                              { value: 'Basic128Rsa15', label: 'Basic128Rsa15' },
                              { value: 'Basic256', label: 'Basic256' },
                              { value: 'Basic256Sha256', label: 'Basic256Sha256' },
                              { value: 'Aes128_Sha256_RsaOaep', label: 'Aes128_Sha256_RsaOaep' }
                            ]}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Username (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="No authentication"
                            value={newOpcUsername}
                            onChange={(e) => setNewOpcUsername(e.target.value)}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Password (Optional)</label>
                          <input
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={newOpcPassword}
                            onChange={(e) => setNewOpcPassword(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {newAdapterProtocol === 'MQTT' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Client ID</label>
                          <input
                            type="text"
                            className="form-input"
                            value={newMqttClientId}
                            onChange={(e) => setNewMqttClientId(e.target.value)}
                            required
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Topic Prefix (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. factory/line1"
                            value={newMqttTopicPrefix}
                            onChange={(e) => setNewMqttTopicPrefix(e.target.value)}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Username (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="No authentication"
                            value={newMqttUsername}
                            onChange={(e) => setNewMqttUsername(e.target.value)}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Password (Optional)</label>
                          <input
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={newMqttPassword}
                            onChange={(e) => setNewMqttPassword(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons full width at the bottom */}
              <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '10px' }}>
                <button 
                  type="submit"
                  style={{
                    flex: 2,
                    backgroundColor: 'var(--sidebar-bg)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1a1c23'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--sidebar-bg)'}
                >
                  Create Adapter
                </button>
                <button 
                  type="button"
                  onClick={() => setIsCreateAdapterOpen(false)}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT DRIVER ADAPTER MODAL */}
      {editingId !== null && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="panel" style={{
            width: '768px',
            maxWidth: '95%',
            padding: '28px 36px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Edit Driver Adapter</h3>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Modify driver connection details.</span>
              </div>
              <button 
                onClick={cancelEdit}
                style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                &times;
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); saveProtocol(editingId); }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '24px'
              }}>
                {/* Column 1: General Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    General Settings
                  </h4>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Adapter Name</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editAdapterName} 
                      onChange={(e) => setEditAdapterName(e.target.value)} 
                      required 
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Protocol Type</label>
                    <CustomSelect 
                      value={editAdapterProtocol} 
                      onChange={(nextProtocol) => {
                        setEditAdapterProtocol(nextProtocol);
                        if (nextProtocol === 'OPC_UA') {
                          setEditAdapterPort(4840);
                          setEditOpcSecurityMode('None');
                          setEditOpcSecurityPolicy('None');
                          setEditOpcUsername('');
                          setEditOpcPassword('');
                        } else if (nextProtocol === 'MQTT') {
                          setEditAdapterPort(1883);
                          setEditMqttClientId('pulse-edge-agent');
                          setEditMqttTopicPrefix('');
                          setEditMqttUsername('');
                          setEditMqttPassword('');
                        } else if (nextProtocol === 'MODBUS_TCP') {
                          setEditAdapterPort(502);
                          setEditModbusUnitId(1);
                          setEditModbusTimeout(1000);
                          setEditModbusRetries(3);
                        }
                        setEditTestStatus('idle');
                        setEditTestMessage('');
                      }} 
                      options={[
                        { value: 'OPC_UA', label: 'OPC UA' },
                        { value: 'MQTT', label: 'MQTT Broker' },
                        { value: 'MODBUS_TCP', label: 'Modbus TCP Node' }
                      ]}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Connection Host / IP</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      value={editAdapterHost} 
                      onChange={(e) => {
                        setEditAdapterHost(e.target.value);
                        setEditTestStatus('idle');
                        setEditTestMessage('');
                      }} 
                      required 
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label" style={{ fontWeight: 700 }}>Port Number</label>
                    <input 
                      type="number" 
                      className="form-input" 
                      value={editAdapterPort} 
                      onChange={(e) => {
                        setEditAdapterPort(Number(e.target.value));
                        setEditTestStatus('idle');
                        setEditTestMessage('');
                      }} 
                      required 
                    />
                  </div>

                  {/* Edit Connection Test */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px dashed var(--border-color)', paddingTop: '16px', marginTop: '4px' }}>
                    <button
                      type="button"
                      onClick={() => handleTestConnection(editAdapterHost, editAdapterPort, true)}
                      disabled={editTestStatus === 'testing'}
                      style={{
                        backgroundColor: 'transparent',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border-color)',
                        padding: '8px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: editTestStatus === 'testing' ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                        alignSelf: 'flex-start'
                      }}
                      onMouseEnter={(e) => { if (editTestStatus !== 'testing') e.currentTarget.style.backgroundColor = 'var(--bg-color)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <RefreshCw size={14} className={editTestStatus === 'testing' ? 'spin' : ''} />
                      {editTestStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>

                    {editTestStatus !== 'idle' && (
                      <div style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        lineHeight: '1.4',
                        border: '1px solid',
                        backgroundColor: editTestStatus === 'testing' ? '#ebf8ff'
                          : editTestStatus === 'passed' ? '#f0fff4'
                          : '#fff5f5',
                        borderColor: editTestStatus === 'testing' ? '#bee3f8'
                          : editTestStatus === 'passed' ? '#c6f6d5'
                          : '#fed7d7',
                        color: editTestStatus === 'testing' ? '#2b6cb0'
                          : editTestStatus === 'passed' ? '#22543d'
                          : '#c53030',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px'
                      }}>
                        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {editTestStatus === 'testing' && <RefreshCw size={14} className="spin" />}
                          {editTestStatus === 'passed' && <span>✓ Connection Pass</span>}
                          {editTestStatus === 'failed' && <span>⚠️ Connection Failed</span>}
                          {editTestStatus === 'testing' && <span>Testing connection...</span>}
                        </div>
                        {editTestMessage && <span style={{ fontSize: '11px', wordBreak: 'break-word' }}>{editTestMessage}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Column 2: Protocol-Specific Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    {editAdapterProtocol === 'MODBUS_TCP' && 'Modbus TCP Settings'}
                    {editAdapterProtocol === 'OPC_UA' && 'OPC UA Security Settings'}
                    {editAdapterProtocol === 'MQTT' && 'MQTT Client Settings'}
                  </h4>

                  {editAdapterProtocol === 'MODBUS_TCP' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Unit ID (1 - 255)</label>
                        <input
                          type="number"
                          min="1"
                          max="255"
                          className="form-input"
                          value={editModbusUnitId}
                          onChange={(e) => setEditModbusUnitId(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Timeout (ms)</label>
                        <input
                          type="number"
                          min="50"
                          max="10000"
                          className="form-input"
                          value={editModbusTimeout}
                          onChange={(e) => setEditModbusTimeout(Math.max(50, Number(e.target.value) || 1000))}
                          required
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                        <label className="form-label" style={{ fontWeight: 600 }}>Max Retries</label>
                        <input
                          type="number"
                          min="0"
                          max="10"
                          className="form-input"
                          value={editModbusRetries}
                          onChange={(e) => setEditModbusRetries(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {editAdapterProtocol === 'OPC_UA' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* OPC UA Auto-Discovery */}
                      <div style={{
                        padding: '12px',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-hover)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>Auto-Discover OPC UA Endpoints</span>
                          <button
                            type="button"
                            onClick={() => handleDiscoverOpcUa(editAdapterHost, editAdapterPort)}
                            disabled={opcDiscoverStatus === 'discovering'}
                            style={{
                              backgroundColor: 'var(--sidebar-bg)',
                              color: '#fff',
                              border: 'none',
                              padding: '6px 12px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              opacity: opcDiscoverStatus === 'discovering' ? 0.6 : 1
                            }}
                          >
                            {opcDiscoverStatus === 'discovering' ? 'Discovering...' : 'Discover'}
                          </button>
                        </div>

                        {opcDiscoverStatus === 'success' && opcEndpoints.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '6px', backgroundColor: 'var(--bg-color)' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>Click an endpoint to apply security settings:</div>
                            {opcEndpoints.map((ep, idx) => {
                              const mode = ep.securityMode;
                              const policy = ep.securityPolicyUri?.split('#').pop() || 'None';
                              return (
                                <div
                                  key={idx}
                                  onClick={() => {
                                    setEditOpcSecurityMode(mode === 'SignAndEncrypt' ? 'SignAndEncrypt' : mode === 'Sign' ? 'Sign' : 'None');
                                    setEditOpcSecurityPolicy(policy);
                                    toast.success(`Applied: ${mode} (${policy})`);
                                  }}
                                  style={{
                                    fontSize: '11px',
                                    padding: '6px 8px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    backgroundColor: 'var(--card-bg)',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--text-secondary)'}
                                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                >
                                  <span style={{ fontWeight: 600 }}>{mode}</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{policy}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {opcDiscoverStatus === 'success' && opcEndpoints.length === 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>No endpoints found.</div>
                        )}

                        {opcDiscoverStatus === 'error' && (
                          <div style={{ fontSize: '11px', color: 'var(--text-danger)', fontWeight: 600 }}>{opcDiscoverMessage}</div>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Security Mode</label>
                          <CustomSelect
                            value={editOpcSecurityMode}
                            onChange={setEditOpcSecurityMode}
                            options={[
                              { value: 'None', label: 'None' },
                              { value: 'Sign', label: 'Sign' },
                              { value: 'SignAndEncrypt', label: 'Sign & Encrypt' }
                            ]}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Security Policy</label>
                          <CustomSelect
                            value={editOpcSecurityPolicy}
                            onChange={setEditOpcSecurityPolicy}
                            options={[
                              { value: 'None', label: 'None' },
                              { value: 'Basic128Rsa15', label: 'Basic128Rsa15' },
                              { value: 'Basic256', label: 'Basic256' },
                              { value: 'Basic256Sha256', label: 'Basic256Sha256' },
                              { value: 'Aes128_Sha256_RsaOaep', label: 'Aes128_Sha256_RsaOaep' }
                            ]}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Username (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="No authentication"
                            value={editOpcUsername}
                            onChange={(e) => setEditOpcUsername(e.target.value)}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Password (Optional)</label>
                          <input
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={editOpcPassword}
                            onChange={(e) => setEditOpcPassword(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {editAdapterProtocol === 'MQTT' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Client ID</label>
                          <input
                            type="text"
                            className="form-input"
                            value={editMqttClientId}
                            onChange={(e) => setEditMqttClientId(e.target.value)}
                            required
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Topic Prefix (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. factory/line1"
                            value={editMqttTopicPrefix}
                            onChange={(e) => setEditMqttTopicPrefix(e.target.value)}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Username (Optional)</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="No authentication"
                            value={editMqttUsername}
                            onChange={(e) => setEditMqttUsername(e.target.value)}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontWeight: 600 }}>Password (Optional)</label>
                          <input
                            type="password"
                            className="form-input"
                            placeholder="••••••••"
                            value={editMqttPassword}
                            onChange={(e) => setEditMqttPassword(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Enable/Disable Adapter Checkbox */}
                  <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '16px', marginTop: 'auto' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: 0 }}>
                      <input 
                        type="checkbox" 
                        checked={editAdapterIsEnabled} 
                        onChange={(e) => setEditAdapterIsEnabled(e.target.checked)} 
                      />
                      <span style={{ fontSize: '13px', fontWeight: 700 }}>Enable Adapter</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Action buttons full width at the bottom */}
              <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '20px', marginTop: '10px' }}>
                <button 
                  type="submit"
                  style={{
                    flex: 2,
                    backgroundColor: 'var(--sidebar-bg)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1a1c23'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--sidebar-bg)'}
                >
                  Save Changes
                </button>
                <button 
                  type="button"
                  onClick={cancelEdit}
                  style={{
                    flex: 1,
                    backgroundColor: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE ADAPTER CONFIRMATION MODAL */}
      {deletingAdapter && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(10, 11, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="panel" style={{
            width: '480px',
            maxWidth: '90%',
            padding: '28px 36px',
            borderRadius: '16px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backgroundColor: '#ffffff',
            margin: 0
          }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div style={{
                backgroundColor: '#fff5f5',
                color: '#e53e3e',
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Delete Protocol Adapter?</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  Are you sure you want to delete the adapter <strong style={{ color: 'var(--text-primary)' }}>{deletingAdapter.name}</strong> ({deletingAdapter.protocol})?
                </p>
              </div>
            </div>

            <div style={{
              backgroundColor: 'var(--bg-color)',
              border: '1px solid var(--border-color)',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '12px'
            }}>
              <div style={{ display: 'flex', justifySelf: 'space-between', width: '100%', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Host Address:</span>
                <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{deletingAdapter.host}:{deletingAdapter.port}</span>
              </div>
              <div style={{ display: 'flex', justifySelf: 'space-between', width: '100%' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Bound Metrics Affected:</span>
                <span style={{ fontWeight: 700, color: '#e53e3e' }}>
                  {(() => {
                    const count = datapoints.filter(dp => dp.adapterId === deletingAdapter.id).length;
                    return count === 0 ? 'None' : `${count} metric tag(s) will be unmapped`;
                  })()}
                </span>
              </div>
            </div>

            <div style={{
              color: '#e53e3e',
              backgroundColor: '#fff5f5',
              border: '1px solid #fed7d7',
              padding: '12px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              marginBottom: '24px',
              lineHeight: '1.4'
            }}>
              <strong>Warning:</strong> Deleting this connection adapter will immediately stop ingestion for all bound metrics on this channel and permanently delete their mappings.
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => handleDeleteAdapter(deletingAdapter.id)}
                style={{
                  flex: 1,
                  backgroundColor: '#e53e3e',
                  color: '#ffffff',
                  border: 'none',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#c53030'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e53e3e'}
              >
                Delete Adapter
              </button>
              <button 
                onClick={() => setDeletingAdapter(null)}
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
