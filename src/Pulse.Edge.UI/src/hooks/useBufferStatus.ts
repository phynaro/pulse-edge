import { useEffect } from 'react';
import { useEdge } from '../context/edge';

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
    setOeeOutbox,
    setIsConnected,
    setLiveFeed,
    isConnected
  } = useEdge();

  useEffect(() => {
    let active = true;
    const fetchBuffer = async () => {
      try {
        const [teleRes, oeeRes] = await Promise.all([
          fetch('/api/buffer/telemetry'),
          fetch('/api/oee/outbox')
        ]);
        if (!active) return;
        if (teleRes.ok && oeeRes.ok) {
          const teleData = await teleRes.json();
          const oeeData = await oeeRes.json();
          setBufferTelemetry(teleData);
          setOeeOutbox(oeeData);
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
  }, [intervalMs, setBufferTelemetry, setOeeOutbox, setIsConnected, setLiveFeed, isConnected]);
}
