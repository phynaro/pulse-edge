import React, { useState, useCallback } from 'react';
import { ConfirmContext } from './ConfirmContext';
import type { ConfirmOptions } from './ConfirmContext';
import ConfirmDialog from '../components/ConfirmDialog';

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions | null;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  });

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setDialogState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (dialogState.resolve) {
      dialogState.resolve(true);
    }
    setDialogState({ isOpen: false, options: null, resolve: null });
  }, [dialogState]);

  const handleCancel = useCallback(() => {
    if (dialogState.resolve) {
      dialogState.resolve(false);
    }
    setDialogState({ isOpen: false, options: null, resolve: null });
  }, [dialogState]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {dialogState.isOpen && dialogState.options && (
        <ConfirmDialog
          title={dialogState.options.title || 'Confirm Action'}
          message={dialogState.options.message}
          confirmText={dialogState.options.confirmText || 'Confirm'}
          cancelText={dialogState.options.cancelText || 'Cancel'}
          variant={dialogState.options.variant || 'primary'}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmContext.Provider>
  );
}
