import { useEffect } from 'react';
import { useEdge } from '../context/EdgeContext';

const formatToLocalTimeString = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  return new Date(utcStr).toLocaleTimeString();
};

export function useBufferStatus(intervalMs: number = 2000) {
  const { 
    setBufferTelemetry, 
    setBufferEvents, 
    setIsConnected, 
    setLiveFeed,
    isConnected
  } = useEdge();

  useEffect(() => {
    let active = true;
    const fetchBuffer = async () => {
      try {
        const [teleRes, eventRes] = await Promise.all([
          fetch('/api/buffer/telemetry'),
          fetch('/api/buffer/events')
        ]);
        if (!active) return;
        if (teleRes.ok && eventRes.ok) {
          const teleData = await teleRes.json();
          const eventData = await eventRes.json();
          setBufferTelemetry(teleData);
          setBufferEvents(eventData);
          setIsConnected(true);

          if (teleData.length > 0 && isConnected) {
            const latest = teleData[0];
            setLiveFeed(prev => {
              const formattedTime = formatToLocalTimeString(latest.timestamp);
              const isDuplicate = prev.some(x => x.time === formattedTime && x.payload === latest.metricsJson);
              if (isDuplicate) return prev;
              
              const newEntry = {
                time: formattedTime,
                source: latest.dataSourceId,
                payload: latest.metricsJson
              };
              return [newEntry, ...prev.slice(0, 99)];
            });
          }
        }
      } catch (err) {
        console.error('Failed to poll buffer status:', err);
      }
    };

    void fetchBuffer();
    const interval = setInterval(fetchBuffer, intervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [intervalMs, setBufferTelemetry, setBufferEvents, setIsConnected, setLiveFeed, isConnected]);
}
