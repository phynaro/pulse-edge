import { useState } from 'react';
import { Cpu, Play, Pause, Activity, HardDrive, Clock } from 'lucide-react';
import CustomSelect from './CustomSelect';
import OperationalOverview from './Dashboard/OperationalOverview';
import DashboardDetailModal, { type DashboardDrilldown } from './Dashboard/DashboardDetailModal';
import type {
  DiagnosticData,
  BufferTelemetryItem,
  OeeOutboxItem,
  DriverAdapter,
  DataPoint,
  DataSource
} from '../types';

interface DashboardTabProps {
  isSyncEnabled: boolean;
  handleToggleSync: () => void;
  bufferTelemetry: BufferTelemetryItem[];
  telemetryWarningThreshold: number;
  oeeOutbox: OeeOutboxItem[];
  eventWarningThreshold: number;
  diagnostics: DiagnosticData | null;
  adapters: DriverAdapter[];
  datapoints: DataPoint[];
  datasources: DataSource[];
  isConnected: boolean;
  operationalRefreshedAt: Date | null;
  operationalDataStale: boolean;
  showDiagnosticsPanel: boolean;
  showLiveFeedPanel: boolean;
  liveFeed: { time: string; source: string; payload: string }[];
  telemetryFilterQuery: string;
  setTelemetryFilterQuery: (val: string) => void;
  telemetryFilterType: string;
  setTelemetryFilterType: (val: string) => void;
  maxLiveLogs: number;
  setMaxLiveLogs: (val: number) => void;
}

export default function DashboardTab({
  isSyncEnabled,
  handleToggleSync,
  bufferTelemetry,
  telemetryWarningThreshold,
  oeeOutbox,
  eventWarningThreshold,
  diagnostics,
  adapters,
  datapoints,
  datasources,
  isConnected,
  operationalRefreshedAt,
  operationalDataStale,
  showDiagnosticsPanel,
  showLiveFeedPanel,
  liveFeed,
  telemetryFilterQuery,
  setTelemetryFilterQuery,
  telemetryFilterType,
  setTelemetryFilterType,
  maxLiveLogs,
  setMaxLiveLogs
}: DashboardTabProps) {
  const [drilldown, setDrilldown] = useState<DashboardDrilldown | null>(null);

  const filteredLiveFeed = liveFeed
    .filter(item => {
      if (telemetryFilterType !== 'All') {
        const dps = datapoints.filter(dp => dp.dataSourceId === item.source);
        const hasProtocol = dps.some(dp => {
          const adp = adapters.find(a => a.id === dp.adapterId);
          if (!adp) return false;
          if (telemetryFilterType === 'MQTT') return adp.protocol === 'MQTT';
          if (telemetryFilterType === 'OPC UA') return adp.protocol === 'OPC_UA';
          if (telemetryFilterType === 'Modbus TCP') return adp.protocol === 'MODBUS_TCP';
          if (telemetryFilterType === 'Modbus RTU') return adp.protocol === 'MODBUS_RTU';
          if (telemetryFilterType === 'Ethernet/IP') return adp.protocol === 'Ethernet/IP';
          if (telemetryFilterType === 'Siemens S7') return adp.protocol === 'Siemens S7';
          return false;
        });
        if (!hasProtocol) return false;
      }
      if (telemetryFilterQuery.trim() !== '') {
        const q = telemetryFilterQuery.toLowerCase();
        if (!item.source.toLowerCase().includes(q) && !item.payload.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    })
    .slice(0, maxLiveLogs);

  // Helper to parse CPU percentage
  const cpuPercent = (() => {
    if (!diagnostics?.cpuUsage) return 0;
    const match = diagnostics.cpuUsage.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  })();

  // Helper to parse Memory usage and percentage (budget 512MB for lightweight agent)
  const memUsageMb = (() => {
    if (!diagnostics?.memoryUsage) return 0;
    const match = diagnostics.memoryUsage.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  })();
  
  const memPercent = (() => {
    const maxAgentMemory = 512; // budget limit for edge agent in MB
    return Math.min(100, Math.round((memUsageMb / maxAgentMemory) * 100));
  })();

  // Helper to parse Disk usage and percentage
  const diskInfo = (() => {
    if (!diagnostics?.diskSpace) return { used: 0, total: 100, percent: 0 };
    const matches = diagnostics.diskSpace.match(/([\d.]+)\s*GB\s*\/\s*([\d.]+)\s*GB/i);
    if (matches && matches.length >= 3) {
      const used = parseFloat(matches[1]);
      const total = parseFloat(matches[2]);
      const percent = Math.min(100, Math.round((used / total) * 100));
      return { used, total, percent };
    }
    return { used: 0, total: 100, percent: 0 };
  })();

  // Helper to format payload JSON nicely
  const renderPayload = (payloadStr: string) => {
    try {
      const parsed = JSON.parse(payloadStr);
      if (parsed && typeof parsed === 'object') {
        return (
          <div className="telemetry-pill-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {Object.entries(parsed).map(([key, val]) => {
              const displayVal = val === null || val === undefined
                ? 'null'
                : typeof val === 'object'
                  ? JSON.stringify(val)
                  : typeof val === 'number'
                    ? parseFloat(val.toFixed(3)).toString()
                    : String(val);

              return (
                <div 
                  key={key} 
                  className="telemetry-pill-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    backgroundColor: 'var(--bg-color, #f4f5f7)',
                    border: '1px solid var(--border-color, #e2e8f0)',
                    borderRadius: '12px',
                    padding: '2px 8px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-code, Space Mono)'
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', marginRight: '4px', fontWeight: 600 }}>{key}:</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{displayVal}</span>
                </div>
              );
            })}
          </div>
        );
      }
    } catch {
      // ignore
    }
    return <span className="cell-mono-code">{payloadStr}</span>;
  };

  const telemetryDanger = bufferTelemetry.length >= telemetryWarningThreshold;
  const eventsDanger = oeeOutbox.length >= eventWarningThreshold;
  const totalBuffered = bufferTelemetry.length + oeeOutbox.length;
  const bufferStateClass = telemetryDanger || eventsDanger
    ? 'is-danger'
    : totalBuffered > 0
      ? 'is-warning'
      : 'is-success';

  const bufferStateText = telemetryDanger || eventsDanger
    ? 'Warning Alert'
    : totalBuffered > 0
      ? 'Buffering'
      : 'Healthy';

  const gridClass = showLiveFeedPanel && showDiagnosticsPanel
    ? 'dashboard-grid is-split'
    : 'dashboard-grid is-single';

  return (
    <>
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Activity size={24} className="page-header-icon" />
            Edge Node Health Summary
          </h2>
          <p className="page-header-desc">
            Real-time diagnostics, sync status, and SQLite queue telemetry logs for this edge device.
          </p>
        </div>
      </div>

      <div className="ops-status-strip">
        <span className={`ops-status-item ${isConnected ? 'is-good' : 'is-bad'}`}><i />Node <b>{isConnected ? 'Connected' : 'Disconnected'}</b></span>
        <button className={`ops-status-item ${isSyncEnabled ? 'is-good' : 'is-warn'}`} onClick={handleToggleSync} title="Toggle cloud synchronization">{isSyncEnabled ? <Pause size={12}/> : <Play size={12}/>}Cloud sync <b>{isSyncEnabled ? 'Online' : 'Paused'}</b></button>
        <span className={`ops-status-item ${bufferStateClass}`}><i />Buffer <b>{bufferStateText}</b></span>
        <span className="ops-status-item">Telemetry queue <b>{bufferTelemetry.length}</b></span>
        <span className="ops-status-item">OEE queue <b>{oeeOutbox.length}</b></span>
        <span className={`ops-refresh-state ${operationalDataStale ? 'is-stale' : ''}`}>{operationalDataStale ? 'Stale data · last success ' : 'Updated '}{operationalRefreshedAt ? operationalRefreshedAt.toLocaleTimeString() : '—'}</span>
      </div>

      <OperationalOverview adapters={adapters} datapoints={datapoints} datasources={datasources} onSelect={setDrilldown}/>

      {(telemetryDanger || eventsDanger) && <div className="ops-queue-alert"><strong>Queue threshold exceeded.</strong> Telemetry: {bufferTelemetry.length}/{telemetryWarningThreshold} · OEE: {oeeOutbox.length}/{eventWarningThreshold}</div>}

      {!showLiveFeedPanel && !showDiagnosticsPanel ? (
        <div className="panel panel-empty-centered">
          All optional dashboard panels are hidden. You can enable them again in the Settings tab.
        </div>
      ) : (
        <div className={gridClass}>
          {showLiveFeedPanel && (
            <div className="panel panel-flex-col live-feed-panel">
              <div className="panel-header panel-header-tight">
                <h2 className="panel-title">Real-Time Telemetry Stream Feed</h2>
                <span className="badge success badge-live">
                  <span className="pulse-dot pulse-dot-sm" /> Live
                </span>
              </div>

              <div className="live-feed-filters">
                <div className="live-feed-filter-input">
                  <input
                    className="form-input form-input-compact"
                    type="text"
                    placeholder="Filter by source or payload..."
                    value={telemetryFilterQuery}
                    onChange={(e) => setTelemetryFilterQuery(e.target.value)}
                  />
                </div>
                <div className="live-feed-filter-select">
                  <CustomSelect
                    value={telemetryFilterType}
                    onChange={setTelemetryFilterType}
                    options={[
                      { value: 'All', label: 'All Protocols' },
                      { value: 'OPC UA', label: 'OPC UA' },
                      { value: 'MQTT', label: 'MQTT' },
                      { value: 'Modbus TCP', label: 'Modbus TCP' },
                      { value: 'Modbus RTU', label: 'Modbus RTU' },
                      { value: 'Ethernet/IP', label: 'Ethernet/IP' },
                      { value: 'Siemens S7', label: 'Siemens S7' }
                    ]}
                  />
                </div>
                <div className="live-feed-limit">
                  <span>Limit:</span>
                  <div className="live-feed-limit-select">
                    <CustomSelect
                      value={maxLiveLogs.toString()}
                      onChange={(val) => setMaxLiveLogs(parseInt(val, 10))}
                      options={[
                        { value: '5', label: '5' },
                        { value: '10', label: '10' },
                        { value: '15', label: '15' },
                        { value: '20', label: '20' },
                        { value: '30', label: '30' }
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="live-feed-scroll">
                {filteredLiveFeed.length === 0 ? (
                  <div className="table-empty-sm">No telemetry records matching current filters.</div>
                ) : (
                  <table className="data-table is-compact">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Source/Topic</th>
                        <th>Payload Metrics</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLiveFeed.map((item, idx) => (
                        <tr key={`${item.time}-${item.source}-${idx}`} className="flash-new-row">
                          <td className="cell-mono-secondary">{item.time}</td>
                          <td className="cell-highlight">{item.source}</td>
                          <td>{renderPayload(item.payload)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {showDiagnosticsPanel && (
            <div className="panel diagnostics-panel-visual">
              <div className="panel-header">
                <h2 className="panel-title">System Diagnostics</h2>
                <Cpu size={16} className="text-secondary" />
              </div>

              <div className="diag-visual-grid" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
                
                {/* CPU Usage */}
                <div className="diag-item-bar">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                    <span className="font-bold" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                      <Cpu size={14} className="text-secondary" />
                      CPU Usage
                    </span>
                    <span className="cell-mono font-bold" style={{ color: 'var(--text-primary)' }}>{diagnostics?.cpuUsage || 'N/A'}</span>
                  </div>
                  <div className="progress-bg" style={{ height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div className="progress-fill" style={{ 
                      height: '100%', 
                      width: `${cpuPercent}%`, 
                      background: cpuPercent > 80 ? 'var(--danger-color)' : cpuPercent > 50 ? 'var(--warning-color)' : 'var(--primary-color)',
                      borderRadius: '4px',
                      transition: 'width 0.5s ease-in-out'
                    }} />
                  </div>
                </div>

                {/* Memory Usage */}
                <div className="diag-item-bar">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                    <span className="font-bold" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                      <HardDrive size={14} className="text-secondary" />
                      Memory Footprint
                    </span>
                    <span className="cell-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                      {diagnostics?.memoryUsage || 'N/A'}{' '}
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                        ({memPercent}% of budget)
                      </span>
                    </span>
                  </div>
                  <div className="progress-bg" style={{ height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div className="progress-fill" style={{ 
                      height: '100%', 
                      width: `${memPercent}%`, 
                      background: memPercent > 80 ? 'var(--danger-color)' : memPercent > 50 ? 'var(--warning-color)' : 'var(--primary-color)',
                      borderRadius: '4px',
                      transition: 'width 0.5s ease-in-out'
                    }} />
                  </div>
                </div>

                {/* Disk Space */}
                <div className="diag-item-bar">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                    <span className="font-bold" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                      <HardDrive size={14} className="text-secondary" />
                      Disk Allocation
                    </span>
                    <span className="cell-mono font-bold" style={{ color: 'var(--text-primary)' }}>
                      {diskInfo.used} GB / {diskInfo.total} GB{' '}
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 400 }}>
                        ({diskInfo.percent}% used)
                      </span>
                    </span>
                  </div>
                  <div className="progress-bg" style={{ height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div className="progress-fill" style={{ 
                      height: '100%', 
                      width: `${diskInfo.percent}%`, 
                      background: diskInfo.percent > 90 ? 'var(--danger-color)' : diskInfo.percent > 75 ? 'var(--warning-color)' : 'var(--primary-color)',
                      borderRadius: '4px',
                      transition: 'width 0.5s ease-in-out'
                    }} />
                  </div>
                </div>

                {/* Uptime and DB File */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} />
                      Uptime
                    </div>
                    <div className="cell-mono font-bold" style={{ fontSize: '14px', marginTop: '2px', color: 'var(--text-primary)' }}>{diagnostics?.uptime || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Database File</div>
                    <div className="cell-mono-xs" style={{ fontSize: '12px', marginTop: '2px', wordBreak: 'break-all', color: 'var(--text-primary)' }}>~/.pulse/edge.db</div>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      )}
      {drilldown && (
        <DashboardDetailModal selection={drilldown} adapters={adapters} datapoints={datapoints} datasources={datasources} onClose={() => setDrilldown(null)}/>
      )}
    </>
  );
}
