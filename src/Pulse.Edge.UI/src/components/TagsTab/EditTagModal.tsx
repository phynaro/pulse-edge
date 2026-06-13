import { useState, useEffect } from 'react';
import type { DataPoint, DriverAdapter, MqttDevice } from '../../types';
import type { useToast } from '../../hooks/useToast';
import CustomSelect from '../CustomSelect';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface EditTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  tag: DataPoint | null;
  adapters: DriverAdapter[];
  mqttDevices: MqttDevice[];
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function EditTagModal({ isOpen, onClose, tag, adapters, mqttDevices, toast, fetchData }: EditTagModalProps) {
  const [editDpAdapterId, setEditDpAdapterId] = useState('');
  const [editDpMqttDeviceId, setEditDpMqttDeviceId] = useState('');
  const [editDpAddress, setEditDpAddress] = useState('');
  const [editDpDataType, setEditDpDataType] = useState('Float');
  const [editDpScanIntervalMs, setEditDpScanIntervalMs] = useState(1000);
  const [editDpScaleFactor, setEditDpScaleFactor] = useState<string>('1.0');
  const [editDpOffset, setEditDpOffset] = useState<string>('0.0');
  const [editDpByteOrder, setEditDpByteOrder] = useState('ABCD');
  const [editDpIsEnabled, setEditDpIsEnabled] = useState(true);
  const [editDpDescription, setEditDpDescription] = useState('');
  const [editDpMqttParseMode, setEditDpMqttParseMode] = useState('Plaintext');
  const [editDpMqttJsonPath, setEditDpMqttJsonPath] = useState('');

  useEffect(() => {
    if (tag) {
      setEditDpAdapterId(tag.adapterId);
      setEditDpMqttDeviceId(tag.mqttDeviceId || '');
      setEditDpAddress(tag.address);
      setEditDpDataType(tag.dataType);
      setEditDpScanIntervalMs(tag.scanIntervalMs);
      setEditDpScaleFactor(String(tag.scaleFactor));
      setEditDpOffset(String(tag.offset));
      setEditDpByteOrder(tag.byteOrder || (tag.dataType === 'Int16' || tag.dataType === 'UInt16' ? 'AB' : 'ABCD'));
      setEditDpIsEnabled(tag.isEnabled);
      setEditDpDescription(tag.description || '');
      setEditDpMqttParseMode(tag.mqttParseMode || 'Plaintext');
      setEditDpMqttJsonPath(tag.mqttJsonPath || '');
    }
  }, [tag]);

  const handleEditAdapterChange = (adapterId: string) => {
    setEditDpAdapterId(adapterId);
    setEditDpMqttDeviceId('');
    const selected = adapters.find(a => a.id === adapterId);
    if (selected?.protocol === 'WEBHOOK' || selected?.protocol === 'REST_API') {
      setEditDpMqttParseMode('JSON');
      setEditDpByteOrder('ABCD');
    } else if (selected?.protocol !== 'MODBUS_TCP') {
      setEditDpByteOrder('ABCD');
    } else {
      setEditDpByteOrder(editDpDataType === 'Int16' || editDpDataType === 'UInt16' ? 'AB' : 'ABCD');
    }
  };

  const handleEditMqttDeviceChange = (devId: string) => {
    setEditDpMqttDeviceId(devId);
    const dev = mqttDevices.find(d => d.id === devId);
    setEditDpMqttParseMode(dev ? dev.mqttParseMode : 'Plaintext');
  };

  const handleEditDataTypeChange = (dataType: string) => {
    setEditDpDataType(dataType);
    setEditDpByteOrder(dataType === 'Int16' || dataType === 'UInt16' ? 'AB' : 'ABCD');
  };

  const handleEditPhysicalTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tag) return;
    if (!editDpAdapterId || !editDpAddress) { toast.warning('Please fill in all required fields.'); return; }
    try {
      const parsedScale = parseFloat(editDpScaleFactor);
      const parsedOffset = parseFloat(editDpOffset);
      const res = await fetch('/api/datapoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: tag.id, adapterId: editDpAdapterId, mqttDeviceId: editDpMqttDeviceId || null,
          dataSourceId: tag.dataSourceId || '', metric: tag.metric || '',
          address: editDpAddress, dataType: editDpDataType, scanIntervalMs: Number(editDpScanIntervalMs),
          scaleFactor: isNaN(parsedScale) ? 1.0 : parsedScale, offset: isNaN(parsedOffset) ? 0.0 : parsedOffset,
          isEnabled: editDpIsEnabled, byteOrder: editDpByteOrder, description: editDpDescription,
          mqttParseMode: editDpMqttParseMode, mqttJsonPath: editDpMqttParseMode === 'JSON' ? editDpMqttJsonPath : null
        })
      });
      if (res.ok) { toast.success('Physical tag updated successfully.'); onClose(); fetchData(); }
      else { toast.error('Failed to update physical tag.'); }
    } catch (err) {
      console.error('Failed to update physical tag:', err);
      toast.error('Failed to update physical tag.');
    }
  };

  if (!isOpen || !tag) return null;

  const activeAdapter = adapters.find(a => a.id === editDpAdapterId);
  const protocol = activeAdapter?.protocol;

  return (
    <ModalShell
      title="Edit Physical Sensor Tag"
      subtitle="Modify the configuration for hardware sensor tag."
      size="md"
      onClose={onClose}
    >
      <form onSubmit={handleEditPhysicalTag} className="modal-form">
        <div className="form-group form-group-flush">
          <label className="form-label form-label-bold">Connection Driver Adapter</label>
          <CustomSelect value={editDpAdapterId} onChange={handleEditAdapterChange}
            options={adapters.map(a => ({ value: a.id, label: `${a.name} (${a.protocol.replace('_', ' ')} @ ${a.host}:${a.port})` }))} />
        </div>

        {protocol === 'MQTT' && (
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">MQTT Device Session</label>
            <CustomSelect value={editDpMqttDeviceId} onChange={handleEditMqttDeviceChange}
              placeholder="-- None (Legacy Flat Topic Mapping) --"
              options={mqttDevices.filter(d => d.adapterId === editDpAdapterId).map(d => ({ value: d.id, label: `${d.name} (${d.topicSubscription})` }))} />
          </div>
        )}

        <div className="form-group form-group-flush">
          <label className="form-label form-label-bold">
            {protocol === 'MODBUS_TCP' ? 'Modbus Register Address' :
             protocol === 'Ethernet/IP' ? 'PLC Tag Name' :
             protocol === 'Siemens S7' ? 'PLC Tag Name' :
             protocol === 'OPC_UA' ? 'OPC UA Node ID' :
             protocol === 'MQTT' ? (editDpMqttDeviceId
               ? (mqttDevices.find(d => d.id === editDpMqttDeviceId)?.mqttParseMode === 'JSON' ? 'JSON Path (from device payload)' : 'MQTT Sub-topic or Metric Name')
               : 'MQTT Topic') :
             (protocol === 'WEBHOOK' || protocol === 'REST_API') ? 'JSON Path (from JSON payload)' : 'Tag Address'}
          </label>
          <input className="form-input text-mono" type="text"
            placeholder={protocol === 'MODBUS_TCP' ? 'e.g. 40001 or 30005' :
              protocol === 'Ethernet/IP' ? 'e.g. PROGRAM:Main.Machine_Speed or MyGlobalTag' :
              protocol === 'Siemens S7' ? 'e.g. DB1.DBX0.0 or DB2.DBW2' :
              protocol === 'OPC_UA' ? 'e.g. ns=2;s=Temperature' :
              (protocol === 'WEBHOOK' || protocol === 'REST_API') ? 'e.g. $.temperature or $.sensors.humidity' :
              protocol === 'MQTT' ? (editDpMqttDeviceId
                ? (mqttDevices.find(d => d.id === editDpMqttDeviceId)?.mqttParseMode === 'JSON' ? 'e.g. $.temperature or $.sensors.humidity' : 'e.g. temperature')
                : 'e.g. factory/casepacker/temperature') : 'e.g. Address'}
            value={editDpAddress} onChange={(e) => { setEditDpAddress(e.target.value); if (protocol === 'WEBHOOK' || protocol === 'REST_API') setEditDpMqttJsonPath(e.target.value); }} required />
        </div>

        <div className="form-group form-group-flush">
          <label className="form-label form-label-bold">Tag Description</label>
          <input className="form-input" type="text" placeholder="e.g. Steam pressure sensor for Zone A, Packer 2"
            value={editDpDescription} onChange={(e) => setEditDpDescription(e.target.value)} />
        </div>

        <div className="form-grid-tag-edit">
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Data Type</label>
            {protocol === 'MODBUS_TCP' && (
              <div className="modbus-hint">String not supported on Modbus TCP</div>
            )}
            <CustomSelect value={editDpDataType} onChange={handleEditDataTypeChange} options={[
              { value: 'Int16', label: 'Int16 (1 word)' }, { value: 'UInt16', label: 'UInt16 (1 word)' },
              { value: 'Int32', label: 'Int32 (2 words)' }, { value: 'UInt32', label: 'UInt32 (2 words)' },
              { value: 'Float', label: 'Float (2 words)' }, { value: 'Double', label: 'Double (4 words)' },
              { value: 'Int64', label: 'Int64 (4 words)' }, { value: 'UInt64', label: 'UInt64 (4 words)' },
              { value: 'Boolean', label: 'Boolean (1 word)' },
              ...(protocol !== 'MODBUS_TCP' ? [{ value: 'String', label: 'String' }] : [])
            ]} />
          </div>
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Scan Rate (ms)</label>
            <input className="form-input text-mono" type="number" value={editDpScanIntervalMs}
              onChange={(e) => setEditDpScanIntervalMs(parseInt(e.target.value, 10) || 1000)} />
          </div>
        </div>

        {protocol === 'MODBUS_TCP' && (
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Byte Order / Endianness</label>
            <CustomSelect value={editDpByteOrder} onChange={setEditDpByteOrder} options={
              editDpDataType === 'Int16' || editDpDataType === 'UInt16' ? [
                { value: 'AB', label: 'AB (Default / No Swap)' }, { value: 'BA', label: 'BA (Swapped Bytes)' }
              ] : [
                { value: 'ABCD', label: 'ABCD (Default / No Swap)' }, { value: 'CDAB', label: 'CDAB (Word Swap)' },
                { value: 'BADC', label: 'BADC (Byte Swap)' }, { value: 'DCBA', label: 'DCBA (Byte & Word Swap)' }
              ]
            } />
          </div>
        )}

        {protocol === 'MQTT' && !editDpMqttDeviceId && (
          <>
            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Parse Mode</label>
              <CustomSelect value={editDpMqttParseMode} onChange={setEditDpMqttParseMode} options={[
                { value: 'Plaintext', label: 'Plaintext Value' }, { value: 'JSON', label: 'JSON Parser' }
              ]} />
            </div>
            {editDpMqttParseMode === 'JSON' && (
              <div className="form-group form-group-flush">
                <label className="form-label form-label-bold">JSON Path / Key</label>
                <input className="form-input text-mono" type="text" placeholder="e.g. $.sensors.temperature or temperature"
                  value={editDpMqttJsonPath} onChange={(e) => setEditDpMqttJsonPath(e.target.value)} required />
              </div>
            )}
          </>
        )}

        {(protocol === 'WEBHOOK' || protocol === 'REST_API') && (
          <>
            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Parse Mode</label>
              <CustomSelect value={editDpMqttParseMode} onChange={setEditDpMqttParseMode} options={[
                { value: 'JSON', label: 'JSON Parser' }
              ]} />
            </div>
            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">JSON Path / Key</label>
              <input className="form-input text-mono" type="text" placeholder="e.g. $.sensors.temperature or temperature"
                value={editDpAddress} onChange={(e) => { setEditDpAddress(e.target.value); setEditDpMqttJsonPath(e.target.value); }} required />
            </div>
          </>
        )}

        <div className="form-grid-2">
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Scale Factor</label>
            <input className="form-input text-mono" type="number" step="any" value={editDpScaleFactor}
              onChange={(e) => setEditDpScaleFactor(e.target.value)} />
          </div>
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Offset</label>
            <input className="form-input text-mono" type="number" step="any" value={editDpOffset}
              onChange={(e) => setEditDpOffset(e.target.value)} />
          </div>
        </div>

        <div className="checkbox-inline">
          <input type="checkbox" id="editDpIsEnabled" checked={editDpIsEnabled} onChange={(e) => setEditDpIsEnabled(e.target.checked)} />
          <label htmlFor="editDpIsEnabled">{protocol === 'MQTT' ? 'Enable Subscription' : 'Tag Polling Enabled'}</label>
        </div>

        <div className="modal-footer mt-sm">
          <button type="submit" className="btn-dark-primary">Save Changes</button>
          <button type="button" onClick={onClose} className="btn-secondary btn-flex-1">Cancel</button>
        </div>
      </form>
    </ModalShell>
  );
}
