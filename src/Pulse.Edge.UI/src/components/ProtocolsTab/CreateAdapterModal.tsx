import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import CustomSelect from '../CustomSelect';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface CreateAdapterModalProps {
  onClose: () => void;
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function CreateAdapterModal({
  onClose,
  toast,
  fetchData
}: CreateAdapterModalProps) {
  const [newAdapterName, setNewAdapterName] = useState('');
  const [newAdapterProtocol, setNewAdapterProtocol] = useState('OPC_UA');
  const [newAdapterHost, setNewAdapterHost] = useState('127.0.0.1');
  const [newAdapterPort, setNewAdapterPort] = useState(4840);
  const [newModbusUnitId, setNewModbusUnitId] = useState<number>(1);
  const [newModbusTimeout, setNewModbusTimeout] = useState<number>(1000);
  const [newModbusRetries, setNewModbusRetries] = useState<number>(3);
  const [newOpcSecurityMode, setNewOpcSecurityMode] = useState<string>('None');
  const [newModbusRtuParity, setNewModbusRtuParity] = useState<string>('None');
  const [newModbusRtuStopBits, setNewModbusRtuStopBits] = useState<string>('One');
  const [newModbusRtuHandshake, setNewModbusRtuHandshake] = useState<string>('None');
  const [newOpcSecurityPolicy, setNewOpcSecurityPolicy] = useState<string>('None');
  const [newOpcUsername, setNewOpcUsername] = useState<string>('');
  const [newOpcPassword, setNewOpcPassword] = useState<string>('');
  const [newMqttClientId, setNewMqttClientId] = useState<string>('pulse-edge-agent');
  const [newMqttTopicPrefix, setNewMqttTopicPrefix] = useState<string>('');
  const [newMqttUsername, setNewMqttUsername] = useState<string>('');
  const [newMqttPassword, setNewMqttPassword] = useState<string>('');
  const [createTestStatus, setCreateTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle');
  const [createTestMessage, setCreateTestMessage] = useState('');
  const [opcEndpoints, setOpcEndpoints] = useState<any[]>([]);
  const [webhookToken, setWebhookToken] = useState('');
  const [opcDiscoverStatus, setOpcDiscoverStatus] = useState<'idle' | 'discovering' | 'success' | 'error'>('idle');
  const [opcDiscoverMessage, setOpcDiscoverMessage] = useState('');
  
  const [newPlcType, setNewPlcType] = useState<string>('ControlLogix');
  const [newPlcProtocol, setNewPlcProtocol] = useState<string>('ab_eip');
  const [newPlcPath, setNewPlcPath] = useState<string>('1,0');
  const [newPlcTimeoutMs, setNewPlcTimeoutMs] = useState<number>(5000);

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
        } else {
          setOpcDiscoverStatus('error');
          setOpcDiscoverMessage(data.message);
        }
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
    setCreateTestStatus('testing');
    setCreateTestMessage('');
    try {
      const res = await fetch('/api/adapters/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) { setCreateTestStatus('passed'); setCreateTestMessage(data.message); }
        else { setCreateTestStatus('failed'); setCreateTestMessage(data.message); }
      } else {
        setCreateTestStatus('failed');
        setCreateTestMessage(`HTTP Error ${res.status}: ${await res.text() || 'Internal Server Error'}`);
      }
    } catch (err) {
      setCreateTestStatus('failed');
      setCreateTestMessage(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCreateAdapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdapterName || !newAdapterProtocol || !newAdapterHost) {
      toast.warning('Please fill in all required fields.');
      return;
    }
    if (newAdapterProtocol !== 'WEBHOOK' && createTestStatus !== 'passed') {
      const reason = createTestStatus === 'failed' ? `\nReason: ${createTestMessage}` : '\nNo connection test was run.';
      if (!window.confirm(`Warning: The connection test to ${newAdapterHost}:${newAdapterPort} did not pass.${reason}\n\nAre you sure you want to create this adapter anyway?`)) return;
    }
    try {
      let configJson = '{}';
      if (newAdapterProtocol === 'MODBUS_TCP') {
        configJson = JSON.stringify({ UnitId: Number(newModbusUnitId), TimeoutMs: Number(newModbusTimeout), Retries: Number(newModbusRetries) });
      } else if (newAdapterProtocol === 'MODBUS_RTU') {
        configJson = JSON.stringify({ UnitId: Number(newModbusUnitId), Parity: newModbusRtuParity, StopBits: newModbusRtuStopBits, Handshake: newModbusRtuHandshake });
      } else if (newAdapterProtocol === 'OPC_UA') {
        configJson = JSON.stringify({ SecurityMode: newOpcSecurityMode, SecurityPolicy: newOpcSecurityPolicy, Username: newOpcUsername, Password: newOpcPassword });
      } else if (newAdapterProtocol === 'MQTT') {
        configJson = JSON.stringify({ ClientId: newMqttClientId, TopicPrefix: newMqttTopicPrefix, Username: newMqttUsername, Password: newMqttPassword });
      } else if (newAdapterProtocol === 'WEBHOOK') {
        configJson = JSON.stringify({ Token: webhookToken, LastPayload: '', LastSeen: '' });
      } else if (newAdapterProtocol === 'Ethernet/IP') {
        configJson = JSON.stringify({ PlcType: newPlcType, Protocol: newPlcProtocol, Path: newPlcPath, TimeoutMs: Number(newPlcTimeoutMs) });
      }
      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID ? crypto.randomUUID() : 'adapter-' + Math.random().toString(36).substring(2, 9),
          name: newAdapterName, protocol: newAdapterProtocol, host: newAdapterHost,
          port: Number(newAdapterPort), configJson, isEnabled: true, status: 'Offline'
        })
      });
      if (res.ok) { onClose(); toast.success('Protocol adapter created successfully.'); fetchData(); }
      else { toast.error('Failed to create protocol adapter.'); }
    } catch (err) {
      console.error('Failed to create adapter:', err);
      toast.error('Failed to create adapter.');
    }
  };

  return (
    <ModalShell
      title="Create Driver Adapter"
      subtitle="Add a new local hardware connection driver."
      size="xl"
      onClose={onClose}
    >
      <form onSubmit={handleCreateAdapter} className="form-stack-lg">
        <div className="adapter-form-cols">
          <div className="adapter-form-col">
            <h4 className="section-header-sm">General Settings</h4>

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Adapter Name</label>
              <input type="text" className="form-input" placeholder="e.g. PLC Line 1 OPC UA"
                value={newAdapterName} onChange={(e) => setNewAdapterName(e.target.value)} required />
            </div>

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Protocol Type</label>
             <CustomSelect value={newAdapterProtocol} onChange={(nextProtocol) => {
                setNewAdapterProtocol(nextProtocol);
                if (nextProtocol === 'OPC_UA') { setNewAdapterPort(4840); setNewOpcSecurityMode('None'); setNewOpcSecurityPolicy('None'); setNewOpcUsername(''); setNewOpcPassword(''); }
                else if (nextProtocol === 'MQTT') { setNewAdapterPort(1883); setNewMqttClientId('pulse-edge-agent'); setNewMqttTopicPrefix(''); setNewMqttUsername(''); setNewMqttPassword(''); }
                else if (nextProtocol === 'MODBUS_TCP') { setNewAdapterPort(502); setNewModbusUnitId(1); setNewModbusTimeout(1000); setNewModbusRetries(3); }
                else if (nextProtocol === 'MODBUS_RTU') { setNewAdapterHost('/dev/ttyUSB0'); setNewAdapterPort(9600); setNewModbusUnitId(1); setNewModbusRtuParity('None'); setNewModbusRtuStopBits('One'); setNewModbusRtuHandshake('None'); }
                else if (nextProtocol === 'Ethernet/IP') {
                  setNewAdapterPort(44818);
                  setNewPlcType('ControlLogix');
                  setNewPlcProtocol('ab_eip');
                  setNewPlcPath('1,0');
                  setNewPlcTimeoutMs(5000);
                }
                else if (nextProtocol === 'WEBHOOK') {
                  setNewAdapterHost('localhost');
                  setNewAdapterPort(80);
                  setWebhookToken('wh_tok_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15));
                }
              }} options={[
                { value: 'OPC_UA', label: 'OPC UA' },
                { value: 'MQTT', label: 'MQTT Broker' },
                { value: 'MODBUS_TCP', label: 'Modbus TCP Node' },
                { value: 'MODBUS_RTU', label: 'Modbus RTU (Serial)' },
                { value: 'Ethernet/IP', label: 'Ethernet/IP PLC' },
                { value: 'WEBHOOK', label: 'REST Webhook' }
              ]} />
            </div>

            {newAdapterProtocol !== 'WEBHOOK' && (
              <>
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">
                    {newAdapterProtocol === 'MODBUS_RTU' ? 'Serial Port' : 'Connection Host / IP'}
                  </label>
                  <input type="text" className="form-input" 
                    placeholder={newAdapterProtocol === 'MODBUS_RTU' ? 'e.g. COM3 or /dev/ttyUSB0' : 'e.g. 192.168.1.50 or localhost'}
                    value={newAdapterHost} onChange={(e) => { setNewAdapterHost(e.target.value); setCreateTestStatus('idle'); setCreateTestMessage(''); }} required />
                </div>

                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">
                    {newAdapterProtocol === 'MODBUS_RTU' ? 'Baud Rate' : 'Port Number'}
                  </label>
                  <input type="number" className="form-input" value={newAdapterPort}
                    onChange={(e) => { setNewAdapterPort(Number(e.target.value)); setCreateTestStatus('idle'); setCreateTestMessage(''); }} required />
                </div>

                {newAdapterProtocol !== 'MODBUS_RTU' && (
                  <div className="conn-test-section">
                    <button type="button" onClick={() => handleTestConnection(newAdapterHost, newAdapterPort)}
                      disabled={createTestStatus === 'testing'} className="btn-conn-test">
                      <RefreshCw size={14} className={createTestStatus === 'testing' ? 'spin' : ''} />
                      {createTestStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                    </button>
                    {createTestStatus !== 'idle' && (
                      <div className={`conn-test-result is-${createTestStatus}`}>
                        <div className="conn-test-result-header">
                          {createTestStatus === 'testing' && <RefreshCw size={14} className="spin" />}
                          {createTestStatus === 'passed' && <span>✓ Connection Pass</span>}
                          {createTestStatus === 'failed' && <span>⚠️ Connection Failed</span>}
                          {createTestStatus === 'testing' && <span>Testing connection...</span>}
                        </div>
                        {createTestMessage && <span className="conn-test-result-msg">{createTestMessage}</span>}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="adapter-form-col">
            <h4 className="section-header-sm">
              {newAdapterProtocol === 'MODBUS_TCP' && 'Modbus TCP Settings'}
              {newAdapterProtocol === 'MODBUS_RTU' && 'Modbus RTU Settings'}
              {newAdapterProtocol === 'Ethernet/IP' && 'Ethernet/IP Settings'}
              {newAdapterProtocol === 'OPC_UA' && 'OPC UA Security Settings'}
              {newAdapterProtocol === 'MQTT' && 'MQTT Client Settings'}
              {newAdapterProtocol === 'WEBHOOK' && 'REST Webhook Settings'}
            </h4>

            {newAdapterProtocol === 'MODBUS_TCP' && (
              <div className="form-grid-half">
                <div className="form-group form-group-flush">
                  <label className="form-label">Unit ID (1 - 255)</label>
                  <input type="number" min="1" max="255" className="form-input" value={newModbusUnitId}
                    onChange={(e) => setNewModbusUnitId(Math.max(1, Math.min(255, Number(e.target.value) || 1)))} required />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Timeout (ms)</label>
                  <input type="number" min="50" max="10000" className="form-input" value={newModbusTimeout}
                    onChange={(e) => setNewModbusTimeout(Math.max(50, Number(e.target.value) || 1000))} required />
                </div>
                <div className="form-group form-group-flush form-grid-span-2">
                  <label className="form-label">Max Retries</label>
                  <input type="number" min="0" max="10" className="form-input" value={newModbusRetries}
                    onChange={(e) => setNewModbusRetries(Math.max(0, Math.min(10, Number(e.target.value) || 0)))} required />
                </div>
              </div>
            )}

            {newAdapterProtocol === 'MODBUS_RTU' && (
              <div className="form-grid-half">
                <div className="form-group form-group-flush">
                  <label className="form-label">Unit ID (1 - 255)</label>
                  <input type="number" min="1" max="255" className="form-input" value={newModbusUnitId}
                    onChange={(e) => setNewModbusUnitId(Math.max(1, Math.min(255, Number(e.target.value) || 1)))} required />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Parity</label>
                  <CustomSelect value={newModbusRtuParity} onChange={setNewModbusRtuParity} options={[
                    { value: 'None', label: 'None' },
                    { value: 'Odd', label: 'Odd' },
                    { value: 'Even', label: 'Even' },
                    { value: 'Mark', label: 'Mark' },
                    { value: 'Space', label: 'Space' }
                  ]} />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Stop Bits</label>
                  <CustomSelect value={newModbusRtuStopBits} onChange={setNewModbusRtuStopBits} options={[
                    { value: 'One', label: 'One' },
                    { value: 'Two', label: 'Two' },
                    { value: 'OnePointFive', label: 'OnePointFive' },
                    { value: 'None', label: 'None' }
                  ]} />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Handshake</label>
                  <CustomSelect value={newModbusRtuHandshake} onChange={setNewModbusRtuHandshake} options={[
                    { value: 'None', label: 'None' },
                    { value: 'XOnXOff', label: 'XOnXOff' },
                    { value: 'RequestToSend', label: 'RequestToSend' },
                    { value: 'RequestToSendXOnXOff', label: 'RequestToSendXOnXOff' }
                  ]} />
                </div>
              </div>
            )}

            {newAdapterProtocol === 'Ethernet/IP' && (
              <div className="form-stack-sm">
                <div className="form-group form-group-flush">
                  <label className="form-label">PLC Type</label>
                  <CustomSelect value={newPlcType} onChange={setNewPlcType} options={[
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
                  <input type="text" className="form-input" value={newPlcPath}
                    onChange={(e) => setNewPlcPath(e.target.value)} required />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label">Timeout (ms)</label>
                  <input type="number" min="50" max="30000" className="form-input" value={newPlcTimeoutMs}
                    onChange={(e) => setNewPlcTimeoutMs(Math.max(50, Number(e.target.value) || 5000))} required />
                </div>
              </div>
            )}

            {newAdapterProtocol === 'OPC_UA' && (
              <div className="form-stack-sm">
                <div className="opc-discover-box">
                  <div className="opc-discover-header">
                    <span className="opc-discover-label">Auto-Discover OPC UA Endpoints</span>
                    <button type="button" onClick={() => handleDiscoverOpcUa(newAdapterHost, newAdapterPort)}
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
                            setNewOpcSecurityMode(mode === 'SignAndEncrypt' ? 'SignAndEncrypt' : mode === 'Sign' ? 'Sign' : 'None');
                            setNewOpcSecurityPolicy(policy);
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
                    <CustomSelect value={newOpcSecurityMode} onChange={setNewOpcSecurityMode} options={[
                      { value: 'None', label: 'None' }, { value: 'Sign', label: 'Sign' }, { value: 'SignAndEncrypt', label: 'Sign & Encrypt' }
                    ]} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Security Policy</label>
                    <CustomSelect value={newOpcSecurityPolicy} onChange={setNewOpcSecurityPolicy} options={[
                      { value: 'None', label: 'None' }, { value: 'Basic128Rsa15', label: 'Basic128Rsa15' },
                      { value: 'Basic256', label: 'Basic256' }, { value: 'Basic256Sha256', label: 'Basic256Sha256' },
                      { value: 'Aes128_Sha256_RsaOaep', label: 'Aes128_Sha256_RsaOaep' }
                    ]} />
                  </div>
                </div>
                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Username (Optional)</label>
                    <input type="text" className="form-input" placeholder="No authentication" value={newOpcUsername} onChange={(e) => setNewOpcUsername(e.target.value)} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Password (Optional)</label>
                    <input type="password" className="form-input" placeholder="••••••••" value={newOpcPassword} onChange={(e) => setNewOpcPassword(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {newAdapterProtocol === 'MQTT' && (
              <div className="form-stack-sm">
                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Client ID</label>
                    <input type="text" className="form-input" value={newMqttClientId} onChange={(e) => setNewMqttClientId(e.target.value)} required />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Topic Prefix (Optional)</label>
                    <input type="text" className="form-input" placeholder="e.g. factory/line1" value={newMqttTopicPrefix} onChange={(e) => setNewMqttTopicPrefix(e.target.value)} />
                  </div>
                </div>
                <div className="form-grid-half">
                  <div className="form-group form-group-flush">
                    <label className="form-label">Username (Optional)</label>
                    <input type="text" className="form-input" placeholder="No authentication" value={newMqttUsername} onChange={(e) => setNewMqttUsername(e.target.value)} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label">Password (Optional)</label>
                    <input type="password" className="form-input" placeholder="••••••••" value={newMqttPassword} onChange={(e) => setNewMqttPassword(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {newAdapterProtocol === 'WEBHOOK' && (
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
                      onClick={() => setNewAdapterProtocol('WEBHOOK')} // Force update / state refresh or do actual regen
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
                    This token is generated automatically. It must be included in the webhook URL query string to authorize payload delivery.
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="adapter-form-footer">
          <button type="submit" className="btn-dark-primary">Create Adapter</button>
          <button type="button" onClick={onClose} className="btn-secondary btn-flex-1">Cancel</button>
        </div>
      </form>
    </ModalShell>
  );
}
