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

function parseMetrics(metricsJson: string): [string, number][] {
  try {
    const obj = JSON.parse(metricsJson) as Record<string, number>;
    return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  } catch {
    return [];
  }
}

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
    <div className="tab-stack">
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Layers size={24} className="page-header-icon" />
            SQLite Queue Buffer Explorer
          </h2>
          <p className="page-header-desc">
            Inspect the store-and-forward SQLite database queues for pending telemetry frames and system state events.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-col">
            <h2 className="panel-title">Pending Telemetry Queue — <code>QueueTelemetry</code></h2>
            <span className="panel-subtitle">
              Each row = one stream snapshot (all metrics merged by poll tick)
            </span>
          </div>
          <span className="badge info">{bufferTelemetry.length} frame{bufferTelemetry.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="table-scroll-md">
          {bufferTelemetry.length === 0 ? (
            <div className="table-empty">Queue is empty — sync is draining to cloud.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-id">ID</th>
                  <th className="col-stream">Stream</th>
                  <th className="col-time">Buffered At</th>
                  <th>Metrics</th>
                  <th className="col-retries">Retries</th>
                  <th className="col-status">Status</th>
                </tr>
              </thead>
              <tbody>
                {bufferTelemetry.map((item) => {
                  const metrics = parseMetrics(item.metricsJson);
                  return (
                    <tr key={item.id}>
                      <td className="cell-mono-secondary">#{item.id}</td>
                      <td><span className="stream-badge">{item.dataSourceId}</span></td>
                      <td className="cell-mono-nowrap">{formatToLocalTime(item.timestamp)}</td>
                      <td>
                        {metrics.length === 0 ? (
                          <span className="metric-empty">{item.metricsJson}</span>
                        ) : (
                          <div className="metric-chip-list">
                            {metrics.map(([name, val]) => (
                              <span key={name} title={`${name} = ${val}`} className="metric-chip">
                                <span className="metric-chip-name">{name}</span>
                                <span className="metric-chip-value">{fmtVal(val)}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="cell-center">
                        {item.retryCount > 0 ? (
                          <span className="badge warning">{item.retryCount}</span>
                        ) : (
                          <span className="text-secondary">—</span>
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

      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-col">
            <h2 className="panel-title">Pending Events Queue — <code>QueueEvents</code></h2>
            <span className="panel-subtitle">
              Alarms, machine state changes, and operational events
            </span>
          </div>
          <span className="badge info">{bufferEvents.length} event{bufferEvents.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="table-scroll-sm">
          {bufferEvents.length === 0 ? (
            <div className="table-empty">No pending events.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-id">ID</th>
                  <th className="col-event">Event Type</th>
                  <th>Payload</th>
                  <th className="col-time">Buffered At</th>
                  <th className="col-retries">Retries</th>
                  <th className="col-status">Status</th>
                </tr>
              </thead>
              <tbody>
                {bufferEvents.map((item) => (
                  <tr key={item.id}>
                    <td className="cell-mono-secondary">#{item.id}</td>
                    <td><span className="event-badge">{item.eventType}</span></td>
                    <td className="cell-mono-code">{item.payloadJson}</td>
                    <td className="cell-mono-nowrap">{formatToLocalTime(item.timestamp)}</td>
                    <td className="cell-center">
                      {item.retryCount > 0 ? (
                        <span className="badge warning">{item.retryCount}</span>
                      ) : (
                        <span className="text-secondary">—</span>
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
