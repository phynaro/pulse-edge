import { AlertTriangle } from 'lucide-react';
import type { DataPoint } from '../../types';
import ModalShell from '../ModalShell';

interface UnbindConfirmModalProps {
  deletingDp: DataPoint;
  onConfirm: (id: string) => Promise<void>;
  onCancel: () => void;
}

export default function UnbindConfirmModal({
  deletingDp,
  onConfirm,
  onCancel
}: UnbindConfirmModalProps) {
  return (
    <ModalShell title="Unbind Telemetry Metric?" onClose={onCancel}>
      <div className="confirm-dialog-header">
        <div className="confirm-dialog-icon">
          <AlertTriangle size={20} />
        </div>
        <div>
          <p className="confirm-dialog-desc">
            Are you sure you want to unbind the metric <strong className="font-bold">{deletingDp.metric}</strong>?
          </p>
        </div>
      </div>

      <div className="confirm-details">
        <div className="confirm-detail-row">
          <span className="text-secondary">Source Address:</span>
          <span className="font-bold text-mono">{deletingDp.address}</span>
        </div>
        <div className="confirm-detail-row">
          <span className="text-secondary">Data Type:</span>
          <span className="font-bold">{deletingDp.dataType} ({deletingDp.scanIntervalMs}ms)</span>
        </div>
      </div>

      <div className="confirm-warning-box">
        <strong>Warning:</strong> Telemetry ingestion and buffering for this physical address will stop immediately. This action cannot be undone.
      </div>

      <div className="modal-footer">
        <button type="button" onClick={() => onConfirm(deletingDp.id)} className="btn-danger-solid">
          Unbind Metric
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-flex-1">
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}
