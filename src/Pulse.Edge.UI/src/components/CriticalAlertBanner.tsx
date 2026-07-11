import { useEffect, useState } from 'react';
import { ArrowRight, OctagonAlert } from 'lucide-react';

type CriticalIncident = { id: number; timestampUtc: string; message: string; category: string };

export default function CriticalAlertBanner({ onOpenLogs }: { onOpenLogs: () => void }) {
  const [incidents, setIncidents] = useState<CriticalIncident[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/diagnostic-logs/history?level=Critical&pageSize=20');
        if (response.ok && active) setIncidents((await response.json()).items);
      } catch { /* the standard connection indicator handles API outages */ }
    };
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  if (incidents.length === 0) return null;
  const latest = incidents[0];
  return <div className="critical-alert-banner" role="alert">
    <div className="critical-alert-sigil"><OctagonAlert size={19} /></div>
    <div className="critical-alert-copy">
      <div><strong>CRITICAL EDGE INCIDENT</strong><span>{incidents.length} active record{incidents.length === 1 ? '' : 's'}</span></div>
      <p>{latest.message}</p>
    </div>
    <time>{new Date(latest.timestampUtc).toLocaleString()}</time>
    <button onClick={onOpenLogs}>Inspect logs <ArrowRight size={14} /></button>
  </div>;
}
