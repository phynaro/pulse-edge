import { AlertTriangle } from 'lucide-react';
import type { DataPoint, DriverAdapter } from '../../types';
import type { useToast } from '../../hooks/useToast';
import ModalShell from '../ModalShell';

type ToastFn = ReturnType<typeof useToast>['toast'];

interface BulkDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTagIds: Record<string, boolean>;
  setSelectedTagIds: (ids: Record<string, boolean>) => void;
  filteredDatapoints: DataPoint[];
  adapters: DriverAdapter[];
  toast: ToastFn;
  fetchData: () => Promise<void>;
}

export default function BulkDeleteModal({
  isOpen, onClose, selectedTagIds, setSelectedTagIds,
  filteredDatapoints, adapters, toast, fetchData
}: BulkDeleteModalProps) {
  const selectedIds = Object.keys(selectedTagIds).filter(id => selectedTagIds[id]);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      const results = await Promise.all(selectedIds.map(id => fetch(`/api/datapoints/hard/${id}`, { method: 'DELETE' })));
      const successes = results.filter(r => r.ok).length;
      if (successes === selectedIds.length) toast.success(`Successfully deleted ${successes} physical tags.`);
      else toast.warning(`Deleted ${successes} of ${selectedIds.length} physical tags. Some failed.`);
      setSelectedTagIds({});
      onClose();
      fetchData();
    } catch (err) {
      console.error('Failed to perform bulk deletion:', err);
      toast.error('Error during bulk deletion.');
    }
  };

  if (!isOpen || selectedIds.length === 0) return null;

  const mappedCount = filteredDatapoints.filter(dp => selectedTagIds[dp.id] && dp.dataSourceId && dp.dataSourceId !== '').length;

  return (
    <ModalShell title="Delete Multiple Physical Tags?" onClose={onClose}>
      <div className="confirm-dialog-header">
        <div className="confirm-dialog-icon">
          <AlertTriangle size={20} />
        </div>
        <div>
          <p className="confirm-dialog-desc">
            Are you sure you want to permanently delete <strong className="text-strong">{selectedIds.length}</strong> selected physical tag(s)?
          </p>
        </div>
      </div>

      <div className="confirm-tag-list">
        {filteredDatapoints.filter(dp => selectedTagIds[dp.id]).map(dp => {
          const adp = adapters.find(a => a.id === dp.adapterId);
          return (
            <div key={dp.id} className="confirm-tag-item">
              <span className="confirm-tag-address">{dp.address}</span>
              <span className="confirm-tag-adapter">{adp ? `${adp.name} (${adp.protocol.replace('_', ' ')})` : 'Unassigned'}</span>
            </div>
          );
        })}
      </div>

      {mappedCount > 0 && (
        <div className="confirm-warning-box mb-lg">
          <strong>Warning:</strong> Some selected tags are currently bound to data streams. Deleting them will immediately unbind them and stop telemetry.
        </div>
      )}

      <div className="modal-footer">
        <button onClick={handleBulkDelete} className="btn-danger">Delete Selected Tags</button>
        <button onClick={onClose} className="btn-secondary btn-flex-1">Cancel</button>
      </div>
    </ModalShell>
  );
}
