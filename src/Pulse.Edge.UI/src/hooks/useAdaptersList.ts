import { useEffect } from 'react';
import { useEdge } from '../context/edge';

export function useAdaptersList(isVisible: boolean, intervalMs: number = 3000) {
  const { setAdapters, setIsConnected } = useEdge();

  useEffect(() => {
    if (!isVisible) return;

    let active = true;
    const fetchAdapters = async () => {
      try {
        const res = await fetch('/api/adapters');
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          setAdapters(data);
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Failed to poll adapters list:', err);
      }
    };

    void fetchAdapters();
    const interval = setInterval(fetchAdapters, intervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isVisible, intervalMs, setAdapters, setIsConnected]);
}
