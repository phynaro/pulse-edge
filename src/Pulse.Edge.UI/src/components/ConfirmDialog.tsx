import { AlertTriangle, HelpCircle } from 'lucide-react';
import ModalShell from './ModalShell';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  variant: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmText,
  cancelText,
  variant,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Decide icon based on variant
  const getIcon = () => {
    switch (variant) {
      case 'danger':
      case 'warning':
        return <AlertTriangle size={20} />;
      case 'primary':
      default:
        return <HelpCircle size={20} />;
    }
  };

  // Decide button class based on variant
  const getConfirmButtonClass = () => {
    switch (variant) {
      case 'danger':
        return 'btn-danger-solid';
      case 'warning':
        return 'btn-warning-solid'; // Use solid style if available, or fallback to primary/danger
      case 'primary':
      default:
        return 'btn-primary';
    }
  };

  return (
    <ModalShell title={title} onClose={onCancel}>
      <div className="confirm-dialog-header">
        <div
          className="confirm-dialog-icon"
          style={
            variant === 'danger' || variant === 'warning'
              ? { backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--error-color, #ef4444)' }
              : undefined
          }
        >
          {getIcon()}
        </div>
        <div>
          <p className="confirm-dialog-desc" style={{ whiteSpace: 'pre-wrap' }}>
            {message}
          </p>
        </div>
      </div>

      <div className="modal-footer">
        <button type="button" onClick={onConfirm} className={getConfirmButtonClass()}>
          {confirmText}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary btn-flex-1">
          {cancelText}
        </button>
      </div>
    </ModalShell>
  );
}
