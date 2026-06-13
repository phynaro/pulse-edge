import { Cpu, Play, Pause, Activity } from 'lucide-react';
import CustomSelect from './CustomSelect';
import type {
  DiagnosticData,
  BufferTelemetryItem,
  BufferEventItem,
  DriverAdapter,
  DataPoint
} from '../types';

interface DashboardTabProps {
  isSyncEnabled: boolean;
  handleToggleSync: () => void;
  bufferTelemetry: BufferTelemetryItem[];
  telemetryWarningThreshold: number;
  bufferEvents: BufferEventItem[];
  eventWarningThreshold: number;
  diagnostics: DiagnosticData | null;
  adapters: DriverAdapter[];
  datapoints: DataPoint[];
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
  bufferEvents,
  eventWarningThreshold,
  diagnostics,
  adapters,
  datapoints,
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

  const telemetryDanger = bufferTelemetry.length >= telemetryWarningThreshold;
  const eventsDanger = bufferEvents.length >= eventWarningThreshold;
  const totalBuffered = bufferTelemetry.length + bufferEvents.length;

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

      <div className="stats-grid">
        <div className="card">
          <div className="card-title">Cloud Sync Status</div>
          <div className={`card-value ${isSyncEnabled ? 'is-online' : 'is-paused'}`}>
            {isSyncEnabled ? 'ONLINE' : 'PAUSED'}
          </div>
          <button
            type="button"
            onClick={handleToggleSync}
            className={`sync-toggle-btn ${isSyncEnabled ? 'is-online' : 'is-paused'}`}
          >
            {isSyncEnabled ? <Pause size={14} /> : <Play size={14} />}
            {isSyncEnabled ? 'Pause Sync' : 'Resume Sync'}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Telemetry Queue</div>
          <div className={`card-value ${telemetryDanger ? 'is-danger' : ''}`}>
            {bufferTelemetry.length}
          </div>
          <div className="card-desc">
            {telemetryDanger
              ? `Alert: Limit exceeded (>= ${telemetryWarningThreshold})`
              : 'Pending SQLite records'}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Events Queue</div>
          <div className={`card-value ${eventsDanger ? 'is-danger' : ''}`}>
            {bufferEvents.length}
          </div>
          <div className="card-desc">
            {eventsDanger
              ? `Alert: Limit exceeded (>= ${eventWarningThreshold})`
              : 'Buffered state changes'}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Buffer State</div>
          <div className={`card-value card-value-sm ${bufferStateClass}`}>
            {bufferStateText}
          </div>
          <div className="card-desc">SQLite Store-and-Forward</div>
        </div>
      </div>

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
                        <th>Payload JSON</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLiveFeed.map((item, idx) => (
                        <tr key={idx}>
                          <td className="cell-mono-secondary">{item.time}</td>
                          <td className="cell-highlight">{item.source}</td>
                          <td className="cell-mono-code">{item.payload}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {showDiagnosticsPanel && (
            <div className="panel">
              <div className="panel-header">
                <h2 className="panel-title">System Diagnostics</h2>
                <Cpu size={16} className="text-secondary" />
              </div>

              <table className="data-table">
                <tbody>
                  <tr>
                    <td className="cell-bold">Daemon Uptime</td>
                    <td className="cell-mono">{diagnostics?.uptime || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="cell-bold">CPU Usage</td>
                    <td className="cell-mono">{diagnostics?.cpuUsage || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="cell-bold">Memory Footprint</td>
                    <td className="cell-mono">{diagnostics?.memoryUsage || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="cell-bold">Disk Available</td>
                    <td className="cell-mono">{diagnostics?.diskSpace || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="cell-bold">Database File</td>
                    <td className="cell-mono-xs">~/.pulse/edge.db</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
