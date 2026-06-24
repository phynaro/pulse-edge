import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import ModalShell from './ModalShell';

interface SoftResetModalProps {
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function SoftResetModal({
  onConfirm,
  onCancel
}: SoftResetModalProps) {
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
    <ModalShell title="Soft Reset Cloud Pairing" onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <div className="confirm-dialog-header">
          <div className="confirm-dialog-icon" style={{ backgroundColor: 'rgba(255, 179, 0, 0.1)', color: 'var(--warning-color, #ffb300)' }}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="confirm-dialog-desc" style={{ fontSize: '13px' }}>
              You are about to reset this agent's cloud registration. This will:
            </p>
          </div>
        </div>

        <div className="confirm-details" style={{ fontSize: '12px', padding: '12px', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '6px', margin: '12px 0' }}>
          <ul style={{ margin: 0, paddingLeft: '20px', listStyleType: 'disc' }}>
            <li style={{ color: '#ef4444', fontWeight: 'bold' }}>Clear current cloud pairing credentials (API Key)</li>
            <li style={{ color: '#ef4444', fontWeight: 'bold' }}>Dissociate from the current Organization and Site</li>
            <li style={{ color: '#ef4444', fontWeight: 'bold' }}>Generate a new Device ID & Claim Secret for re-onboarding</li>
            <li style={{ color: '#00a878', fontWeight: 'bold' }}>PRESERVE all configured driver adapters (Modbus, OPC UA, MQTT, etc.)</li>
            <li style={{ color: '#00a878', fontWeight: 'bold' }}>PRESERVE all configured data sources, metrics, and tag mappings</li>
          </ul>
        </div>

        <div className="confirm-warning-box" style={{ borderLeftColor: 'var(--warning-color, #ffb300)' }}>
          <strong>Info:</strong> This is a soft reset. Your hardware interfaces and metric configurations are safe. The agent will return to the onboarding screen to pair with a new organization.
        </div>

        <div className="form-group" style={{ marginTop: '16px' }}>
          <label className="form-label" style={{ fontSize: '12px', fontWeight: 'bold' }}>
            Please type <strong style={{ color: 'var(--warning-color, #ffb300)' }}>RESET</strong> to confirm:
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
            className="btn-primary"
            disabled={confirmText !== 'RESET' || isResetting}
            style={{ 
              opacity: confirmText === 'RESET' && !isResetting ? 1 : 0.5,
              backgroundColor: 'var(--warning-color, #ffb300)',
              borderColor: 'var(--warning-color, #ffb300)'
            }}
          >
            {isResetting ? 'Resetting...' : 'Confirm Soft Reset'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary btn-flex-1" disabled={isResetting}>
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
