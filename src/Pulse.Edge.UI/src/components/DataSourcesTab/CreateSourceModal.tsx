import { useState } from 'react';
import { Database } from 'lucide-react';
import type { DataSource, StreamTemplate } from '../../types';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';
import { DynamicIcon } from './utils';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface CreateSourceModalProps {
  onClose: () => void;
  datasources: DataSource[];
  templates: StreamTemplate[];
  fetchData: () => Promise<void>;
  toast: ToastFn;
}

function templateThemeClass(id: string): string {
  if (id === 'General') return 'theme-general';
  if (id === 'Production') return 'theme-production';
  if (id === 'Energy') return 'theme-energy';
  return 'theme-custom';
}

export default function CreateSourceModal({
  onClose,
  datasources,
  templates,
  fetchData,
  toast
}: CreateSourceModalProps) {
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceId, setNewSourceId] = useState(
    () => 'DS' + String(datasources.length + 1).padStart(3, '0')
  );
  const [newSourceType, setNewSourceType] = useState('General');
  const [newSourceDescription, setNewSourceDescription] = useState('');

  const handleAddDataSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName || !newSourceId) return;

    const trimmedId = newSourceId.trim();
    if (datasources.some(ds => ds.id.toLowerCase() === trimmedId.toLowerCase())) {
      toast.error(`Stream with ID '${trimmedId}' already exists.`);
      return;
    }

    try {
      const payload = {
        id: trimmedId,
        name: newSourceName,
        type: newSourceType,
        description: newSourceDescription
      };

      const res = await fetch('/api/datasources?create=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        toast.success(`Data Source '${newSourceName}' registered successfully.`);
        fetchData();
        onClose();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to create data source.');
      }
    } catch (err) {
      console.error('Failed to create data source:', err);
      toast.error('Failed to create data source.');
    }
  };

  return (
    <ModalShell
      title="Create Immutable Data Source"
      subtitle="Identify a new logical stream mapping on the Edge."
      onClose={onClose}
    >
      <form onSubmit={handleAddDataSource} className="modal-form">
        <div className="form-grid-2">
          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Data Source ID</label>
            <input
              className="form-input form-input-mono"
              type="text"
              placeholder="e.g. DS003"
              value={newSourceId}
              onChange={(e) => setNewSourceId(e.target.value)}
              required
            />
          </div>

          <div className="form-group form-group-flush">
            <label className="form-label form-label-bold">Data Source Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Conveyor Telemetry"
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group form-group-flush">
          <label className="form-label form-label-bold">Stream Category (Type)</label>
          <div className="form-grid-templates">
            <button
              type="button"
              onClick={() => setNewSourceType('General')}
              className={`template-picker-tile ${newSourceType === 'General' ? 'is-selected theme-general' : 'theme-general'}`}
            >
              <div className="template-picker-icon">
                <Database size={16} />
              </div>
              <div className="template-picker-label">General</div>
              <div className="template-picker-desc">Other Telemetry</div>
            </button>

            {templates.map(t => {
              const isSelected = newSourceType === t.id;
              const theme = templateThemeClass(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setNewSourceType(t.id)}
                  className={`template-picker-tile ${theme} ${isSelected ? 'is-selected' : ''}`}
                >
                  <div className="template-picker-icon">
                    <DynamicIcon name={t.icon} size={16} />
                  </div>
                  <div className="template-picker-label">{t.id}</div>
                  <div className="template-picker-desc">{t.description || 'Custom Template'}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-group form-group-flush">
          <label className="form-label form-label-bold">Description</label>
          <textarea
            className="form-input form-textarea"
            placeholder="Describe the location/system this stream reads from..."
            value={newSourceDescription}
            onChange={(e) => setNewSourceDescription(e.target.value)}
          />
        </div>

        <div className="modal-footer">
          <button type="submit" className="btn-primary btn-compact btn-flex-2">
            Create Stream
          </button>
          <button type="button" onClick={onClose} className="btn-secondary btn-compact btn-flex-1">
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
