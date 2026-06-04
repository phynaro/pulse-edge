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
  
  // Compute live telemetry feed with dynamic filtering and slicing based on configuration
  const filteredLiveFeed = liveFeed
    .filter(item => {
      if (telemetryFilterType !== 'All') {
        // Find if this datasource has any datapoints bound to an adapter of this protocol
        const dps = datapoints.filter(dp => dp.dataSourceId === item.source);
        const hasProtocol = dps.some(dp => {
          const adp = adapters.find(a => a.id === dp.adapterId);
          if (!adp) return false;
          if (telemetryFilterType === 'MQTT') return adp.protocol === 'MQTT';
          if (telemetryFilterType === 'OPC UA') return adp.protocol === 'OPC_UA';
          if (telemetryFilterType === 'Modbus TCP') return adp.protocol === 'MODBUS_TCP';
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

  return (
    <>
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Activity size={24} style={{ color: 'var(--primary-color)' }} />
            Edge Node Health Summary
          </h2>
          <p className="page-header-desc">
            Real-time diagnostics, sync status, and SQLite queue telemetry logs for this edge device.
          </p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="stats-grid">
        <div className="card">
          <div className="card-title">Cloud Sync Status</div>
          <div className="card-value" style={{ color: isSyncEnabled ? 'var(--primary-dark)' : 'var(--warning-color)' }}>
            {isSyncEnabled ? 'ONLINE' : 'PAUSED'}
          </div>
          <button 
            onClick={handleToggleSync} 
            style={{
              marginTop: '12px',
              backgroundColor: isSyncEnabled ? 'rgba(60, 232, 189, 0.15)' : 'rgba(236, 201, 75, 0.15)',
              color: isSyncEnabled ? '#2bc59e' : '#744210',
              border: `1px solid ${isSyncEnabled ? 'rgba(60, 232, 189, 0.3)' : 'rgba(236, 201, 75, 0.3)'}`,
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
          >
            {isSyncEnabled ? <Pause size={14} /> : <Play size={14} />}
            {isSyncEnabled ? 'Simulate Outage' : 'Resume Sync'}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Telemetry Queue</div>
          <div className="card-value" style={{ 
            color: bufferTelemetry.length >= telemetryWarningThreshold ? 'var(--danger-color)' : 'var(--text-primary)',
            transition: 'color 0.2s'
          }}>
            {bufferTelemetry.length}
          </div>
          <div className="card-desc">
            {bufferTelemetry.length >= telemetryWarningThreshold 
              ? `Alert: Limit exceeded (>= ${telemetryWarningThreshold})` 
              : 'Pending SQLite records'}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Events Queue</div>
          <div className="card-value" style={{ 
            color: bufferEvents.length >= eventWarningThreshold ? 'var(--danger-color)' : 'var(--text-primary)',
            transition: 'color 0.2s'
          }}>
            {bufferEvents.length}
          </div>
          <div className="card-desc">
            {bufferEvents.length >= eventWarningThreshold 
              ? `Alert: Limit exceeded (>= ${eventWarningThreshold})` 
              : 'Buffered state changes'}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Buffer State</div>
          <div className="card-value" style={{ 
            fontSize: '20px', 
            textTransform: 'uppercase', 
            color: (bufferTelemetry.length >= telemetryWarningThreshold || bufferEvents.length >= eventWarningThreshold) 
              ? 'var(--danger-color)' 
              : (bufferTelemetry.length + bufferEvents.length > 0) 
                ? 'var(--warning-color)' 
                : 'var(--success-color)' 
          }}>
            {bufferTelemetry.length >= telemetryWarningThreshold || bufferEvents.length >= eventWarningThreshold 
              ? 'Warning Alert' 
              : bufferTelemetry.length + bufferEvents.length > 0 
                ? 'Buffering' 
                : 'Healthy'}
          </div>
          <div className="card-desc">SQLite Store-and-Forward</div>
        </div>
      </div>

      {/* Info, Live Feed and Diagnostics split */}
      {!showLiveFeedPanel && !showDiagnosticsPanel ? (
        <div className="panel" style={{ textAlign: 'center', padding: '48px', color: 'var(--text-secondary)' }}>
          All optional dashboard panels are hidden. You can enable them again in the Settings tab.
        </div>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: showLiveFeedPanel && showDiagnosticsPanel ? '1.2fr 1fr' : '1fr', 
          gap: '24px' 
        }}>
          
          {/* Live Telemetry Feed (Real-Time monitoring) */}
          {showLiveFeedPanel && (
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="panel-header" style={{ marginBottom: '12px' }}>
                <h2 className="panel-title">Real-Time Telemetry Stream Feed</h2>
                <span className="badge success" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="pulse-dot" style={{ width: '6px', height: '6px' }} /> Live
                </span>
              </div>

              {/* Quick Interactive Filters */}
              <div style={{ 
                display: 'flex', 
                gap: '12px', 
                marginBottom: '16px', 
                paddingBottom: '12px', 
                borderBottom: '1px dashed var(--border-color)',
                flexWrap: 'wrap',
                alignItems: 'center'
              }}>
                <div style={{ flex: 1, minWidth: '150px' }}>
                  <input 
                    className="form-input" 
                    style={{ padding: '6px 10px', fontSize: '12px' }}
                    type="text" 
                    placeholder="Filter by source or payload..." 
                    value={telemetryFilterQuery}
                    onChange={(e) => setTelemetryFilterQuery(e.target.value)}
                  />
                </div>
                <div style={{ width: '130px' }}>
                  <CustomSelect 
                    value={telemetryFilterType}
                    onChange={setTelemetryFilterType}
                    options={[
                      { value: 'All', label: 'All Protocols' },
                      { value: 'OPC UA', label: 'OPC UA' },
                      { value: 'MQTT', label: 'MQTT' },
                      { value: 'Modbus TCP', label: 'Modbus TCP' }
                    ]}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span>Limit:</span>
                  <div style={{ width: '75px' }}>
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

              <div style={{ flex: 1, maxHeight: '280px', overflowY: 'auto' }}>
                {filteredLiveFeed.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    No telemetry records matching current filters.
                  </div>
                ) : (
                  <table className="data-table" style={{ fontSize: '13px' }}>
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
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>{item.time}</td>
                          <td style={{ fontWeight: 600, color: 'var(--primary-dark)' }}>{item.source}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--code-color)' }}>{item.payload}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Diagnostics Panel */}
          {showDiagnosticsPanel && (
            <div className="panel">
              <div className="panel-header">
                <h2 className="panel-title">System Diagnostics</h2>
                <Cpu size={16} style={{ color: 'var(--text-secondary)' }} />
              </div>

              <table className="data-table">
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Daemon Uptime</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{diagnostics?.uptime || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>CPU Usage</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{diagnostics?.cpuUsage || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Memory Footprint</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{diagnostics?.memoryUsage || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Disk Available</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{diagnostics?.diskSpace || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 600 }}>Database File</td>
                    <td style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>~/.pulse/edge.db</td>
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
