import { Layers } from 'lucide-react';
import type { BufferTelemetryItem, BufferEventItem } from '../types';

const formatToLocalTime = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  return new Date(utcStr).toLocaleString();
};

/** Parse MetricsJson dict into sorted [name, value] pairs */
function parseMetrics(metricsJson: string): [string, number][] {
  try {
    const obj = JSON.parse(metricsJson) as Record<string, number>;
    return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** Format a number compactly: up to 4 significant digits */
function fmtVal(v: number): string {
  if (Math.abs(v) >= 1000) return v.toFixed(1);
  if (Math.abs(v) >= 100) return v.toFixed(2);
  return v.toFixed(3);
}

interface BufferTabProps {
  bufferTelemetry: BufferTelemetryItem[];
  bufferEvents: BufferEventItem[];
}

export default function BufferTab({ bufferTelemetry, bufferEvents }: BufferTabProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Layers size={24} style={{ color: 'var(--primary-color)' }} />
            SQLite Queue Buffer Explorer
          </h2>
          <p className="page-header-desc">
            Inspect the store-and-forward SQLite database queues for pending telemetry frames and system state events.
          </p>
        </div>
      </div>

      {/* ── Telemetry Queue ────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <h2 className="panel-title">Pending Telemetry Queue — <code>QueueTelemetry</code></h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Each row = one stream snapshot (all metrics merged by poll tick)
            </span>
          </div>
          <span className="badge info">{bufferTelemetry.length} frame{bufferTelemetry.length !== 1 ? 's' : ''}</span>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '420px' }}>
          {bufferTelemetry.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              Queue is empty — sync is draining to cloud.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>ID</th>
                  <th style={{ width: '90px' }}>Stream</th>
                  <th style={{ width: '150px' }}>Buffered At</th>
                  <th>Metrics</th>
                  <th style={{ width: '60px' }}>Retries</th>
                  <th style={{ width: '90px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {bufferTelemetry.map((item) => {
                  const metrics = parseMetrics(item.metricsJson);
                  return (
                    <tr key={item.id}>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        #{item.id}
                      </td>
                      <td>
                        <span style={{
                          fontWeight: 600,
                          fontSize: '12px',
                          background: 'var(--accent-subtle, rgba(99,102,241,0.15))',
                          color: 'var(--accent, #6366f1)',
                          borderRadius: '4px',
                          padding: '2px 7px',
                        }}>
                          {item.dataSourceId}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {formatToLocalTime(item.timestamp)}
                      </td>
                      <td>
                        {metrics.length === 0 ? (
                          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '12px' }}>
                            {item.metricsJson}
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '2px 0' }}>
                            {metrics.map(([name, val]) => (
                              <span
                                key={name}
                                title={`${name} = ${val}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontSize: '11px',
                                  borderRadius: '5px',
                                  padding: '2px 8px',
                                  background: 'var(--surface-secondary, rgba(255,255,255,0.05))',
                                  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
                                  fontFamily: 'var(--font-mono)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <span style={{ color: 'var(--text-secondary)' }}>{name}</span>
                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                  {fmtVal(val)}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {item.retryCount > 0 ? (
                          <span className="badge warning">{item.retryCount}</span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${item.isSending ? 'warning' : 'info'}`}>
                          {item.isSending ? '⬆ Syncing' : '⏸ Buffered'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Events Queue ──────────────────────────────────────────────────── */}
      <div className="panel">
        <div className="panel-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <h2 className="panel-title">Pending Events Queue — <code>QueueEvents</code></h2>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              Alarms, machine state changes, and operational events
            </span>
          </div>
          <span className="badge info">{bufferEvents.length} event{bufferEvents.length !== 1 ? 's' : ''}</span>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: '350px' }}>
          {bufferEvents.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              No pending events.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '50px' }}>ID</th>
                  <th style={{ width: '120px' }}>Event Type</th>
                  <th>Payload</th>
                  <th style={{ width: '150px' }}>Buffered At</th>
                  <th style={{ width: '60px' }}>Retries</th>
                  <th style={{ width: '90px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {bufferEvents.map((item) => (
                  <tr key={item.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      #{item.id}
                    </td>
                    <td>
                      <span style={{
                        fontWeight: 600,
                        fontSize: '12px',
                        background: 'var(--warning-subtle, rgba(245,158,11,0.15))',
                        color: 'var(--warning, #f59e0b)',
                        borderRadius: '4px',
                        padding: '2px 7px',
                      }}>
                        {item.eventType}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--code-color)' }}>
                      {item.payloadJson}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {formatToLocalTime(item.timestamp)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {item.retryCount > 0 ? (
                        <span className="badge warning">{item.retryCount}</span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${item.isSending ? 'warning' : 'info'}`}>
                        {item.isSending ? '⬆ Syncing' : '⏸ Buffered'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
