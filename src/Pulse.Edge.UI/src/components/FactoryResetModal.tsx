import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalShell from './ModalShell';

interface FactoryResetModalProps {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function FactoryResetModal({
  onConfirm,
  onCancel
}: FactoryResetModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText !== 'RESET') return;
    
    setIsResetting(true);
    try {
      await onConfirm();
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <ModalShell title="Factory Reset Device" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <div className="confirm-dialog-header">
          <div className="confirm-dialog-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error-color, #ef4444)' }}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="confirm-dialog-desc" style={{ fontSize: '13px' }}>
              You are about to reset this agent to factory defaults. This will permanently delete:
            </p>
          </div>
        </div>

        <div className="confirm-details" style={{ fontSize: '12px', padding: '12px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '6px', margin: '12px 0' }}>
          <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'disc' }}>
            <li>All device configurations and onboarding status</li>
            <li>All enqueued telemetry data and events in the SQLite buffer</li>
            <li>All configured driver adapters (Modbus, OPC UA, MQTT, Ethernet/IP)</li>
            <li>All data points, streams, and active tags</li>
          </ul>
        </div>

        <div className="confirm-warning-box" style={{ borderLeftColor: 'var(--error-color, #ef4444)' }}>
          <strong>Warning:</strong> This operation is destructive and cannot be undone. The agent will immediately restart the onboarding wizard.
        </div>

        <div className="form-group" style={{ marginTop: '16px' }}>
          <label className="form-label" style={{ fontSize: '12px', fontWeight: 'bold' }}>
            Please type <strong style={{ color: 'var(--error-color, #ef4444)' }}>RESET</strong> to confirm:
          </label>
          <input
            type="text"
            className="form-input"
            placeholder="Type RESET here"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={isResetting}
            autoFocus
            style={{ textTransform: 'uppercase' }}
          />
        </div>

        <div className="modal-footer" style={{ marginTop: '20px' }}>
          <button
            type="submit"
            className="btn-danger-solid"
            disabled={confirmText !== 'RESET' || isResetting}
            style={{ opacity: confirmText === 'RESET' && !isResetting ? 1 : 0.5 }}
          >
            {isResetting ? 'Resetting...' : 'Confirm Factory Reset'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary btn-flex-1" disabled={isResetting}>
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
