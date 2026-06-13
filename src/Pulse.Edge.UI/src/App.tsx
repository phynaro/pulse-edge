import { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Network, 
  RefreshCw, 
  Layers,
  AlertTriangle,
  Tag,
  Settings as SettingsIcon,
  PanelLeft
} from 'lucide-react';
import { useToast } from './hooks/useToast';
import ToastContainer from './components/ToastContainer';

import type { 
  DataSource, 
} from './types';

import DashboardTab from './components/DashboardTab';
import DataSourcesTab from './components/DataSourcesTab';
import TagsTab from './components/TagsTab';
import ProtocolsTab from './components/ProtocolsTab';
import BufferTab from './components/BufferTab';
import SettingsTab from './components/SettingsTab';
import OnboardingWizard from './components/OnboardingWizard';
import OnboardingTourBanner from './components/OnboardingTourBanner';

import { EdgeProvider, useEdge } from './context/EdgeContext';
import { useDashboardData } from './hooks/useDashboardData';
import { useBufferStatus } from './hooks/useBufferStatus';
import { useAdaptersList } from './hooks/useAdaptersList';

const getCloudStatusInfo = (status: string | undefined) => {
  switch (status) {
    case 'Connected':
      return { className: '', label: 'Cloud Link: Connected' };
    case 'PendingApproval':
      return { className: 'pending', label: 'Cloud Link: Waiting for Approval' };
    case 'Revoked':
      return { className: 'revoked', label: 'Cloud Link: API Key Revoked' };
    case 'Disconnected':
      return { className: 'error', label: 'Cloud Link: Disconnected' };
    default:
      return { className: 'pending', label: 'Cloud Link: Waiting for Approval' };
  }
};

type Route = 'dashboard' | 'datasources' | 'tags' | 'protocols' | 'buffer' | 'settings';

function usePathRouting(defaultRoute: Route): [Route, (route: Route) => void] {
  const getRouteFromPath = (): Route => {
    const segment = window.location.pathname.split('/').filter(Boolean)[0] as Route;
    const validRoutes: Route[] = ['dashboard', 'datasources', 'tags', 'protocols', 'buffer', 'settings'];
    return validRoutes.includes(segment) ? segment : defaultRoute;
  };

  const [currentRoute, setCurrentRoute] = useState<Route>(getRouteFromPath);

  const navigate = (newRoute: Route) => {
    window.history.pushState(null, '', `/${newRoute}`);
    setCurrentRoute(newRoute);
  };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(getRouteFromPath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const path = window.location.pathname.split('/').filter(Boolean)[0] as Route;
    const validRoutes: Route[] = ['dashboard', 'datasources', 'tags', 'protocols', 'buffer', 'settings'];
    if (!validRoutes.includes(path)) {
      window.history.replaceState(null, '', `/${currentRoute}`);
    }
  }, [currentRoute]);

  return [currentRoute, navigate];
}

function EdgeInner() {
  const [activeTab, setActiveTab] = usePathRouting('dashboard');
  
  const {
    isConnected,
    isLoading, setIsLoading,
    dashboard,
    datasources,
    adapters,
    datapoints,
    mqttDevices,
    diagnostics,
    isSyncEnabled, setIsSyncEnabled,
    bufferTelemetry,
    bufferEvents,
    pollingInterval, setPollingInterval,
    maxLiveLogs, setMaxLiveLogs,
    telemetryWarningThreshold, setTelemetryWarningThreshold,
    eventWarningThreshold, setEventWarningThreshold,
    showDiagnosticsPanel, setShowDiagnosticsPanel,
    showLiveFeedPanel, setShowLiveFeedPanel,
    liveFeed,
    cloudEndpoint, setCloudEndpoint,
    edgeSerial, setEdgeSerial,
    isOnboarded, setIsOnboarded,
    isSidebarCollapsed, setIsSidebarCollapsed,
    fetchStaticData,
    setHasInitializedSettings
  } = useEdge();

  // Split Polling Hooks
  useDashboardData(pollingInterval); // Polls dashboard and diagnostics
  useBufferStatus(2000);             // Polls buffer status and updates live logs
  useAdaptersList(activeTab === 'protocols', 3000); // Polls adapters only when tab is active

  const toggleSidebar = () => {
    setIsSidebarCollapsed(!isSidebarCollapsed);
    localStorage.setItem('sidebarCollapsed', String(!isSidebarCollapsed));
  };

  const { toasts, removeToast, toast } = useToast();

  const handleToggleSync = async () => {
    try {
      const res = await fetch('/api/settings/toggle-sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIsSyncEnabled(data.isSyncEnabled);
        void fetchStaticData();
      }
    } catch (e) {
      console.error('Failed to toggle sync status:', e);
    }
  };

  const handleToggleStreamEnabled = async (ds: DataSource) => {
    try {
      const updated = { ...ds, isEnabled: !ds.isEnabled };
      const res = await fetch('/api/datasources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        void fetchStaticData();
      } else {
        toast.error('Failed to toggle stream state.');
      }
    } catch (err) {
      console.error('Error toggling stream state:', err);
      toast.error('Error toggling stream state.');
    }
  };

  const handleDeleteDataPoint = async (id: string) => {
    try {
      const res = await fetch(`/api/datapoints/${id}`, { method: 'DELETE' });
      if (res.ok) {
        void fetchStaticData();
      } else {
        toast.error('Failed to unbind data point metric.');
      }
    } catch (err) {
      console.error('Failed to delete data point:', err);
      toast.error('Failed to delete data point.');
    }
  };

  const handleDeleteStream = async (id: string) => {
    try {
      const res = await fetch(`/api/datasources/${id}`, { method: 'DELETE' });
      if (res.ok) {
        void fetchStaticData();
        toast.success('Stream object deleted successfully.');
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to delete stream object.');
      }
    } catch (err) {
      console.error('Failed to delete stream:', err);
      toast.error('Failed to delete stream.');
    }
  };

  const handleRenameStream = async (ds: DataSource, newName: string) => {
    try {
      const updated = { ...ds, name: newName };
      const res = await fetch('/api/datasources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        void fetchStaticData();
        toast.success(`Stream renamed to '${newName}' successfully.`);
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to rename stream.');
      }
    } catch (err) {
      console.error('Error renaming stream:', err);
      toast.error('Error renaming stream.');
    }
  };

  const handleSaveSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialNumber: edgeSerial,
          cloudEndpoint: cloudEndpoint
        })
      });

      if (res.ok) {
        toast.success('System settings saved successfully to SQLite.');
        void fetchStaticData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to save system settings.');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      toast.error('An error occurred while saving settings.');
    }
  };

  const handleFactoryReset = async () => {
    try {
      const res = await fetch('/api/settings/factory-reset', {
        method: 'POST'
      });

      if (res.ok) {
        toast.success('Agent has been successfully reset to factory defaults.');
        
        localStorage.removeItem('pulse_onboarding_tour_dismissed');
        setCloudEndpoint('http://localhost:3000');
        setEdgeSerial('');
        setIsOnboarded(false);
        setHasInitializedSettings(false);
        setActiveTab('dashboard');
        
        void fetchStaticData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to perform factory reset.');
      }
    } catch (err) {
      console.error('Failed to factory reset:', err);
      toast.error('An error occurred during factory reset.');
    }
  };

  // UI config persistence effects
  useEffect(() => {
    localStorage.setItem('pulse_ui_polling_interval', pollingInterval.toString());
  }, [pollingInterval]);

  useEffect(() => {
    localStorage.setItem('pulse_ui_max_live_logs', maxLiveLogs.toString());
  }, [maxLiveLogs]);

  useEffect(() => {
    localStorage.setItem('pulse_ui_telemetry_threshold', telemetryWarningThreshold.toString());
  }, [telemetryWarningThreshold]);

  useEffect(() => {
    localStorage.setItem('pulse_ui_event_threshold', eventWarningThreshold.toString());
  }, [eventWarningThreshold]);

  useEffect(() => {
    localStorage.setItem('pulse_ui_show_diagnostics', showDiagnosticsPanel.toString());
  }, [showDiagnosticsPanel]);

  useEffect(() => {
    localStorage.setItem('pulse_ui_show_live_feed', showLiveFeedPanel.toString());
  }, [showLiveFeedPanel]);

  // Dynamic filter states for live feed
  const [telemetryFilterQuery, setTelemetryFilterQuery] = useState('');
  const [telemetryFilterType, setTelemetryFilterType] = useState('All');

  if (!isOnboarded) {
    return (
      <>
        <OnboardingWizard 
          toast={toast} 
          onComplete={() => { 
            setHasInitializedSettings(false);
            setIsOnboarded(true); 
            void fetchStaticData(); 
          }} 
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  return (
    <div className="app-container">
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          {!isSidebarCollapsed && (
            <div className="sidebar-logo">
              PULSE <span>EDGE</span>
            </div>
          )}
          <button 
            onClick={toggleSidebar} 
            className="sidebar-toggle-btn"
            title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <PanelLeft size={18} />
          </button>
        </div>
        
        <nav className="sidebar-menu">
          <button 
            className={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
            title={isSidebarCollapsed ? "Dashboard" : undefined}
          >
            <Activity size={18} />
            {!isSidebarCollapsed && <span>Dashboard</span>}
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'protocols' ? 'active' : ''}`}
            onClick={() => setActiveTab('protocols')}
            title={isSidebarCollapsed ? "Protocols" : undefined}
          >
            <Network size={18} />
            {!isSidebarCollapsed && <span>Protocols</span>}
          </button>
 
          <button 
            className={`menu-item ${activeTab === 'tags' ? 'active' : ''}`}
            onClick={() => setActiveTab('tags')}
            title={isSidebarCollapsed ? "Tags" : undefined}
          >
            <Tag size={18} />
            {!isSidebarCollapsed && <span>Tags</span>}
          </button>
 
          <button 
            className={`menu-item ${activeTab === 'datasources' ? 'active' : ''}`}
            onClick={() => setActiveTab('datasources')}
            title={isSidebarCollapsed ? "Streams" : undefined}
          >
            <Database size={18} />
            {!isSidebarCollapsed && <span>Streams</span>}
          </button>
 
          <button 
            className={`menu-item ${activeTab === 'buffer' ? 'active' : ''}`}
            onClick={() => setActiveTab('buffer')}
            title={isSidebarCollapsed ? `Buffer Explorer (${bufferTelemetry.length + bufferEvents.length})` : undefined}
          >
            <Layers size={18} />
            {!isSidebarCollapsed && <span>Buffer Explorer ({bufferTelemetry.length + bufferEvents.length})</span>}
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
            title={isSidebarCollapsed ? "Settings" : undefined}
          >
            <SettingsIcon size={18} />
            {!isSidebarCollapsed && <span>Settings</span>}
          </button>
        </nav>
        
        {!isSidebarCollapsed && (
          <div className="sidebar-footer">
            <div>AGENT V{dashboard?.version || '1.0.0'}</div>
            <div className="sidebar-footer-note">DB Status: SQLite WAL</div>
          </div>
        )}
      </aside>
 
      <main className="main-content">
        <div className="content-area">
          {!isSyncEnabled && (
            <div className="banner-warning">
              <AlertTriangle size={20} />
              <span>
                <strong>Sync Loop Paused:</strong> Synchronization loop is currently paused. Telemetry packets are building up in the SQLite database queue buffer.
              </span>
            </div>
          )}

          {isLoading && !dashboard ? (
            <div className="loading-center">
              Loading edge statistics...
            </div>
          ) : (
            <>
              <OnboardingTourBanner 
                adapters={adapters}
                datapoints={datapoints}
                setActiveTab={setActiveTab}
              />
              {activeTab === 'dashboard' && (
                <DashboardTab
                  isSyncEnabled={isSyncEnabled}
                  handleToggleSync={handleToggleSync}
                  bufferTelemetry={bufferTelemetry}
                  telemetryWarningThreshold={telemetryWarningThreshold}
                  bufferEvents={bufferEvents}
                  eventWarningThreshold={eventWarningThreshold}
                  diagnostics={diagnostics}
                  adapters={adapters}
                  datapoints={datapoints}
                  showDiagnosticsPanel={showDiagnosticsPanel}
                  showLiveFeedPanel={showLiveFeedPanel}
                  liveFeed={liveFeed}
                  telemetryFilterQuery={telemetryFilterQuery}
                  setTelemetryFilterQuery={setTelemetryFilterQuery}
                  telemetryFilterType={telemetryFilterType}
                  setTelemetryFilterType={setTelemetryFilterType}
                  maxLiveLogs={maxLiveLogs}
                  setMaxLiveLogs={setMaxLiveLogs}
                />
              )}
 
              {activeTab === 'datasources' && (
                <DataSourcesTab
                  datasources={datasources}
                  datapoints={datapoints}
                  adapters={adapters}
                  handleToggleStreamEnabled={handleToggleStreamEnabled}
                  handleDeleteDataPoint={handleDeleteDataPoint}
                  handleDeleteStream={handleDeleteStream}
                  handleRenameStream={handleRenameStream}
                  fetchData={fetchStaticData}
                  toast={toast}
                />
              )}
 
              {activeTab === 'tags' && (
                <TagsTab
                  datapoints={datapoints}
                  adapters={adapters}
                  mqttDevices={mqttDevices}
                  handleDeleteDataPoint={handleDeleteDataPoint}
                  fetchData={fetchStaticData}
                  toast={toast}
                />
              )}
 
              {activeTab === 'protocols' && (
                <ProtocolsTab
                  adapters={adapters}
                  datapoints={datapoints}
                  mqttDevices={mqttDevices}
                  fetchData={fetchStaticData}
                  toast={toast}
                />
              )}
 
              {activeTab === 'buffer' && (
                <BufferTab
                  bufferTelemetry={bufferTelemetry}
                  bufferEvents={bufferEvents}
                />
              )}
 
              {activeTab === 'settings' && (
                <SettingsTab
                  dashboard={dashboard}
                  cloudEndpoint={cloudEndpoint}
                  setCloudEndpoint={setCloudEndpoint}
                  edgeSerial={edgeSerial}
                  setEdgeSerial={setEdgeSerial}
                  handleSaveSettings={handleSaveSettings}
                  pollingInterval={pollingInterval}
                  setPollingInterval={setPollingInterval}
                  maxLiveLogs={maxLiveLogs}
                  setMaxLiveLogs={setMaxLiveLogs}
                  telemetryWarningThreshold={telemetryWarningThreshold}
                  setTelemetryWarningThreshold={setTelemetryWarningThreshold}
                  eventWarningThreshold={eventWarningThreshold}
                  setEventWarningThreshold={setEventWarningThreshold}
                  showLiveFeedPanel={showLiveFeedPanel}
                  setShowLiveFeedPanel={setShowLiveFeedPanel}
                  showDiagnosticsPanel={showDiagnosticsPanel}
                  setShowDiagnosticsPanel={setShowDiagnosticsPanel}
                  handleFactoryReset={handleFactoryReset}
                />
              )}
            </>
          )}
        </div>

        <footer className="bottombar">
          <div className="bottombar-badge-group">
            {dashboard?.device.organizationName && dashboard.device.organizationName !== 'N/A' && (
              <div className="bottombar-node-badge">
                <span className="badge-label">ORG</span>
                <span className="badge-value">{dashboard.device.organizationName}</span>
              </div>
            )}

            {dashboard?.device.siteName && dashboard.device.siteName !== 'N/A' && (
              <div className="bottombar-node-badge">
                <span className="badge-label">SITE</span>
                <span className="badge-value">{dashboard.device.siteName}</span>
              </div>
            )}

            <div className="bottombar-node-badge">
              <span className="badge-label">NODE</span>
              <span className="badge-value">{edgeSerial}</span>
            </div>
          </div>
          
          <div className="bottombar-status">
            <div className="status-indicator">
              <div className={`pulse-dot ${isConnected ? '' : 'warning'}`} />
              <span>{isConnected ? 'Local Agent: Online' : 'Local Agent: Offline'}</span>
            </div>

            {isConnected && dashboard && (
              (() => {
                const cloudInfo = getCloudStatusInfo(dashboard.cloudStatus);
                return (
                  <div className="status-indicator status-indicator-divider">
                    <div className={`pulse-dot ${cloudInfo.className}`} />
                    <span>{cloudInfo.label}</span>
                  </div>
                );
              })()
            )}
            
            <button
              type="button"
              onClick={() => { setIsLoading(true); void fetchStaticData(); }}
              className="refresh-btn"
              title="Force Refresh Data"
              aria-label="Force refresh data"
            >
              <RefreshCw size={16} className={isLoading ? 'spin refresh-icon' : 'refresh-icon'} />
            </button>
          </div>
        </footer>
      </main>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

export default function App() {
  return (
    <EdgeProvider>
      <EdgeInner />
    </EdgeProvider>
  );
}
