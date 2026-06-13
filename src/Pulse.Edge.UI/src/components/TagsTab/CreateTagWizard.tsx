import { useState } from 'react';
import type { DriverAdapter, MqttDevice } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import OpcBrowserModal from './OpcBrowserModal';
import MqttBrowserModal from './MqttBrowserModal';
import WebhookBrowserModal from './WebhookBrowserModal';
import RestApiBrowserModal from './RestApiBrowserModal';
import EthernetIpBrowserModal from './EthernetIpBrowserModal';
import SiemensS7BrowserModal from './SiemensS7BrowserModal';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface CreateTagWizardProps {
  isOpen: boolean;
  onClose: () => void;
  adapters: DriverAdapter[];
  mqttDevices: MqttDevice[];
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function CreateTagWizard({ isOpen, onClose, adapters, mqttDevices, toast, fetchData }: CreateTagWizardProps) {
  const [wizardStep, setWizardStep] = useState(1);
  const [newDpAdapterId, setNewDpAdapterId] = useState(() => adapters[0]?.id || '');
  const [newDpMqttDeviceId, setNewDpMqttDeviceId] = useState('');
  const [newDpAddress, setNewDpAddress] = useState('');
  const [newDpDataType, setNewDpDataType] = useState('Int16');
  const [newDpScanIntervalMs, setNewDpScanIntervalMs] = useState(1000);
  const [newDpScaleFactor, setNewDpScaleFactor] = useState<string>('1.0');
  const [newDpOffset, setNewDpOffset] = useState<string>('0.0');
  const [newDpByteOrder, setNewDpByteOrder] = useState(() => {
    const defaultAdp = adapters[0];
    return defaultAdp?.protocol === 'MODBUS_TCP' ? 'AB' : 'ABCD';
  });
  const [newDpDescription, setNewDpDescription] = useState('');
  const [newDpCount, setNewDpCount] = useState(1);
  const [newDpMqttParseMode, setNewDpMqttParseMode] = useState('Plaintext');
  const [newDpMqttJsonPath, setNewDpMqttJsonPath] = useState('');
  const [isOpcBrowserOpen, setIsOpcBrowserOpen] = useState(false);
  const [isMqttBrowserOpen, setIsMqttBrowserOpen] = useState(false);
  const [isWebhookBrowserOpen, setIsWebhookBrowserOpen] = useState(false);
  const [isRestApiBrowserOpen, setIsRestApiBrowserOpen] = useState(false);
  const [isEipBrowserOpen, setIsEipBrowserOpen] = useState(false);
  const [isS7BrowserOpen, setIsS7BrowserOpen] = useState(false);

  const handleCreateAdapterChange = (adapterId: string) => {
    setNewDpAdapterId(adapterId);
    setNewDpMqttDeviceId('');
    const selected = adapters.find(a => a.id === adapterId);
    if (selected?.protocol === 'WEBHOOK' || selected?.protocol === 'REST_API') {
      setNewDpMqttParseMode('JSON');
      setNewDpByteOrder('ABCD');
    } else if (selected?.protocol !== 'MODBUS_TCP') {
      setNewDpByteOrder('ABCD');
    } else {
      setNewDpByteOrder(newDpDataType === 'Int16' || newDpDataType === 'UInt16' ? 'AB' : 'ABCD');
    }
  };

  const handleCreateMqttDeviceChange = (devId: string) => {
    setNewDpMqttDeviceId(devId);
    const dev = mqttDevices.find(d => d.id === devId);
    setNewDpMqttParseMode(dev ? dev.mqttParseMode : 'Plaintext');
  };

  const handleCreateDataTypeChange = (dataType: string) => {
    setNewDpDataType(dataType);
    setNewDpByteOrder(dataType === 'Int16' || dataType === 'UInt16' ? 'AB' : 'ABCD');
  };

  const getModbusWordCount = (dataType: string): number => {
    switch (dataType) {
      case 'Int16': case 'UInt16': case 'Boolean': return 1;
      case 'Int32': case 'UInt32': case 'Float': return 2;
      case 'Double': case 'Int64': case 'UInt64': return 4;
      default: return 1;
    }
  };

  const incrementModbusAddress = (base: string, wordOffset: number): string => {
    const trimmed = base.trim();
    if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10) + wordOffset);
    const m = trimmed.match(/^([A-Za-z]+)(\d+)$/i);
    if (m) return m[1] + String(parseInt(m[2], 10) + wordOffset);
    return base;
  };

  const handleCreatePhysicalTag = async () => {
    if (!newDpAdapterId || !newDpAddress) { toast.warning('Please fill in all required fields.'); return; }

    const isModbus = adapters.find(a => a.id === newDpAdapterId)?.protocol === 'MODBUS_TCP';
    const count = isModbus ? Math.max(1, Math.min(125, newDpCount)) : 1;
    const wordStep = getModbusWordCount(newDpDataType);
    const parsedScale = parseFloat(newDpScaleFactor);
    const parsedOffset = parseFloat(newDpOffset);
    const basePayload = {
      id: '', adapterId: newDpAdapterId, mqttDeviceId: newDpMqttDeviceId || null,
      dataSourceId: '', metric: '', dataType: newDpDataType, scanIntervalMs: Number(newDpScanIntervalMs),
      scaleFactor: isNaN(parsedScale) ? 1.0 : parsedScale, offset: isNaN(parsedOffset) ? 0.0 : parsedOffset,
      isEnabled: true, byteOrder: newDpByteOrder, description: newDpDescription,
      mqttParseMode: newDpMqttParseMode, mqttJsonPath: newDpMqttParseMode === 'JSON' ? newDpMqttJsonPath : null
    };

    let successes = 0, failures = 0;
    try {
      for (let i = 0; i < count; i++) {
        const address = i === 0 ? newDpAddress : incrementModbusAddress(newDpAddress, i * wordStep);
        const res = await fetch('/api/datapoints', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...basePayload, address })
        });
        if (res.ok) successes++; else failures++;
      }

      setNewDpAddress(''); setNewDpMqttDeviceId(''); setNewDpDescription('');
      setNewDpCount(1); setNewDpMqttParseMode('Plaintext'); setNewDpMqttJsonPath('');
      onClose(); fetchData();

      if (count === 1) {
        if (successes) toast.success('Physical tag registered successfully.');
        else toast.error('Failed to register physical tag.');
      } else {
        const msg = `Bulk registration: ${successes} tag(s) created${failures ? `, ${failures} failed` : ''}.`;
        if (failures) toast.warning(msg); else toast.success(msg);
      }
    } catch (err) {
      console.error('Failed to create physical tag:', err);
      toast.error('Failed to create physical tag.');
    }
  };

  const handleOpenOpcBrowser = () => {
    if (!newDpAdapterId) { toast.warning('Please select an OPC UA adapter first.'); return; }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'OPC_UA') { toast.warning('The selected adapter is not an OPC UA adapter.'); return; }
    setIsOpcBrowserOpen(true);
  };

  const handleOpenMqttBrowser = () => {
    if (!newDpAdapterId) { toast.warning('Please select an MQTT adapter first.'); return; }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'MQTT') { toast.warning('The selected adapter is not an MQTT adapter.'); return; }
    setIsMqttBrowserOpen(true);
  };

  const handleOpenWebhookBrowser = () => {
    if (!newDpAdapterId) { toast.warning('Please select a Webhook adapter first.'); return; }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'WEBHOOK') { toast.warning('The selected adapter is not a Webhook adapter.'); return; }
    setIsWebhookBrowserOpen(true);
  };

  const handleOpenRestApiBrowser = () => {
    if (!newDpAdapterId) { toast.warning('Please select a REST API adapter first.'); return; }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'REST_API') { toast.warning('The selected adapter is not a REST API adapter.'); return; }
    setIsRestApiBrowserOpen(true);
  };

  const handleOpenEipBrowser = () => {
    if (!newDpAdapterId) { toast.warning('Please select an Ethernet/IP adapter first.'); return; }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'Ethernet/IP') { toast.warning('The selected adapter is not an Ethernet/IP adapter.'); return; }
    setIsEipBrowserOpen(true);
  };

  const handleOpenS7Browser = () => {
    if (!newDpAdapterId) { toast.warning('Please select a Siemens S7 adapter first.'); return; }
    const adapter = adapters.find(a => a.id === newDpAdapterId);
    if (!adapter || adapter.protocol !== 'Siemens S7') { toast.warning('The selected adapter is not a Siemens S7 adapter.'); return; }
    setIsS7BrowserOpen(true);
  };

  if (!isOpen) return null;

  const activeAdapter = adapters.find(a => a.id === newDpAdapterId);
  const protocol = activeAdapter?.protocol;
  let plcType = '';
  if (activeAdapter && protocol === 'Ethernet/IP' && activeAdapter.configJson) {
    try {
      const config = JSON.parse(activeAdapter.configJson);
      plcType = config.PlcType || '';
    } catch (e) {}
  }
  const isBrowseSupported = (protocol === 'Ethernet/IP' &&
    (plcType === 'ControlLogix' || plcType === 'CompactLogix' || plcType === 'Micro800')) ||
    protocol === 'Siemens S7';

  const stepTitle =
    wizardStep === 1 ? 'Step 1: Identify the connection source and tag address details.' :
    wizardStep === 2 ? 'Step 2: Define how the incoming raw binary data should be formatted.' :
    'Step 3: Fine-tune polling frequency and scale raw analog readings.';

  return (
    <>
      <ModalShell
        title="Register Sensor Tag Wizard"
        subtitle={stepTitle}
        size="md"
        onClose={onClose}
      >
        <div className="wizard-body">
          {/* Step Progress Bar */}
          <div className="wizard-progress">
            <div className="wizard-step-group">
              <span className={`wizard-step-circle ${wizardStep >= 1 ? 'is-done' : 'is-pending'}`}>1</span>
              <span className={`wizard-step-label ${wizardStep === 1 ? 'is-current' : 'is-pending'}`}>Address</span>
            </div>
            <div className="wizard-step-line" />
            <div className="wizard-step-group">
              <span className={`wizard-step-circle ${wizardStep >= 2 ? 'is-done' : 'is-pending'}`}>2</span>
              <span className={`wizard-step-label ${wizardStep === 2 ? 'is-current' : 'is-pending'}`}>Data Type</span>
            </div>
            {protocol !== 'MQTT' && protocol !== 'WEBHOOK' && (
              <>
                <div className="wizard-step-line" />
                <div className="wizard-step-group">
                  <span className={`wizard-step-circle ${wizardStep >= 3 ? 'is-done' : 'is-pending'}`}>3</span>
                  <span className={`wizard-step-label ${wizardStep === 3 ? 'is-current' : 'is-pending'}`}>Scaling</span>
                </div>
              </>
            )}
          </div>

          {/* STEP 1 */}
          {wizardStep === 1 && (
            <div className="form-stack">
              <div className="form-group form-group-flush">
                <label className="form-label form-label-bold">Connection Driver Adapter</label>
                {adapters.length === 0 ? (
                  <div className="alert-box-danger">
                    No protocol adapters configured. Please configure an adapter under the "Protocols" tab first.
                  </div>
                ) : (
                  <CustomSelect value={newDpAdapterId} onChange={handleCreateAdapterChange}
                    placeholder="-- Choose Driver Connection --"
                    options={adapters.map(a => ({ value: a.id, label: `${a.name} (${a.protocol.replace('_', ' ')} @ ${a.host}:${a.port})` }))} />
                )}
              </div>

              {newDpAdapterId && (
                <>
                  {protocol === 'MQTT' && (
                    <div className="form-group form-group-flush">
                      <label className="form-label form-label-bold">MQTT Device Session</label>
                      <CustomSelect value={newDpMqttDeviceId} onChange={handleCreateMqttDeviceChange}
                        placeholder="-- None (Legacy Flat Topic Mapping) --"
                        options={mqttDevices.filter(d => d.adapterId === newDpAdapterId).map(d => ({ value: d.id, label: `${d.name} (${d.topicSubscription})` }))} />
                    </div>
                  )}

                  <div className="form-group form-group-flush">
                    <label className="form-label form-label-bold">
                      {protocol === 'MODBUS_TCP' && 'Modbus Register Address'}
                      {(protocol === 'Ethernet/IP' || protocol === 'Siemens S7') && 'PLC Tag Name'}
                      {protocol === 'OPC_UA' && 'OPC UA Node ID'}
                      {protocol === 'SIMULATOR' && 'Simulated Variable Name'}
                      {protocol === 'MQTT' && (newDpMqttDeviceId
                        ? (mqttDevices.find(d => d.id === newDpMqttDeviceId)?.mqttParseMode === 'JSON' ? 'JSON Path (from device payload)' : 'MQTT Sub-topic or Metric Name')
                        : 'MQTT Topic')}
                      {protocol === 'WEBHOOK' && 'JSON Path (from webhook payload)'}
                      {protocol === 'REST_API' && 'JSON Path (from JSON payload)'}
                    </label>
                    <div className="address-input-row">
                      <input className="form-input address-input-mono" type="text"
                        placeholder={
                          protocol === 'MODBUS_TCP' ? 'e.g. 40001 (Holding Register) or 30005 (Input Register)' :
                          protocol === 'Ethernet/IP' ? 'e.g. PROGRAM:Main.Machine_Speed or MyGlobalTag' :
                          protocol === 'Siemens S7' ? 'e.g. DB1.DBX0.0 or DB2.DBW2' :
                          protocol === 'OPC_UA' ? 'e.g. ns=2;s=Machine_Temperature' :
                          (protocol === 'WEBHOOK' || protocol === 'REST_API') ? 'e.g. $.temperature or $.sensors.humidity' :
                          protocol === 'SIMULATOR' ? 'e.g. voltage, current, active_power, energy, running, count' :
                          newDpMqttDeviceId
                            ? (mqttDevices.find(d => d.id === newDpMqttDeviceId)?.mqttParseMode === 'JSON' ? 'e.g. $.temperature or $.sensors.humidity' : 'e.g. temperature')
                            : 'e.g. factory/casepacker/temperature'
                        }
                        value={newDpAddress} onChange={(e) => setNewDpAddress(e.target.value)} required />
                      {protocol === 'OPC_UA' && (
                        <button type="button" onClick={handleOpenOpcBrowser} className="btn-browse">Browse Server</button>
                      )}
                      {protocol === 'MQTT' && (
                        <button type="button" onClick={handleOpenMqttBrowser} className="btn-browse">Browse Broker</button>
                      )}
                      {protocol === 'WEBHOOK' && (
                        <button type="button" onClick={handleOpenWebhookBrowser} className="btn-browse">Browse Payload</button>
                      )}
                      {protocol === 'REST_API' && (
                        <button type="button" onClick={handleOpenRestApiBrowser} className="btn-browse">Browse Payload</button>
                      )}
                      {isBrowseSupported && (
                        <button 
                          type="button" 
                          onClick={protocol === 'Siemens S7' ? handleOpenS7Browser : handleOpenEipBrowser} 
                          className="btn-browse"
                        >
                          Browse PLC
                        </button>
                      )}
                    </div>
                  </div>

                  {protocol === 'MODBUS_TCP' && (
                    <div className="bulk-qty-row">
                      <div className="form-group form-group-flush">
                        <label className="form-label form-label-bold">Bulk Quantity</label>
                        <input type="number" className="form-input text-mono" min={1} max={125} value={newDpCount}
                          onChange={(e) => setNewDpCount(Math.max(1, Math.min(125, parseInt(e.target.value, 10) || 1)))} />
                      </div>
                      {newDpCount > 1 && newDpAddress.trim() && (
                        <div className="bulk-preview-hint">
                          Generates tags from <code className="font-bold">{newDpAddress}</code> to <code className="font-bold">{incrementModbusAddress(newDpAddress, (newDpCount - 1) * getModbusWordCount(newDpDataType))}</code> (word-aligned step size: {getModbusWordCount(newDpDataType)}).
                        </div>
                      )}
                    </div>
                  )}

                  <div className="form-group form-group-flush">
                    <label className="form-label form-label-bold">Tag Description / Notes</label>
                    <input className="form-input" type="text" placeholder="e.g. Case Packer Zone B Steam pressure sensor"
                      value={newDpDescription} onChange={(e) => setNewDpDescription(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 2 */}
          {wizardStep === 2 && (
            <div className="form-stack">
              <div className="form-group form-group-flush">
                <label className="form-label form-label-bold">Register Data Type</label>
                {protocol === 'MODBUS_TCP' && (
                  <div className="modbus-hint">String data type is not supported on Modbus TCP registers.</div>
                )}
                <CustomSelect value={newDpDataType} onChange={handleCreateDataTypeChange} options={[
                  { value: 'Int16', label: 'Int16 (1 word / 16-bit)' }, { value: 'UInt16', label: 'UInt16 (1 word / 16-bit unsigned)' },
                  { value: 'Int32', label: 'Int32 (2 words / 32-bit)' }, { value: 'UInt32', label: 'UInt32 (2 words / 32-bit unsigned)' },
                  { value: 'Float', label: 'Float (2 words / 32-bit single-precision)' }, { value: 'Double', label: 'Double (4 words / 64-bit double-precision)' },
                  { value: 'Int64', label: 'Int64 (4 words / 64-bit)' }, { value: 'UInt64', label: 'UInt64 (4 words / 64-bit unsigned)' },
                  { value: 'Boolean', label: 'Boolean (1 word / bit state)' },
                  ...(protocol !== 'MODBUS_TCP' ? [{ value: 'String', label: 'String (UTF-8)' }] : [])
                ]} />
              </div>

              {protocol === 'MQTT' && !newDpMqttDeviceId && (
                <>
                  <div className="form-group form-group-flush">
                    <label className="form-label form-label-bold">Parse Mode</label>
                    <CustomSelect value={newDpMqttParseMode} onChange={setNewDpMqttParseMode} options={[
                      { value: 'Plaintext', label: 'Plaintext Value' }, { value: 'JSON', label: 'JSON Parser' }
                    ]} />
                  </div>
                  {newDpMqttParseMode === 'JSON' && (
                    <div className="form-group form-group-flush">
                      <label className="form-label form-label-bold">JSON Path / Key</label>
                      <input className="form-input text-mono" type="text" placeholder="e.g. $.sensors.temperature or temperature"
                        value={newDpMqttJsonPath} onChange={(e) => setNewDpMqttJsonPath(e.target.value)} required />
                    </div>
                  )}
                </>
              )}

              {(protocol === 'WEBHOOK' || protocol === 'REST_API') && (
                <>
                  <div className="form-group form-group-flush">
                    <label className="form-label form-label-bold">Parse Mode</label>
                    <CustomSelect value={newDpMqttParseMode} onChange={setNewDpMqttParseMode} options={[
                      { value: 'JSON', label: 'JSON Parser' }
                    ]} />
                  </div>
                  <div className="form-group form-group-flush">
                    <label className="form-label form-label-bold">JSON Path / Key</label>
                    <input className="form-input text-mono" type="text" placeholder="e.g. $.sensors.temperature or temperature"
                      value={newDpAddress} onChange={(e) => { setNewDpAddress(e.target.value); setNewDpMqttJsonPath(e.target.value); }} required />
                  </div>
                </>
              )}

              {protocol === 'MODBUS_TCP' && (
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">Byte Order / Endianness Swap</label>
                  <CustomSelect value={newDpByteOrder} onChange={setNewDpByteOrder} options={
                    newDpDataType === 'Int16' || newDpDataType === 'UInt16' ? [
                      { value: 'AB', label: 'AB (Normal / Big Endian)' }, { value: 'BA', label: 'BA (Swapped Bytes / Little Endian)' }
                    ] : [
                      { value: 'ABCD', label: 'ABCD (Normal / Big Endian)' }, { value: 'CDAB', label: 'CDAB (Word Swap / Mid-Little Endian)' },
                      { value: 'BADC', label: 'BADC (Byte Swap)' }, { value: 'DCBA', label: 'DCBA (Byte & Word Swap / Little Endian)' }
                    ]
                  } />
                </div>
              )}
            </div>
          )}

          {/* STEP 3 */}
          {wizardStep === 3 && protocol !== 'MQTT' && (
            <div className="form-stack">
              <div className="form-group form-group-flush">
                <label className="form-label form-label-bold">Scan Rate (ms)</label>
                <input className="form-input text-mono" type="number" value={newDpScanIntervalMs}
                  onChange={(e) => setNewDpScanIntervalMs(parseInt(e.target.value, 10) || 1000)} min={100} />
              </div>
              <div className="form-grid-half">
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">Scale Factor</label>
                  <input className="form-input text-mono" type="number" step="any" value={newDpScaleFactor}
                    onChange={(e) => setNewDpScaleFactor(e.target.value)} />
                </div>
                <div className="form-group form-group-flush">
                  <label className="form-label form-label-bold">Offset</label>
                  <input className="form-input text-mono" type="number" step="any" value={newDpOffset}
                    onChange={(e) => setNewDpOffset(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Wizard Footer */}
          <div className="wizard-footer">
            {wizardStep > 1 && (
              <button type="button" onClick={() => setWizardStep(prev => Math.max(1, prev - 1))}
                className="btn-secondary btn-flex-1">Back</button>
            )}
            {wizardStep === 1 && (
              <button type="button" onClick={onClose} className="btn-secondary btn-flex-1">Cancel</button>
            )}
            {(() => {
              const isLastStep = (protocol === 'MQTT' || protocol === 'WEBHOOK') ? wizardStep === 2 : wizardStep === 3;
              const isNextDisabled = wizardStep === 1 && (!newDpAdapterId || !newDpAddress.trim());

              if (isLastStep) {
                return (
                  <button type="button" onClick={handleCreatePhysicalTag}
                    disabled={isNextDisabled || adapters.length === 0}
                    className="btn-register">
                    Register Tag
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  onClick={() => setWizardStep(prev => prev + 1)}
                  disabled={isNextDisabled}
                  className="btn-primary btn-flex-2"
                >
                  Next Step
                </button>
              );
            })()}
          </div>
        </div>
      </ModalShell>

      <OpcBrowserModal
        isOpen={isOpcBrowserOpen}
        onClose={() => setIsOpcBrowserOpen(false)}
        adapterId={newDpAdapterId}
        adapters={adapters}
        toast={toast}
        onSaveSuccess={() => { setIsOpcBrowserOpen(false); onClose(); fetchData(); }}
      />

      <MqttBrowserModal
        isOpen={isMqttBrowserOpen}
        onClose={() => setIsMqttBrowserOpen(false)}
        adapterId={newDpAdapterId}
        adapters={adapters}
        mqttDevices={mqttDevices}
        toast={toast}
        onSaveSuccess={() => { setIsMqttBrowserOpen(false); onClose(); fetchData(); }}
        selectedMqttDeviceId={newDpMqttDeviceId}
      />

      <WebhookBrowserModal
        isOpen={isWebhookBrowserOpen}
        onClose={() => setIsWebhookBrowserOpen(false)}
        adapterId={newDpAdapterId}
        adapters={adapters}
        toast={toast}
        onSaveSuccess={() => { setIsWebhookBrowserOpen(false); onClose(); fetchData(); }}
      />

      <RestApiBrowserModal
        isOpen={isRestApiBrowserOpen}
        onClose={() => setIsRestApiBrowserOpen(false)}
        adapterId={newDpAdapterId}
        adapters={adapters}
        toast={toast}
        onSaveSuccess={() => { setIsRestApiBrowserOpen(false); onClose(); fetchData(); }}
      />

      <EthernetIpBrowserModal
        isOpen={isEipBrowserOpen}
        onClose={() => setIsEipBrowserOpen(false)}
        adapterId={newDpAdapterId}
        adapters={adapters}
        toast={toast}
        onSaveSuccess={() => { setIsEipBrowserOpen(false); onClose(); fetchData(); }}
      />

      <SiemensS7BrowserModal
        isOpen={isS7BrowserOpen}
        onClose={() => setIsS7BrowserOpen(false)}
        adapterId={newDpAdapterId}
        adapters={adapters}
        toast={toast}
        onSaveSuccess={() => { setIsS7BrowserOpen(false); onClose(); fetchData(); }}
      />
    </>
  );
}
