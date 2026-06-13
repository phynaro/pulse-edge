import { useEffect } from 'react';
import { useEdge } from '../context/EdgeContext';

export function useDatapointsList(isVisible: boolean, intervalMs: number = 3000) {
  const { setDatapoints, setIsConnected } = useEdge();

  useEffect(() => {
    if (!isVisible) return;

    let active = true;
    const fetchDatapoints = async () => {
      try {
        const res = await fetch('/api/datapoints');
        if (!active) return;
        if (res.ok) {
          const data = await res.json();
          setDatapoints(data);
          setIsConnected(true);
        }
      } catch (err) {
        console.error('Failed to poll datapoints list:', err);
      }
    };

    void fetchDatapoints();
    const interval = setInterval(fetchDatapoints, intervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isVisible, intervalMs, setDatapoints, setIsConnected]);
}
