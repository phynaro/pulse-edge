import type { ReactNode } from 'react';

interface ModalShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'default' | 'wide' | 'tall' | 'md' | 'lg' | 'xl' | 'browser';
  bodyClassName?: string;
  showClose?: boolean;
}

export default function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  size = 'default',
  bodyClassName = '',
  showClose = true,
}: ModalShellProps) {
  const sizeClass =
    size === 'wide' ? 'modal-dialog-wide'
    : size === 'tall' ? 'modal-dialog-tall'
    : size === 'md' ? 'modal-dialog-md'
    : size === 'lg' ? 'modal-dialog-lg'
    : size === 'xl' ? 'modal-dialog-xl'
    : size === 'browser' ? 'modal-dialog-browser'
    : '';

  return (
    <div className="modal-overlay">
      <div
        className={`panel modal-dialog ${sizeClass}`.trim()}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{title}</h3>
            {subtitle && <span className="modal-subtitle">{subtitle}</span>}
          </div>
          {showClose && (
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              &times;
            </button>
          )}
        </div>
        {bodyClassName ? <div className={bodyClassName}>{children}</div> : children}
      </div>
    </div>
  );
}
