import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DriverAdapter } from '../../types';
import CustomSelect from '../CustomSelect';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface OpcEndpoint {
  securityMode: string;
  securityPolicyUri?: string;
}

interface EditAdapterModalProps {
  onClose: () => void;
  adapter: DriverAdapter;
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function EditAdapterModal({ onClose, adapter, toast, fetchData }: EditAdapterModalProps) {
  const config = (() => { try { return JSON.parse(adapter.configJson || '{}'); } catch { return {}; } })();

  const [editAdapterName, setEditAdapterName] = useState(adapter.name);
  const [editAdapterProtocol, setEditAdapterProtocol] = useState(adapter.protocol);
  const [editAdapterHost, setEditAdapterHost] = useState(adapter.host);
  const [editAdapterPort, setEditAdapterPort] = useState(adapter.port);
  const [editAdapterIsEnabled, setEditAdapterIsEnabled] = useState(adapter.isEnabled);
  const [editModbusUnitId, setEditModbusUnitId] = useState<number>(config.UnitId ?? 1);
  const [editModbusTimeout, setEditModbusTimeout] = useState<number>(config.TimeoutMs ?? 1000);
  const [editModbusRetries, setEditModbusRetries] = useState<number>(config.Retries ?? 3);
  const [editOpcSecurityMode, setEditOpcSecurityMode] = useState<string>(config.SecurityMode ?? 'None');
  const [editModbusRtuParity, setEditModbusRtuParity] = useState<string>(config.Parity ?? 'None');
  const [editModbusRtuStopBits, setEditModbusRtuStopBits] = useState<string>(config.StopBits ?? 'One');
  const [editModbusRtuHandshake, setEditModbusRtuHandshake] = useState<string>(config.Handshake ?? 'None');
  const [editOpcSecurityPolicy, setEditOpcSecurityPolicy] = useState<string>(config.SecurityPolicy ?? 'None');
  const [editOpcUsername, setEditOpcUsername] = useState<string>(config.Username ?? '');
  const [editOpcPassword, setEditOpcPassword] = useState<string>(config.Password ?? '');
  const [editMqttClientId, setEditMqttClientId] = useState<string>(config.ClientId ?? 'pulse-edge-agent');
  const [editMqttTopicPrefix, setEditMqttTopicPrefix] = useState<string>(config.TopicPrefix ?? '');
  const [editMqttUsername, setEditMqttUsername] = useState<string>(config.Username ?? '');
  const [editMqttPassword, setEditMqttPassword] = useState<string>(config.Password ?? '');
  const [webhookToken, setWebhookToken] = useState<string>(config.Token ?? '');
  const [editSimulatorTemplate, setEditSimulatorTemplate] = useState<string>(config.Template ?? 'energy');
  const [editTestStatus, setEditTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [editTestMessage, setEditTestMessage] = useState('');
  const [opcEndpoints, setOpcEndpoints] = useState<OpcEndpoint[]>([]);
  const [opcDiscoverStatus, setOpcDiscoverStatus] = useState<'idle' | 'discovering' | 'success' | 'error'>('idle');
  const [opcDiscoverMessage, setOpcDiscoverMessage] = useState('');

  const [editPlcType, setEditPlcType] = useState<string>(config.PlcType ?? 'ControlLogix');
  const [editPlcProtocol, setEditPlcProtocol] = useState<string>(config.Protocol ?? 'ab_eip');
  const [editPlcPath, setEditPlcPath] = useState<string>(config.Path ?? '1,0');
  const [editPlcTimeoutMs, setEditPlcTimeoutMs] = useState<number>(config.TimeoutMs ?? 5000);

  if (!adapter) return null;

  const handleDiscoverOpcUa = async (host: string, port: number) => {
    if (!host) { toast.warning('Please enter a Connection Host/IP before discovering.'); return; }
    setOpcDiscoverStatus('discovering');
    setOpcDiscoverMessage('');
    setOpcEndpoints([]);
    try {
      const res = await fetch('/api/adapters/opcua/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discoveryUrl: `opc.tcp://${host}:${port}` })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOpcEndpoints(data.endpoints || []);
          setOpcDiscoverStatus('success');
          if (!data.endpoints?.length) setOpcDiscoverMessage('No endpoints were returned by the discovery service.');
        } else { setOpcDiscoverStatus('error'); setOpcDiscoverMessage(data.message); }
      } else {
        setOpcDiscoverStatus('error');
        setOpcDiscoverMessage(`HTTP Error ${res.status}: ${await res.text() || 'Internal Server Error'}`);
      }
    } catch (err) {
      setOpcDiscoverStatus('error');
      setOpcDiscoverMessage(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTestConnection = async (host: string, port: number) => {
    if (!host) { toast.warning('Please enter a Connection Host/IP before testing.'); return; }
    setEditTestStatus('testing');
    setEditTestMessage('');
    try {
      const res = await fetch('/api/adapters/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) { setEditTestStatus('passed'); setEditTestMessage(data.message); }
        else { setEditTestStatus('failed'); setEditTestMessage(data.message); }
      } else {
        setEditTestStatus('failed');
        setEditTestMessage(`HTTP Error ${res.status}: ${await res.text() || 'Internal Server Error'}`);
      }
    } catch (err) {
      setEditTestStatus('failed');
      setEditTestMessage(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveProtocol = async (id: string) => {
    if (editAdapterProtocol !== 'WEBHOOK' && editAdapterProtocol !== 'SIMULATOR' && editAdapterProtocol !== 'MODBUS_RTU' && editTestStatus !== 'passed') {
      const reason = editTestStatus === 'failed' ? `\nReason: ${editTestMessage}` : '\nNo connection test was run.';
      if (!window.confirm(`Warning: The connection test to ${editAdapterHost}:${editAdapterPort} did not pass.${reason}\n\nAre you sure you want to save this configuration anyway?`)) return;
    }
    try {
      let configJson = '{}';
      if (editAdapterProtocol === 'MODBUS_TCP') {
        configJson = JSON.stringify({ UnitId: Number(editModbusUnitId), TimeoutMs: Number(editModbusTimeout), Retries: Number(editModbusRetries) });
      } else if (editAdapterProtocol === 'MODBUS_RTU') {
        configJson = JSON.stringify({ UnitId: Number(editModbusUnitId), Parity: editModbusRtuParity, StopBits: editModbusRtuStopBits, Handshake: editModbusRtuHandshake });
      } else if (editAdapterProtocol === 'OPC_UA') {
        configJson = JSON.stringify({ SecurityMode: editOpcSecurityMode, SecurityPolicy: editOpcSecurityPolicy, Username: editOpcUsername, Password: editOpcPassword });
      } else if (editAdapterProtocol === 'MQTT') {
        configJson = JSON.stringify({ ClientId: editMqttClientId, TopicPrefix: editMqttTopicPrefix, Username: editMqttUsername, Password: editMqttPassword });
      } else if (editAdapterProtocol === 'WEBHOOK') {
        configJson = JSON.stringify({ Token: webhookToken, LastPayload: config.LastPayload ?? '', LastSeen: config.LastSeen ?? '' });
      } else if (editAdapterProtocol === 'SIMULATOR') {
        configJson = JSON.stringify({ Template: editSimulatorTemplate });
      } else if (editAdapterProtocol === 'Ethernet/IP') {
        configJson = JSON.stringify({ PlcType: editPlcType, Protocol: editPlcProtocol, Path: editPlcPath, TimeoutMs: Number(editPlcTimeoutMs) });
      }
      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: editAdapterName, protocol: editAdapterProtocol, host: editAdapterHost, port: editAdapterPort, configJson, isEnabled: editAdapterIsEnabled, status: adapter.status })
      });
      if (res.ok) { toast.success('Driver configuration saved. Edge Agent will apply settings within 5 seconds.'); onClose(); fetchData(); }
    } catch (e) {
      console.error('Failed to save connection adapter:', e);
      toast.error('Error saving configuration.');
    }
  };

  return (
    <ModalShell
      title="Edit Driver Adapter"
      subtitle="Modify driver connection details."
      size="xl"
      onClose={onClose}
    >
      <form onSubmit={(e) => { e.preventDefault(); saveProtocol(adapter.id); }} className="form-stack-lg">
        <div className="adapter-form-cols">
          <div className="adapter-form-col">
            <h4 className="section-header-sm">General Settings</h4>

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Adapter Name</label>
              <input type="text" className="form-input" value={editAdapterName} onChange={(e) => setEditAdapterName(e.target.value)} required />
            </div>

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Protocol Type</label>
              <CustomSelect value={editAdapterProtocol} onChange={(nextProtocol) => {
                setEditAdapterProtocol(nextProtocol);
                if (nextProtocol === 'OPC_UA') { setEditAdapterPort(4840); setEditOpcSecurityMode('None'); setEditOpcSecurityPolicy('None'); setEditOpcUsername(''); setEditOpcPassword(''); }
                else if (nextProtocol === 'MQTT') { setEditAdapterPort(1883); setEditMqttClientId('pulse-edge-agent'); setEditMqttTopicPrefix(''); setEditMqttUsername(''); setEditMqttPassword(''); }
                else if (nextProtocol === 'MODBUS_TCP') { setEditAdapterPort(502); setEditModbusUnitId(1); setEditModbusTimeout(1000); setEditModbusRetries(3); }
                else if (nextProtocol === 'MODBUS_RTU') { setEditAdapterHost('/dev/ttyUSB0'); setEditAdapterPort(9600); setEditModbusUnitId(1); setEditModbusRtuParity('None'); setEditModbusRtuStopBits('One'); setEditModbusRtuHandshake('None'); }
                else if (nextProtocol === 'Ethernet/IP') {
                  setEditAdapterPort(44818);
                  setEditPlcType('ControlLogix');
                  setEditPlcProtocol('ab_eip');
                  setEditPlcPath('1,0');
                  setEditPlcTimeoutMs(5000);
                }
                else if (nextProtocol === 'WEBHOOK') {
                  setEditAdapterHost('localhost');
                  setEditAdapterPort(80);
                  if (!webhookToken) {
                    setWebhookToken('wh_tok_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
                  }
                }
                else if (nextProtocol === 'SIMULATOR') {
                  setEditAdapterHost('simulator');
                  setEditAdapterPort(0);
                  setEditSimulatorTemplate('energy');
                }
                setEditTestStatus('idle'); setEditTestMessage('');
              }} options={[
                { value: 'OPC_UA', label: 'OPC UA' },
                { value: 'MQTT', label: 'MQTT Broker' },
                { value: 'MODBUS_TCP', label: 'Modbus TCP Node' },
                { value: 'MODBUS_RTU', label: 'Modbus RTU (Serial)' },
                { value: 'Ethernet/IP', label: 'Ethernet/IP PLC' },
                { value: 'WEBHOOK', label: 'REST Webhook' },
                { value: 'SIMULATOR', label: 'Protocol Simulator' }
              ]} />
            </div>

            {editAdapterProtocol !== 'WEBHOOK' && editAdapterProtocol !== 'SIMULATOR' && (
              <>
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">
                    {editAdapterProtocol === 'MODBUS_RTU' ? 'Serial Port' : 'Connection Host / IP'}
                  </label>
                  <input type="text" className="form-input" 
                    placeholder={editAdapterProtocol === 'MODBUS_RTU' ? 'e.g. COM3 or /dev/ttyUSB0' : 'e.g. 192.168.1.50 or localhost'}
                    value={editAdapterHost}
                    onChange={(e) => { setEditAdapterHost(e.target.value); setEditTestStatus('idle'); setEditTestMessage(''); }} required />
                </div>

                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">
                    {editAdapterProtocol === 'MODBUS_RTU' ? 'Baud Rate' : 'Port Number'}
                  </label>
                  <input type="number" className="form-input" value={editAdapterPort}
                    onChange={(e) => { setEditAdapterPort(Number(e.target.value)); setEditTestStatus('idle'); setEditTestMessage(''); }} required />
                </div>

                {editAdapterProtocol !== 'MODBUS_RTU' && (
                  <div className="conn-test-section">
                    <button type="button" onClick={() => handleTestConnection(editAdapterHost, editAdapterPort)}
                      disabled={editTestStatus === 'testing'} className="btn-conn-test">
                      <RefreshCw size={14} className={editTestStatus === 'testing' ? 'spin' : ''} />
                      {editTestStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>
                    {editTestStatus !== 'idle' && (
                      <div className={`conn-test-result is-${editTestStatus}`}>
                        <div className="conn-test-result-header">
                          {editTestStatus === 'testing' && <RefreshCw size={14} className="spin" />}
                          {editTestStatus === 'passed' && <span>✓ Connection Pass</span>}
                          {editTestStatus === 'failed' && <span>⚠️ Connection Failed</span>}
                          {editTestStatus === 'testing' && <span>Testing connection...</span>}
                        </div>
                        {editTestMessage && <span className="conn-test-result-msg">{editTestMessage}</span>}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="adapter-form-col">
            <h4 className="section-header-sm">
              {editAdapterProtocol === 'MODBUS_TCP' && 'Modbus TCP Settings'}
              {editAdapterProtocol === 'MODBUS_RTU' && 'Modbus RTU Settings'}
              {editAdapterProtocol === 'Ethernet/IP' && 'Ethernet/IP Settings'}
              {editAdapterProtocol === 'OPC_UA' && 'OPC UA Security Settings'}
              {editAdapterProtocol === 'MQTT' && 'MQTT Client Settings'}
              {editAdapterProtocol === 'WEBHOOK' && 'REST Webhook Settings'}
              {editAdapterProtocol === 'SIMULATOR' && 'Protocol Simulator Settings'}
            </h4>

            {editAdapterProtocol === 'MODBUS_TCP' && (
              <div className="form-grid-half">
                <div className="form-group form-group-flush">
                  <label className="form-label">Unit ID (1 - 255)</label>
                  <input type="number" min="1" max="255" className="form-input" value={editModbusUnitId}
                    onChange={(e) => setEditModbusUnitId(Math.max(1, Math.min(255, Number(e.target.value) || 1)))} required />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Timeout (ms)</label>
                  <input type="number" min="50" max="10000" className="form-input" value={editModbusTimeout}
                    onChange={(e) => setEditModbusTimeout(Math.max(50, Number(e.target.value) || 1000))} required />
                </div>
                <div className="form-group form-group-flush form-grid-span-2">
                  <label className="form-label">Max Retries</label>
                  <input type="number" min="0" max="10" className="form-input" value={editModbusRetries}
                    onChange={(e) => setEditModbusRetries(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} required />
                </div>
              </div>
            )}

            {editAdapterProtocol === 'MODBUS_RTU' && (
              <div className="form-grid-half">
                <div className="form-group form-group-flush">
                  <label className="form-label">Unit ID (1 - 255)</label>
                  <input type="number" min="1" max="255" className="form-input" value={editModbusUnitId}
                    onChange={(e) => setEditModbusUnitId(Math.max(1, Math.min(255, Number(e.target.value) || 1)))} required />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Parity</label>
                  <CustomSelect value={editModbusRtuParity} onChange={setEditModbusRtuParity} options={[
                    { value: 'None', label: 'None' },
                    { value: 'Odd', label: 'Odd' },
                    { value: 'Even', label: 'Even' },
                    { value: 'Mark', label: 'Mark' },
                    { value: 'Space', label: 'Space' }
                  ]} />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Stop Bits</label>
                  <CustomSelect value={editModbusRtuStopBits} onChange={setEditModbusRtuStopBits} options={[
                    { value: 'One', label: 'One' },
                    { value: 'Two', label: 'Two' },
                    { value: 'OnePointFive', label: 'OnePointFive' },
                    { value: 'None', label: 'None' }
                  ]} />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Handshake</label>
                  <CustomSelect value={editModbusRtuHandshake} onChange={setEditModbusRtuHandshake} options={[
                    { value: 'None', label: 'None' },
                    { value: 'XOnXOff', label: 'XOnXOff' },
                    { value: 'RequestToSend', label: 'RequestToSend' },
                    { value: 'RequestToSendXOnXOff', label: 'RequestToSendXOnXOff' }
                  ]} />
                </div>
              </div>
            )}

            {editAdapterProtocol === 'Ethernet/IP' && (
               <div className="form-stack-sm">
                 <div className="form-group form-group-flush">
                   <label className="form-label">PLC Type</label>
                   <CustomSelect value={editPlcType} onChange={setEditPlcType} options={[
                     { value: 'ControlLogix', label: 'ControlLogix' },
                     { value: 'CompactLogix', label: 'CompactLogix' },
                     { value: 'Micro800', label: 'Micro800' },
                     { value: 'PLC5', label: 'PLC5' },
                     { value: 'SLC500', label: 'SLC500' },
                     { value: 'MicroLogix', label: 'MicroLogix' }
                   ]} />
                 </div>
                 <div className="form-group form-group-flush">
                   <label className="form-label">CPU Path / Slot</label>
                   <input type="text" className="form-input" value={editPlcPath}
                     onChange={(e) => setEditPlcPath(e.target.value)} required />
                 </div>
                 <div className="form-group form-group-flush">
                   <label className="form-label">Timeout (ms)</label>
                   <input type="number" min="50" max="30000" className="form-input" value={editPlcTimeoutMs}
                     onChange={(e) => setEditPlcTimeoutMs(Math.max(50, Number(e.target.value) || 5000))} required />
                 </div>
               </div>
            )}

            {editAdapterProtocol === 'OPC_UA' && (
              <div className="form-stack-sm">
                <div className="opc-discover-box">
                  <div className="opc-discover-header">
                    <span className="opc-discover-label">Auto-Discover OPC UA Endpoints</span>
                    <button type="button" onClick={() => handleDiscoverOpcUa(editAdapterHost, editAdapterPort)}
                      disabled={opcDiscoverStatus === 'discovering'} className="btn-opc-discover">
                      {opcDiscoverStatus === 'discovering' ? 'Discovering...' : 'Discover'}
                    </button>
                  </div>
                  {opcDiscoverStatus === 'success' && opcEndpoints.length > 0 && (
                    <div className="opc-endpoint-list">
                      <div className="opc-endpoint-hint">Click an endpoint to apply security settings:</div>
                      {opcEndpoints.map((ep, idx) => {
                        const mode = ep.securityMode;
                        const policy = ep.securityPolicyUri?.split('#').pop() || 'None';
                        return (
                          <div key={idx} onClick={() => {
                            setEditOpcSecurityMode(mode === 'SignAndEncrypt' ? 'SignAndEncrypt' : mode === 'Sign' ? 'Sign' : 'None');
                            setEditOpcSecurityPolicy(policy);
                            toast.success(`Applied: ${mode} (${policy})`);
                          }} className="opc-endpoint-item">
                            <span className="opc-endpoint-mode">{mode}</span>
                            <span className="opc-endpoint-policy">{policy}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {opcDiscoverStatus === 'success' && opcEndpoints.length === 0 && (
                    <div className="opc-discover-msg">No endpoints found.</div>
                  )}
                  {opcDiscoverStatus === 'error' && (
                    <div className="opc-discover-error">{opcDiscoverMessage}</div>
                  )}
                </div>

                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Security Mode</label>
                    <CustomSelect value={editOpcSecurityMode} onChange={setEditOpcSecurityMode} options={[
                      { value: 'None', label: 'None' }, { value: 'Sign', label: 'Sign' }, { value: 'SignAndEncrypt', label: 'Sign & Encrypt' }
                    ]} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Security Policy</label>
                    <CustomSelect value={editOpcSecurityPolicy} onChange={setEditOpcSecurityPolicy} options={[
                      { value: 'None', label: 'None' }, { value: 'Basic128Rsa15', label: 'Basic128Rsa15' },
                      { value: 'Basic256', label: 'Basic256' }, { value: 'Basic256Sha256', label: 'Basic256Sha256' },
                      { value: 'Aes128_Sha256_RsaOaep', label: 'Aes128_Sha256_RsaOaep' }
                    ]} />
                  </div>
                </div>
                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Username (Optional)</label>
                    <input type="text" className="form-input" placeholder="No authentication" value={editOpcUsername} onChange={(e) => setEditOpcUsername(e.target.value)} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Password (Optional)</label>
                    <input type="password" className="form-input" placeholder="••••••••" value={editOpcPassword} onChange={(e) => setEditOpcPassword(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {editAdapterProtocol === 'MQTT' && (
              <div className="form-stack-sm">
                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Client ID</label>
                    <input type="text" className="form-input" value={editMqttClientId} onChange={(e) => setEditMqttClientId(e.target.value)} required />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Topic Prefix (Optional)</label>
                    <input type="text" className="form-input" placeholder="e.g. factory/line1" value={editMqttTopicPrefix} onChange={(e) => setEditMqttTopicPrefix(e.target.value)} />
                  </div>
                </div>
                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Username (Optional)</label>
                    <input type="text" className="form-input" placeholder="No authentication" value={editMqttUsername} onChange={(e) => setEditMqttUsername(e.target.value)} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Password (Optional)</label>
                    <input type="password" className="form-input" placeholder="••••••••" value={editMqttPassword} onChange={(e) => setEditMqttPassword(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {editAdapterProtocol === 'WEBHOOK' && (
              <div className="form-stack-sm">
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">Security Token</label>
                  <div className="webhook-token-display-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="form-input text-mono"
                      readOnly
                      value={webhookToken}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      style={{ padding: '0.4rem 0.75rem', whiteSpace: 'nowrap' }}
                      onClick={() => setWebhookToken('wh_tok_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15))}
                    >
                      Regenerate
                    </button>
                  </div>
                  <span className="text-secondary text-xs" style={{ display: 'block', marginTop: '0.25rem' }}>
                    This token is required in the query string of your HTTP POST request to authorize payload delivery.
                  </span>
                </div>
              </div>
            )}

            {editAdapterProtocol === 'SIMULATOR' && (
              <div className="form-stack-sm">
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">Simulation Template</label>
                  <CustomSelect 
                    value={editSimulatorTemplate} 
                    onChange={setEditSimulatorTemplate} 
                    options={[
                      { value: 'energy', label: 'Energy (Voltage, Current, Power, Energy, Power Factor, Frequency)' },
                      { value: 'production', label: 'Production (Running, Total Count, Speed, Fault Code)' }
                    ]} 
                  />
                  <span className="text-secondary text-xs" style={{ display: 'block', marginTop: '0.4rem' }}>
                    Choose the simulated template. Note: Changing the template does not automatically delete/recreate existing tags.
                  </span>
                </div>
              </div>
            )}

            <div className="enable-adapter-row">
              <label className="enable-adapter-label">
                <input type="checkbox" checked={editAdapterIsEnabled} onChange={(e) => setEditAdapterIsEnabled(e.target.checked)} />
                Enable Adapter
              </label>
            </div>
          </div>
        </div>

        <div className="adapter-form-footer">
          <button type="submit" className="btn-dark-primary">Save Changes</button>
          <button type="button" onClick={onClose} className="btn-secondary btn-flex-1">Cancel</button>
        </div>
      </form>
    </ModalShell>
  );
}
