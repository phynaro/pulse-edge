import { useState } from 'react';
import { Settings } from 'lucide-react';
import CustomSelect from './CustomSelect';
import FactoryResetModal from './FactoryResetModal';
import type { DashboardData } from '../types';

interface SettingsTabProps {
  dashboard: DashboardData | null;
  cloudEndpoint: string;
  setCloudEndpoint: (val: string) => void;
  edgeSerial: string;
  setEdgeSerial: (val: string) => void;
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
  handleFactoryReset: () => Promise<void>;
}

export default function SettingsTab({
  dashboard,
  cloudEndpoint,
  setCloudEndpoint,
  edgeSerial,
  setEdgeSerial,
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
  setShowDiagnosticsPanel,
  handleFactoryReset
}: SettingsTabProps) {
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  return (
    <>
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title">
            <Settings size={24} className="page-header-icon" />
            Edge Agent Settings
          </h2>
          <p className="page-header-desc">
            Configure cloud endpoints, device credentials, polling intervals, and user interface preferences.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="tab-stack">
          <div className="panel panel-flush">
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
              <small className="form-hint">
                Warning: Changing the Serial Number forces device re-registration on next runtime start.
              </small>
            </div>

            <button type="button" className="btn-primary" onClick={handleSaveSettings}>
              Save Changes
            </button>
          </div>

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
                className="form-input form-input-range"
                type="range"
                min="5"
                max="50"
                step="5"
                value={maxLiveLogs}
                onChange={(e) => setMaxLiveLogs(parseInt(e.target.value, 10))}
              />
            </div>

            <div className="form-grid-2col-settings">
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

            <div className="form-group form-group-flush">
              <label className="form-label form-label-bold">Visible Dashboard Modules</label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showLiveFeedPanel}
                  onChange={(e) => setShowLiveFeedPanel(e.target.checked)}
                />
                <span>Show Real-time Telemetry Feed Panel</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showDiagnosticsPanel}
                  onChange={(e) => setShowDiagnosticsPanel(e.target.checked)}
                />
                <span>Show System Diagnostics Panel</span>
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2 className="panel-title text-danger" style={{ color: 'var(--error-color, #ef4444)' }}>Factory Default</h2>
            </div>
            <p className="text-secondary" style={{ fontSize: '13px', margin: '8px 0 16px 0', lineHeight: '1.5' }}>
              Erase all database tables, resetting the Edge Agent to factory defaults. This action will delete all configurations, driver connections, streams, and buffered data, and restart the onboarding wizard.
            </p>
            <button type="button" className="btn-danger-solid" style={{ width: '100%' }} onClick={() => setIsResetModalOpen(true)}>
              Reset to Factory Default
            </button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Active Node Details</h2>
          </div>

          <div className="form-group">
            <label className="form-label">DeviceId (UUID)</label>
            <input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.deviceId || 'Fetching...'} />
          </div>

          <div className="form-group">
            <label className="form-label">Associated Factory Site ID</label>
            <input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.siteId || 'Fetching...'} />
          </div>

          {dashboard?.device.siteName && dashboard.device.siteName !== 'N/A' && (
            <div className="form-group">
              <label className="form-label">Associated Factory Site Name</label>
              <input className="form-input" type="text" readOnly value={dashboard.device.siteName} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">API Key Token</label>
            <input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.apiKey || 'N/A'} />
          </div>
        </div>
      </div>

      {isResetModalOpen && (
        <FactoryResetModal
          onConfirm={async () => {
            await handleFactoryReset();
            setIsResetModalOpen(false);
          }}
          onCancel={() => setIsResetModalOpen(false)}
        />
      )}
    </>
  );
}
