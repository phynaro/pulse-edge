import { AlertTriangle } from 'lucide-react';
import type { DriverAdapter, DataPoint } from '../../types';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface DeleteAdapterModalProps {
  onClose: () => void;
  adapter: DriverAdapter;
  datapoints: DataPoint[];
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function DeleteAdapterModal({
  onClose,
  adapter,
  datapoints,
  toast,
  fetchData
}: DeleteAdapterModalProps) {
  if (!adapter) return null;

  const boundCount = datapoints.filter(dp => dp.adapterId === adapter.id).length;

  const handleDeleteAdapter = async (id: string) => {
    try {
      const res = await fetch(`/api/adapters/${id}`, { method: 'DELETE' });

      if (res.ok) {
        toast.success('Protocol adapter and bound metric tags deleted.');
        onClose();
        fetchData();
      } else {
        toast.error('Failed to delete protocol adapter.');
      }
    } catch (err) {
      console.error('Failed to delete adapter:', err);
      toast.error('Failed to delete adapter.');
    }
  };

  return (
    <ModalShell title="Delete Protocol Adapter?" onClose={onClose}>
      <div className="confirm-dialog-header">
        <div className="confirm-dialog-icon">
          <AlertTriangle size={20} />
        </div>
        <div>
          <p className="confirm-dialog-desc">
            Are you sure you want to delete the adapter <strong className="font-bold">{adapter.name}</strong> ({adapter.protocol})?
          </p>
        </div>
      </div>

      <div className="confirm-details">
        <div className="confirm-detail-row">
          <span className="text-secondary">Host Address:</span>
          <span className="font-bold text-mono">{adapter.host}:{adapter.port}</span>
        </div>
        <div className="confirm-detail-row">
          <span className="text-secondary">Bound Metrics Affected:</span>
          <span className="font-bold text-danger">
            {boundCount === 0 ? 'None' : `${boundCount} metric tag(s) will be unmapped`}
          </span>
        </div>
      </div>

      <div className="confirm-warning-box">
        <strong>Warning:</strong> Deleting this connection adapter will immediately stop ingestion for all bound metrics on this channel and permanently delete their mappings.
      </div>

      <div className="modal-footer">
        <button type="button" onClick={() => handleDeleteAdapter(adapter.id)} className="btn-danger-solid">
          Delete Adapter
        </button>
        <button type="button" onClick={onClose} className="btn-secondary btn-flex-1">
          Cancel
        </button>
      </div>
    </ModalShell>
  );
}
