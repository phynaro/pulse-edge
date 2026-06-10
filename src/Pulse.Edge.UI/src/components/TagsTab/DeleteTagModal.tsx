import { AlertTriangle } from 'lucide-react';
import type { DataPoint } from '../../types';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface DeleteTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  tag: DataPoint | null;
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function DeleteTagModal({ isOpen, onClose, tag, toast, fetchData }: DeleteTagModalProps) {
  const handleHardDeleteDataPoint = async () => {
    if (!tag) return;
    try {
      const res = await fetch(`/api/datapoints/hard/${tag.id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Physical tag deleted.'); onClose(); fetchData(); }
      else { toast.error('Failed to delete physical tag.'); }
    } catch (err) {
      console.error('Failed to delete physical tag:', err);
      toast.error('Failed to delete physical tag.');
    }
  };

  if (!isOpen || !tag) return null;

  return (
    <ModalShell title="Delete Physical Tag?" onClose={onClose}>
      <div className="confirm-dialog-header">
        <div className="confirm-dialog-icon">
          <AlertTriangle size={20} />
        </div>
        <div>
          <p className="confirm-dialog-desc">
            Are you sure you want to permanently delete tag <strong className="text-strong">{tag.address}</strong>?
          </p>
        </div>
      </div>

      {tag.dataSourceId && tag.dataSourceId !== '' && (
        <div className="confirm-warning-box mb-lg">
          <strong>Warning:</strong> This tag is currently bound to data stream <strong className="text-strong">{tag.dataSourceId}</strong>. Deleting this physical tag will immediately unbind it and stop telemetry.
        </div>
      )}

      <div className="modal-footer">
        <button onClick={handleHardDeleteDataPoint} className="btn-danger">Delete Tag</button>
        <button onClick={onClose} className="btn-secondary btn-flex-1">Cancel</button>
      </div>
    </ModalShell>
  );
}
