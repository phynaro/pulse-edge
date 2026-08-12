import { useState } from 'react';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CustomSelect from './CustomSelect';
import FactoryResetModal from './FactoryResetModal';
import SoftResetModal from './SoftResetModal';
import type { DashboardData } from '../types';
import { useAuth } from '../context/auth';
import UserManagement from './UserManagement';
import ConfigurationBackupPanel from './ConfigurationBackupPanel';
import LanguageSwitcher from './LanguageSwitcher';

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
  handleSoftReset: () => Promise<void>;
  onRestoreComplete: () => Promise<void>;
  onOpenWizard?: () => void;
}

export default function SettingsTab(props: SettingsTabProps) {
  const { t } = useTranslation();
  const {
    dashboard, cloudEndpoint, setCloudEndpoint, edgeSerial, setEdgeSerial,
    handleSaveSettings, pollingInterval, setPollingInterval, maxLiveLogs,
    setMaxLiveLogs, telemetryWarningThreshold, setTelemetryWarningThreshold,
    eventWarningThreshold, setEventWarningThreshold, showLiveFeedPanel,
    setShowLiveFeedPanel, showDiagnosticsPanel, setShowDiagnosticsPanel,
    handleFactoryReset, handleSoftReset, onRestoreComplete, onOpenWizard
  } = props;
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isSoftResetModalOpen, setIsSoftResetModalOpen] = useState(false);

  return (
    <>
      <div className="page-header">
        <div className="page-header-info">
          <h2 className="page-header-title"><Settings size={24} className="page-header-icon" />{t('settings.title')}</h2>
          <p className="page-header-desc">{t('settings.subtitle')}</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="tab-stack">
          <div className="panel panel-flush">
            <div className="panel-header"><h2 className="panel-title">{t('settings.cloudHeader')}</h2></div>
            <div className="form-group"><label className="form-label">{t('settings.cloudEndpoint')}</label><input className="form-input" type="url" value={cloudEndpoint} readOnly={!isAdmin} onChange={(e) => setCloudEndpoint(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">{t('settings.serialNumber')}</label><input className="form-input" type="text" value={edgeSerial} readOnly={!isAdmin} onChange={(e) => setEdgeSerial(e.target.value)} /><small className="form-hint">Warning: Changing the Serial Number forces device re-registration on next runtime start.</small></div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              {isAdmin && <button type="button" className="btn-primary" onClick={handleSaveSettings}>{t('settings.saveSettings')}</button>}
              {onOpenWizard && <button type="button" className="btn-secondary" onClick={onOpenWizard}>Open Cloud Pairing Wizard</button>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><h2 className="panel-title">{t('settings.languageHeader')}</h2></div>
            <div className="form-group">
              <label className="form-label">{t('settings.languageSelectLabel')}</label>
              <LanguageSwitcher variant="full" />
            </div>
          </div>

          {isAdmin && <div className="panel">
            <div className="panel-header"><h2 className="panel-title">{t('settings.uiPreferences')}</h2></div>
            <div className="form-group"><label className="form-label">{t('settings.pollingIntervalMs')}</label><CustomSelect value={pollingInterval.toString()} onChange={(val) => setPollingInterval(parseInt(val, 10))} options={[{ value: '1000', label: '1 Second (Realtime)' }, { value: '3000', label: '3 Seconds (Standard)' }, { value: '5000', label: '5 Seconds (Efficient)' }, { value: '10000', label: '10 Seconds (Low Power)' }]} /></div>
            <div className="form-group"><label className="form-label">{t('settings.maxLiveLogsCount')} ({maxLiveLogs})</label><input className="form-input form-input-range" type="range" min="5" max="50" step="5" value={maxLiveLogs} onChange={(e) => setMaxLiveLogs(parseInt(e.target.value, 10))} /></div>
            <div className="form-grid-2col-settings">
              <div className="form-group"><label className="form-label">{t('settings.telemetryWarnThreshold')}</label><input className="form-input" type="number" min="1" value={telemetryWarningThreshold} onChange={(e) => setTelemetryWarningThreshold(parseInt(e.target.value, 10) || 10)} /></div>
              <div className="form-group"><label className="form-label">{t('settings.eventWarnThreshold')}</label><input className="form-input" type="number" min="1" value={eventWarningThreshold} onChange={(e) => setEventWarningThreshold(parseInt(e.target.value, 10) || 5)} /></div>
            </div>
            <div className="form-group form-group-flush"><label className="form-label form-label-bold">Visible Dashboard Modules</label><label className="checkbox-label"><input type="checkbox" checked={showLiveFeedPanel} onChange={(e) => setShowLiveFeedPanel(e.target.checked)} /><span>{t('settings.showLiveFeed')}</span></label><label className="checkbox-label"><input type="checkbox" checked={showDiagnosticsPanel} onChange={(e) => setShowDiagnosticsPanel(e.target.checked)} /><span>{t('settings.showDiagnostics')}</span></label></div>
          </div>}

          {isAdmin && <ConfigurationBackupPanel onRestoreComplete={onRestoreComplete} />}
          {isAdmin && user && <UserManagement currentUserId={user.id} />}
          {isAdmin && <div className="panel"><div className="panel-header"><h2 className="panel-title text-warning" style={{ color: 'var(--warning-color, #ffb300)' }}>Soft Reset</h2></div><p className="text-secondary" style={{ fontSize: '13px', margin: '8px 0 16px 0', lineHeight: '1.5' }}>Reset cloud registration and pairing details (Organization, Site, and API Key) to allow pairing this Edge node under a different organization. <strong>All local configurations (driver adapters, streams, and data points) will be preserved.</strong></p><button type="button" className="btn-secondary" style={{ width: '100%', borderColor: 'var(--warning-color, #ffb300)', color: 'var(--warning-color, #ffb300)' }} onClick={() => setIsSoftResetModalOpen(true)}>Soft Reset Node</button></div>}
          {isAdmin && <div className="panel"><div className="panel-header"><h2 className="panel-title text-danger" style={{ color: 'var(--error-color, #ef4444)' }}>Factory Default</h2></div><p className="text-secondary" style={{ fontSize: '13px', margin: '8px 0 16px 0', lineHeight: '1.5' }}>Erase all configuration, buffered data, and local users. Onboarding will restart and a new administrator must be created after cloud pairing.</p><button type="button" className="btn-danger-solid" style={{ width: '100%' }} onClick={() => setIsResetModalOpen(true)}>Reset to Factory Default</button></div>}
        </div>

        <div className="panel">
          <div className="panel-header"><h2 className="panel-title">Active Node Details</h2></div>
          <div className="form-group"><label className="form-label">DeviceId (UUID)</label><input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.deviceId || 'Fetching...'} /></div>
          <div className="form-group"><label className="form-label">Associated Organization ID</label><input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.organizationId || 'Fetching...'} /></div>
          {dashboard?.device.organizationName && dashboard.device.organizationName !== 'N/A' && <div className="form-group"><label className="form-label">Associated Organization Name</label><input className="form-input" type="text" readOnly value={dashboard.device.organizationName} /></div>}
          <div className="form-group"><label className="form-label">Associated Factory Site ID</label><input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.siteId || 'Fetching...'} /></div>
          {dashboard?.device.siteName && dashboard.device.siteName !== 'N/A' && <div className="form-group"><label className="form-label">Associated Factory Site Name</label><input className="form-input" type="text" readOnly value={dashboard.device.siteName} /></div>}
          <div className="form-group"><label className="form-label">API Key Token</label><input className="form-input form-input-mono" type="text" readOnly value={dashboard?.device.apiKey || 'N/A'} /></div>
        </div>
      </div>

      {isResetModalOpen && <FactoryResetModal onConfirm={async () => { await handleFactoryReset(); setIsResetModalOpen(false); }} onCancel={() => setIsResetModalOpen(false)} />}
      {isSoftResetModalOpen && <SoftResetModal onConfirm={async () => { await handleSoftReset(); setIsSoftResetModalOpen(false); }} onCancel={() => setIsSoftResetModalOpen(false)} />}
    </>
  );
}
