import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bug, CirclePause, CirclePlay, Clock3, Database, Radio, Search, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { useAuth } from '../context/auth';

type LogLevel = 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical';
type LogEntry = { sequence: number; timestampUtc: string; level: LogLevel; category: string; eventCode: string; message: string; details: string; adapterId: string; dataPointId: string; correlationId: string };
type HistoryEntry = Omit<LogEntry, 'sequence'> & { id: number };
type AdapterOption = { id: string; name: string; protocol: string };
type CaptureStatus = { isActive: boolean; adapterId: string; adapterName: string; startedAtUtc: string | null; expiresAtUtc: string | null; remainingSeconds: number; entryCount: number; hasRotated: boolean };

export default function DiagnosticLogsTab() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'All' | LogLevel>('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [capture, setCapture] = useState<CaptureStatus | null>(null);
  const [adapters, setAdapters] = useState<AdapterOption[]>([]);
  const [captureAdapter, setCaptureAdapter] = useState('');
  const [captureDuration, setCaptureDuration] = useState(15);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [clock, setClock] = useState(() => Date.now());

  const refreshCapture = useCallback(async () => {
    const response = await fetch('/api/diagnostic-logs/debug-capture');
    if (response.ok) setCapture(await response.json() as CaptureStatus);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/diagnostic-logs/recent?limit=500').then(r => r.ok ? r.json() as Promise<LogEntry[]> : []),
      fetch('/api/diagnostic-logs/history?pageSize=250').then(r => r.ok ? r.json() as Promise<{ items: HistoryEntry[] }> : { items: [] }),
      fetch('/api/adapters').then(r => r.ok ? r.json() as Promise<AdapterOption[]> : []),
      fetch('/api/diagnostic-logs/debug-capture').then(r => r.ok ? r.json() as Promise<CaptureStatus> : null)
    ]).then(([recent, history, adapterList, captureStatus]) => {
      const memoryKeys = new Set(recent.map(x => `${x.timestampUtc}|${x.level}|${x.message}`));
      const retained = history.items.filter(x => !memoryKeys.has(`${x.timestampUtc}|${x.level}|${x.message}`)).map(x => ({ ...x, sequence: -x.id }));
      setEntries([...recent, ...retained].sort((a, b) => Date.parse(b.timestampUtc) - Date.parse(a.timestampUtc)).slice(0, 1000));
      setAdapters(adapterList);
      setCapture(captureStatus);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => { setClock(Date.now()); void refreshCapture(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshCapture]);

  useEffect(() => {
    const source = new EventSource('/api/diagnostic-logs/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = event => {
      if (!live) return;
      const item = JSON.parse(event.data) as LogEntry;
      setEntries(current => [item, ...current.filter(x => x.sequence !== item.sequence)].slice(0, 1000));
    };
    return () => source.close();
  }, [live]);

  const categories = useMemo(() => ['All', ...Array.from(new Set(entries.map(x => x.category).filter(Boolean))).sort()], [entries]);
  const filtered = useMemo(() => entries.filter(item =>
    (level === 'All' || item.level === level) &&
    (category === 'All' || item.category === category) &&
    (!search || `${item.message} ${item.details} ${item.category}`.toLowerCase().includes(search.toLowerCase()))
  ), [entries, level, category, search]);
  const count = (target: LogLevel) => entries.filter(x => x.level === target).length;
  const remainingSeconds = capture?.isActive && capture.expiresAtUtc ? Math.max(0, Math.ceil((Date.parse(capture.expiresAtUtc) - clock) / 1000)) : 0;

  const startCapture = async () => {
    setCaptureBusy(true); setCaptureError('');
    try {
      const response = await fetch('/api/diagnostic-logs/debug-capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ durationMinutes: captureDuration, adapterId: captureAdapter }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { message?: string }; throw new Error(body.message || 'Unable to start Debug Capture.'); }
      await refreshCapture();
    } catch (error) { setCaptureError(error instanceof Error ? error.message : 'Unable to start Debug Capture.'); }
    finally { setCaptureBusy(false); }
  };

  const stopCapture = async () => {
    setCaptureBusy(true); setCaptureError('');
    try { const response = await fetch('/api/diagnostic-logs/debug-capture', { method: 'DELETE' }); if (!response.ok) throw new Error('Unable to stop Debug Capture.'); await refreshCapture(); }
    catch (error) { setCaptureError(error instanceof Error ? error.message : 'Unable to stop Debug Capture.'); }
    finally { setCaptureBusy(false); }
  };

  return <div className="diagnostic-logs-page">
    <div className="page-header logs-page-header">
      <div className="page-header-info">
        <h2 className="page-header-title"><Radio size={23} className="page-header-icon" /> Diagnostic Logs</h2>
        <p className="page-header-desc">Live edge-agent activity and retained operational incidents.</p>
      </div>
      <div className={`logs-connection ${connected ? 'is-live' : ''}`}><span />{connected ? 'LIVE STREAM' : 'RECONNECTING'}</div>
    </div>

    <section className={`debug-capture-panel ${capture?.isActive ? 'is-active' : ''}`} aria-label="Debug capture controls">
      <div className="debug-capture-mark"><Bug size={19} /></div>
      <div className="debug-capture-copy">
        <div><strong>DEBUG CAPTURE</strong><span>{capture?.isActive ? 'RECORDING' : 'STANDBY'}</span></div>
        {capture?.isActive ? <p>Capturing every driver poll for <b>{capture.adapterName || 'all adapters'}</b>. Automatically retained for 24 hours.</p> : <p>Temporarily record verbose driver activity for focused field troubleshooting.</p>}
      </div>
      {capture?.isActive ? <>
        <div className="debug-capture-stat"><Clock3 size={14} /><span>TIME LEFT</span><strong>{formatRemaining(remainingSeconds)}</strong></div>
        <div className="debug-capture-stat"><Database size={14} /><span>ENTRIES</span><strong>{capture.entryCount.toLocaleString()}</strong></div>
        {user?.role === 'Admin' && <button className="debug-stop" disabled={captureBusy} onClick={() => void stopCapture()}><Square size={12} fill="currentColor" /> Stop</button>}
      </> : user?.role === 'Admin' ? <div className="debug-capture-form">
        <select aria-label="Debug capture adapter" value={captureAdapter} onChange={e => setCaptureAdapter(e.target.value)}><option value="">All adapters</option>{adapters.map(adapter => <option value={adapter.id} key={adapter.id}>{adapter.name} · {adapter.protocol}</option>)}</select>
        <select aria-label="Debug capture duration" value={captureDuration} onChange={e => setCaptureDuration(Number(e.target.value))}><option value={5}>5 minutes</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option></select>
        <button disabled={captureBusy} onClick={() => void startCapture()}><CirclePlay size={14} /> Start capture</button>
      </div> : <span className="debug-readonly">Admin access required to start capture</span>}
      {capture?.hasRotated && <div className="debug-rotation"><AlertTriangle size={12} /> 5,000-entry cap reached; oldest Debug entries are rotating.</div>}
      {captureError && <div className="debug-capture-error">{captureError}</div>}
    </section>

    <div className="logs-severity-grid">
      <div><span className="logs-severity-dot debug" /><small>DEBUG</small><strong>{count('Debug')}</strong></div>
      <div><span className="logs-severity-dot info" /><small>INFORMATION</small><strong>{count('Information')}</strong></div>
      <div><span className="logs-severity-dot warning" /><small>WARNING</small><strong>{count('Warning')}</strong></div>
      <div><span className="logs-severity-dot error" /><small>ERROR</small><strong>{count('Error')}</strong></div>
      <div><span className="logs-severity-dot critical" /><small>CRITICAL</small><strong>{count('Critical')}</strong></div>
    </div>

    <div className="panel logs-console">
      <div className="logs-toolbar">
        <div className="logs-search"><Search size={14} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search message, source, or details…" /></div>
        <select value={level} onChange={e => setLevel(e.target.value as 'All' | LogLevel)}><option>All</option><option>Debug</option><option>Information</option><option>Warning</option><option>Error</option><option>Critical</option></select>
        <select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(x => <option key={x}>{x}</option>)}</select>
        <button className={`logs-live-toggle ${live ? 'active' : ''}`} onClick={() => setLive(x => !x)}>{live ? <CirclePause size={14} /> : <CirclePlay size={14} />}{live ? 'Pause' : 'Resume'}</button>
        {user?.role === 'Admin' && <button className="logs-clear" title="Delete diagnostic history" onClick={async () => { if (!window.confirm('Clear all diagnostic log history?')) return; const res = await fetch('/api/diagnostic-logs', { method: 'DELETE' }); if (res.ok) setEntries([]); }}><Trash2 size={14} /> Clear</button>}
      </div>

      <div className="logs-table-header"><span>TIME</span><span>LEVEL</span><span>SOURCE</span><span>MESSAGE</span></div>
      <div className="logs-table" role="log" aria-live={live ? 'polite' : 'off'}>
        {filtered.length === 0 ? <div className="logs-empty"><ShieldAlert size={25} /><strong>No matching diagnostics</strong><span>New edge activity will appear here automatically.</span></div> : filtered.map(item => <div className={`log-entry level-${item.level.toLowerCase()}`} key={`${item.timestampUtc}-${item.sequence}`}>
          <button className="log-entry-main" onClick={() => setExpanded(expanded === item.sequence ? null : item.sequence)}>
            <time>{new Date(item.timestampUtc).toLocaleTimeString([], { hour12: false })}</time>
            <span className="log-level"><i />{item.level}</span>
            <span className="log-category" title={item.category}>{shortCategory(item.category)}</span>
            <span className="log-message">{item.message}</span>
          </button>
          {expanded === item.sequence && <div className="log-details">
            <div><b>UTC</b><code>{new Date(item.timestampUtc).toISOString()}</code></div>
            {item.correlationId && <div><b>Correlation</b><code>{item.correlationId}</code></div>}
            {item.adapterId && <div><b>Adapter</b><code>{item.adapterId}</code></div>}
            {item.dataPointId && <div><b>Data point</b><code>{item.dataPointId}</code></div>}
            {item.details ? <pre><AlertTriangle size={14} />{item.details}</pre> : <span className="log-no-details">No exception details recorded.</span>}
          </div>}
        </div>)}
      </div>
      <div className="logs-footer"><span>Showing {filtered.length} of {entries.length} buffered records</span><span>Debug retained 24h / 5,000 · incidents retained 30d / 10,000</span></div>
    </div>
  </div>;
}

function shortCategory(value: string) { const pieces = value.split('.'); return pieces[pieces.length - 1] || 'System'; }
function formatRemaining(totalSeconds: number) { const minutes = Math.floor(totalSeconds / 60); const seconds = totalSeconds % 60; return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`; }
