import { Settings } from 'lucide-react';
import CustomSelect from './CustomSelect';
import type { DashboardData } from '../types';

interface SettingsTabProps {
  dashboard: DashboardData | null;
  cloudEndpoint: string;
  setCloudEndpoint: (val: string) => void;
  edgeSerial: string;
  setEdgeSerial: (val: string) => void;
  pulseApiKey: string;
  setPulseApiKey: (val: string) => void;
  handleSaveSettings: () => Promise<void>;
  pollingInterval: number;
  setPollingInterval: (val: number) => void;
  maxLiveLogs: number;
  setMaxLiveLogs: (val: number) => void;
  telemetryWarningThreshold: number;
  setTelemetryWarningThreshold: (val: number) => void;
  eventWarningThreshold: number;
  setEventWarningThreshold: (val: number) => void;
  showLiveFeedPanel: boolean;
  setShowLiveFeedPanel: (val: boolean) => void;
  showDiagnosticsPanel: boolean;
  setShowDiagnosticsPanel: (val: boolean) => void;
}

export default function SettingsTab({
  dashboard,
  cloudEndpoint,
  setCloudEndpoint,
  edgeSerial,
  setEdgeSerial,
  pulseApiKey,
  setPulseApiKey,
  handleSaveSettings,
  pollingInterval,
  setPollingInterval,
  maxLiveLogs,
  setMaxLiveLogs,
  telemetryWarningThreshold,
  setTelemetryWarningThreshold,
  eventWarningThreshold,
  setEventWarningThreshold,
  showLiveFeedPanel,
  setShowLiveFeedPanel,
  showDiagnosticsPanel,
  setShowDiagnosticsPanel
}: SettingsTabProps) {
  return (
    <>
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Settings size={24} style={{ color: 'var(--primary-color)' }} />
            Edge Agent Settings
          </h2>
          <p className="page-header-desc">
            Configure cloud endpoints, device credentials, polling intervals, and user interface preferences.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Endpoint Config Panel */}
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-header">
            <h2 className="panel-title">Configure Connection Endpoints</h2>
          </div>

          <div className="form-group">
            <label className="form-label">PULSE Cloud Synchronizer Target</label>
            <input 
              className="form-input" 
              type="url" 
              value={cloudEndpoint}
              onChange={(e) => setCloudEndpoint(e.target.value)} 
            />
          </div>

          <div className="form-group">
            <label className="form-label">Hardware Serial Number</label>
            <input 
              className="form-input" 
              type="text" 
              value={edgeSerial}
              onChange={(e) => setEdgeSerial(e.target.value)} 
            />
            <small style={{ display: 'block', marginTop: '6px', color: 'var(--text-secondary)', fontSize: '11px' }}>
              Warning: Changing the Serial Number forces device re-registration on next runtime start.
            </small>
          </div>

          <div className="form-group">
            <label className="form-label">PULSE Cloud API Key</label>
            <input 
              className="form-input" 
              type="text" 
              placeholder="pe_live_..."
              value={pulseApiKey}
              onChange={(e) => setPulseApiKey(e.target.value)} 
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>

          <button 
            style={{
              backgroundColor: 'var(--primary-color)',
              color: 'var(--sidebar-bg)',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '6px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onClick={handleSaveSettings}
          >
            Save Changes
          </button>
        </div>

        {/* UI & Data Monitoring Config Panel */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">User Interface Config</h2>
          </div>

          <div className="form-group">
            <label className="form-label">Background Polling Interval</label>
            <CustomSelect 
              value={pollingInterval.toString()}
              onChange={(val) => setPollingInterval(parseInt(val, 10))}
              options={[
                { value: '1000', label: '1 Second (Realtime)' },
                { value: '3000', label: '3 Seconds (Standard)' },
                { value: '5000', label: '5 Seconds (Efficient)' },
                { value: '10000', label: '10 Seconds (Low Power)' }
              ]}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Live Telemetry Max Rows ({maxLiveLogs})</label>
            <input 
              className="form-input" 
              type="range" 
              min="5" 
              max="50" 
              step="5"
              value={maxLiveLogs}
              onChange={(e) => setMaxLiveLogs(parseInt(e.target.value, 10))} 
              style={{ padding: '0', cursor: 'pointer' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="form-group">
              <label className="form-label">Telemetry Alert Limit</label>
              <input 
                className="form-input" 
                type="number" 
                min="1"
                value={telemetryWarningThreshold}
                onChange={(e) => setTelemetryWarningThreshold(parseInt(e.target.value, 10) || 10)} 
              />
            </div>
            <div className="form-group">
              <label className="form-label">Event Alert Limit</label>
              <input 
                className="form-input" 
                type="number" 
                min="1"
                value={eventWarningThreshold}
                onChange={(e) => setEventWarningThreshold(parseInt(e.target.value, 10) || 5)} 
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ marginBottom: '12px' }}>Visible Dashboard Modules</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showLiveFeedPanel} 
                onChange={(e) => setShowLiveFeedPanel(e.target.checked)} 
              />
              <span style={{ fontSize: '13px' }}>Show Real-time Telemetry Feed Panel</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={showDiagnosticsPanel} 
                onChange={(e) => setShowDiagnosticsPanel(e.target.checked)} 
              />
              <span style={{ fontSize: '13px' }}>Show System Diagnostics Panel</span>
            </label>
          </div>
        </div>
      </div>

      {/* Active Node Details Panel */}
      <div className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Active Node Details</h2>
        </div>

        <div className="form-group">
          <label className="form-label">DeviceId (UUID)</label>
          <input className="form-input" type="text" readOnly value={dashboard?.device.deviceId || 'Fetching...'} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>

        <div className="form-group">
          <label className="form-label">Associated Factory Site ID</label>
          <input className="form-input" type="text" readOnly value={dashboard?.device.siteId || 'Fetching...'} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>

        {dashboard?.device.siteName && dashboard.device.siteName !== 'N/A' && (
          <div className="form-group">
            <label className="form-label">Associated Factory Site Name</label>
            <input className="form-input" type="text" readOnly value={dashboard.device.siteName} />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">API Key Token</label>
          <input className="form-input" type="text" readOnly value={dashboard?.device.apiKey || 'N/A'} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
      </div>
      </div>
    </>
  );
}
