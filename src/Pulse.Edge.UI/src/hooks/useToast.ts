import { useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, default 4000
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = `toast-${++counterRef.current}-${Date.now()}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = {
    success: (msg: string, duration?: number) => addToast(msg, 'success', duration),
    error:   (msg: string, duration?: number) => addToast(msg, 'error',   duration ?? 6000),
    warning: (msg: string, duration?: number) => addToast(msg, 'warning', duration),
    info:    (msg: string, duration?: number) => addToast(msg, 'info',    duration),
  };

  return { toasts, removeToast, toast };
}
