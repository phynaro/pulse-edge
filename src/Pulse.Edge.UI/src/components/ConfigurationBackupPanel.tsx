import { useRef, useState } from 'react';
import { ArchiveRestore, Download, FileCheck2, ShieldCheck, Upload } from 'lucide-react';
import { useConfirm } from '../hooks/useConfirm';

interface Inspection {
  isValid: boolean;
  errors: string[];
  createdAtUtc?: string;
  agentVersion: string;
  sourceSerialNumber: string;
  counts: {
    adapters: number;
    dataSources: number;
    dataPoints: number;
    mqttDevices: number;
    streamTemplates: number;
  };
}

interface Props {
  onRestoreComplete: () => Promise<void>;
}

export default function ConfigurationBackupPanel({ onRestoreComplete }: Props) {
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [message, setMessage] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const exportBackup = async () => {
    setIsBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/backups/configuration', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Your session has expired. Sign in again before exporting a backup.');
        if (response.status === 403) throw new Error('Only an administrator can export configuration backups.');
        throw new Error(`Backup export failed (HTTP ${response.status}).`);
      }

      const blob = await response.blob();
      if (blob.size === 0) throw new Error('The server returned an empty backup file.');
      const disposition = response.headers.get('Content-Disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      const downloadName = encodedName ? decodeURIComponent(encodedName) : plainName || 'pulse-edge-configuration.pulsebackup.json';
      const objectUrl = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.style.display = 'none';
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setMessage('Configuration backup created successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Backup export failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const inspectFile = async (file?: File) => {
    if (!file) return;
    setIsBusy(true);
    setMessage('');
    setInspection(null);
    try {
      const parsed = JSON.parse(await file.text());
      const response = await fetch('/api/restores/configuration/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed)
      });
      const result = await response.json();
      setDocument(parsed);
      setFileName(file.name);
      setInspection(result);
      if (!response.ok) setMessage(result.errors?.join(' ') || 'The backup could not be validated.');
    } catch {
      setDocument(null);
      setFileName(file.name);
      setMessage('This file is not a valid PULSE Edge configuration backup.');
    } finally {
      setIsBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const restore = async () => {
    if (!document || !inspection?.isValid) return;
    const accepted = await confirm({
      title: 'Replace local configuration?',
      message: `This will replace ${inspection.counts.adapters} adapters, ${inspection.counts.dataPoints} tags, and ${inspection.counts.dataSources} streams. Device identity, cloud pairing, users, and buffered telemetry will be preserved.`,
      confirmText: 'Replace Configuration',
      cancelText: 'Cancel',
      variant: 'warning'
    });
    if (!accepted) return;

    setIsBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/restores/configuration/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(document)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.join(' ') || result.error || 'Restore failed.');
      setMessage(result.message);
      setInspection(null);
      setDocument(null);
      setFileName('');
      await onRestoreComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Restore failed.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="panel configuration-vault">
      <div className="panel-header backup-panel-header">
        <div>
          <h2 className="panel-title">Configuration Vault</h2>
          <p className="backup-panel-kicker">Portable local configuration</p>
        </div>
        <ShieldCheck size={22} className="backup-shield" />
      </div>

      <p className="text-secondary backup-description">
        Export or replace adapters, tags, MQTT devices, streams, and templates. Device identity, cloud pairing, users, queues, and history stay on this node.
      </p>

      <div className="backup-actions">
        <button type="button" className="btn-secondary backup-action" onClick={exportBackup} disabled={isBusy}>
          <Download size={16} /> Export Backup
        </button>
        <button type="button" className="btn-secondary backup-action" onClick={() => fileInput.current?.click()} disabled={isBusy}>
          <Upload size={16} /> Inspect Backup
        </button>
        <input ref={fileInput} className="backup-file-input" type="file" accept=".json,.pulsebackup" onChange={(event) => inspectFile(event.target.files?.[0])} />
      </div>

      {isBusy && <div className="backup-status"><ArchiveRestore size={16} className="spin" /> Validating configuration…</div>}

      {inspection?.isValid && (
        <div className="backup-preview">
          <div className="backup-preview-title"><FileCheck2 size={17} /> Ready to restore <span>{fileName}</span></div>
          <div className="backup-count-grid">
            <span><strong>{inspection.counts.adapters}</strong> Adapters</span>
            <span><strong>{inspection.counts.dataPoints}</strong> Tags</span>
            <span><strong>{inspection.counts.dataSources}</strong> Streams</span>
            <span><strong>{inspection.counts.mqttDevices}</strong> MQTT Devices</span>
          </div>
          <div className="backup-meta">Source {inspection.sourceSerialNumber || 'unregistered'} · Agent {inspection.agentVersion}</div>
          <button type="button" className="btn-primary w-full" onClick={restore} disabled={isBusy}>Replace Local Configuration</button>
        </div>
      )}

      {message && <div className={`backup-status ${inspection?.isValid === false ? 'is-error' : ''}`}>{message}</div>}
      <small className="form-hint backup-secret-note">Backup files may contain protocol credentials from adapter configuration. Store them securely.</small>
    </div>
  );
}
