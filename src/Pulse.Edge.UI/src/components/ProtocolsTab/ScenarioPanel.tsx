import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ScenarioCatalogEntry {
  id: string;
  name: string;
  units: { id: string; kind: string; signals: string[] }[];
  events: { id: string; unit: string; durationMinutes: number }[];
}

interface ScenarioStatus {
  units: { id: string; kind: string; mode: string; value: number | null }[];
  activeEvents: { id: string; untilUtc: string }[];
}

const MODE_COLORS: Record<string, string> = {
  Running: '#10b981',
  Idle: '#f59e0b',
  Fault: '#ef4444',
  PlannedStop: '#94a3b8',
  Event: '#8b5cf6',
};

const KIND_ORDER = ['machine', 'meter', 'analog', 'ambient'];
const POLL_MS = 5000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** ISO time `minutes` from now (module scope: reading the clock is not render work). */
function untilFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isFuture(iso: string): boolean {
  return Date.parse(iso) > Date.now();
}

interface ScenarioPanelProps {
  scenarioId: string;
  /** Admins may trigger events; everyone else sees the unit list read-only. */
  canTrigger: boolean;
}

export default function ScenarioPanel({ scenarioId, canTrigger }: ScenarioPanelProps) {
  const { t } = useTranslation();
  const base = `/api/simulator/scenarios/${encodeURIComponent(scenarioId)}`;
  const [catalog, setCatalog] = useState<ScenarioCatalogEntry | null>(null);
  const [status, setStatus] = useState<ScenarioStatus | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  // Optimistic "active until" after a 202: the engine drains the request on its next tick, so the status
  // fetched right after the POST may not list the event yet. The server value replaces it once reported.
  const [localUntil, setLocalUntil] = useState<Record<string, string>>({});

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${base}/status`);
      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBlocked(body.error || t('scenario.statusFailed'));
        return;
      }
      if (!res.ok) {
        setError(t('scenario.statusFailed'));
        return;
      }
      setBlocked(null);
      setError(null);
      const next = (await res.json()) as ScenarioStatus;
      setStatus(next);
      const reported = new Set(next.activeEvents.map(e => e.id));
      setLocalUntil(prev => {
        const kept = Object.entries(prev).filter(([id, until]) => !reported.has(id) && isFuture(until));
        return kept.length === Object.keys(prev).length ? prev : Object.fromEntries(kept);
      });
    } catch {
      setError(t('scenario.statusFailed'));
    }
  }, [base, t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/simulator/scenarios');
        if (!res.ok) return;
        const all = (await res.json()) as ScenarioCatalogEntry[];
        if (!cancelled) setCatalog(all.find(s => s.id === scenarioId) ?? null);
      } catch {
        // The status poll surfaces connectivity problems.
      }
    })();
    return () => { cancelled = true; };
  }, [scenarioId]);

  useEffect(() => {
    const first = setTimeout(() => { void loadStatus(); }, 0);
    const timer = setInterval(() => { void loadStatus(); }, POLL_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [loadStatus]);

  const trigger = async (eventId: string) => {
    setBusyEvent(eventId);
    try {
      const res = await fetch(`${base}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        setError(t('scenario.triggerFailed'));
      } else {
        setError(null);
        const minutes = catalog?.events.find(e => e.id === eventId)?.durationMinutes;
        if (minutes !== undefined) {
          const until = untilFromNow(minutes);
          setLocalUntil(prev => ({ ...prev, [eventId]: until }));
        }
      }
      await loadStatus();
    } catch {
      setError(t('scenario.triggerFailed'));
    } finally {
      setBusyEvent(null);
    }
  };

  if (blocked) {
    return <div className="scenario-panel scenario-panel-blocked" role="status">{blocked}</div>;
  }

  const activeUntil = new Map<string, string>(Object.entries(localUntil));
  for (const e of status?.activeEvents ?? []) activeUntil.set(e.id, e.untilUtc);
  const statusUnits = status?.units ?? [];
  const kinds = KIND_ORDER.filter(k => statusUnits.some(u => u.kind === k));

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-title">{t('scenario.title')}</div>
      {error && <div className="scenario-panel-error" role="alert">{error}</div>}

      {canTrigger && catalog && catalog.events.length > 0 && (
        <div className="scenario-section">
          <div className="scenario-section-label">{t('scenario.triggerEvents')}</div>
          <div className="scenario-events">
            {catalog.events.map(ev => {
              const until = activeUntil.get(ev.id);
              return (
                <div key={ev.id} className="scenario-event">
                  <button
                    type="button"
                    className="btn-secondary scenario-event-btn"
                    disabled={busyEvent === ev.id || !!until}
                    onClick={() => void trigger(ev.id)}
                  >
                    <strong>{ev.id}</strong>
                    <span className="scenario-event-meta">{ev.unit} · {t('scenario.minutes', { count: ev.durationMinutes })}</span>
                  </button>
                  {until && <span className="scenario-event-active">{t('scenario.activeUntil', { time: formatTime(until) })}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="scenario-section">
        <div className="scenario-section-label">{t('scenario.units')}</div>
        {status && statusUnits.length === 0 && <div className="scenario-empty">{t('scenario.noUnits')}</div>}
        {kinds.map(kind => (
          <div key={kind} className="scenario-kind">
            <div className="scenario-kind-label">{t(`scenario.kind.${kind}`)}</div>
            <ul className="scenario-units">
              {statusUnits.filter(u => u.kind === kind).map(u => (
                <li key={u.id} className="scenario-unit">
                  <span className="scenario-unit-dot" style={{ backgroundColor: MODE_COLORS[u.mode] ?? '#94a3b8' }} />
                  <span className="scenario-unit-id">{u.id}</span>
                  <span className="scenario-unit-mode" style={{ color: MODE_COLORS[u.mode] ?? 'inherit' }}>
                    {t(`scenario.mode.${u.mode}`, { defaultValue: u.mode })}
                  </span>
                  {u.value !== null && <span className="scenario-unit-value">{Number(u.value.toFixed(2))}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
