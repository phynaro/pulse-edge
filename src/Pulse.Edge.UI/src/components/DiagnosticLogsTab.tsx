import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CirclePause, CirclePlay, Radio, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type LogLevel = 'Information' | 'Warning' | 'Error' | 'Critical';
type LogEntry = { sequence: number; timestampUtc: string; level: LogLevel; category: string; eventCode: string; message: string; details: string; adapterId: string; dataPointId: string; correlationId: string };
type HistoryEntry = Omit<LogEntry, 'sequence'> & { id: number };

export default function DiagnosticLogsTab() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'All' | LogLevel>('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [connected, setConnected] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/diagnostic-logs/recent?limit=500').then(r => r.ok ? r.json() as Promise<LogEntry[]> : []),
      fetch('/api/diagnostic-logs/history?pageSize=250').then(r => r.ok ? r.json() as Promise<{ items: HistoryEntry[] }> : { items: [] })
    ]).then(([recent, history]) => {
      const memoryKeys = new Set(recent.map(x => `${x.timestampUtc}|${x.level}|${x.message}`));
      const retained = history.items.filter(x => !memoryKeys.has(`${x.timestampUtc}|${x.level}|${x.message}`)).map(x => ({ ...x, sequence: -x.id }));
      setEntries([...recent, ...retained].sort((a, b) => Date.parse(b.timestampUtc) - Date.parse(a.timestampUtc)).slice(0, 1000));
    }).catch(() => undefined);
  }, []);

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

  return <div className="diagnostic-logs-page">
    <div className="page-header logs-page-header">
      <div className="page-header-info">
        <h2 className="page-header-title"><Radio size={23} className="page-header-icon" /> Diagnostic Logs</h2>
        <p className="page-header-desc">Live edge-agent activity and retained operational incidents.</p>
      </div>
      <div className={`logs-connection ${connected ? 'is-live' : ''}`}><span />{connected ? 'LIVE STREAM' : 'RECONNECTING'}</div>
    </div>

    <div className="logs-severity-grid">
      <div><span className="logs-severity-dot info" /><small>INFORMATION</small><strong>{count('Information')}</strong></div>
      <div><span className="logs-severity-dot warning" /><small>WARNING</small><strong>{count('Warning')}</strong></div>
      <div><span className="logs-severity-dot error" /><small>ERROR</small><strong>{count('Error')}</strong></div>
      <div><span className="logs-severity-dot critical" /><small>CRITICAL</small><strong>{count('Critical')}</strong></div>
    </div>

    <div className="panel logs-console">
      <div className="logs-toolbar">
        <div className="logs-search"><Search size={14} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search message, source, or details…" /></div>
        <select value={level} onChange={e => setLevel(e.target.value as 'All' | LogLevel)}><option>All</option><option>Information</option><option>Warning</option><option>Error</option><option>Critical</option></select>
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
      <div className="logs-footer"><span>Showing {filtered.length} of {entries.length} buffered records</span><span>Warnings and errors retained for 30 days · maximum 10,000</span></div>
    </div>
  </div>;
}

function shortCategory(value: string) { const pieces = value.split('.'); return pieces[pieces.length - 1] || 'System'; }
