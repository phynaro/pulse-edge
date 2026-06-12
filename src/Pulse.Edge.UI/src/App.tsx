import { useState, useEffect, useRef } from 'react';
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
  DashboardData, 
  DataSource, 
  DriverAdapter, 
  DataPoint, 
  DiagnosticData, 
  BufferTelemetryItem, 
  BufferEventItem,
  MqttDevice
} from './types';

import DashboardTab from './components/DashboardTab';
import DataSourcesTab from './components/DataSourcesTab';
import TagsTab from './components/TagsTab';
import ProtocolsTab from './components/ProtocolsTab';
import BufferTab from './components/BufferTab';
import SettingsTab from './components/SettingsTab';
import OnboardingWizard from './components/OnboardingWizard';

const formatToLocalTimeString = (dateStr: string | null | undefined) => {
  if (!dateStr) return '';
  let utcStr = dateStr;
  if (!utcStr.endsWith('Z') && !utcStr.includes('+') && !utcStr.includes('GMT')) {
    utcStr = utcStr.replace(' ', 'T') + 'Z';
  }
  return new Date(utcStr).toLocaleTimeString();
};

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

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'datasources' | 'tags' | 'protocols' | 'buffer' | 'settings'>('dashboard');
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // Dashboard APIs state
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [datasources, setDatasources] = useState<DataSource[]>([]);
  const [adapters, setAdapters] = useState<DriverAdapter[]>([]);
  const [datapoints, setDatapoints] = useState<DataPoint[]>([]);
  const [mqttDevices, setMqttDevices] = useState<MqttDevice[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticData | null>(null);
  const [isSyncEnabled, setIsSyncEnabled] = useState<boolean>(true);

  // SQLite Buffer lists
  const [bufferTelemetry, setBufferTelemetry] = useState<BufferTelemetryItem[]>([]);
  const [bufferEvents, setBufferEvents] = useState<BufferEventItem[]>([]);

  // Configurable UI settings states
  const [pollingInterval, setPollingInterval] = useState<number>(() => {
    const saved = localStorage.getItem('pulse_ui_polling_interval');
    return saved ? parseInt(saved, 10) : 3000;
  });
  const [maxLiveLogs, setMaxLiveLogs] = useState<number>(() => {
    const saved = localStorage.getItem('pulse_ui_max_live_logs');
    return saved ? parseInt(saved, 10) : 10;
  });
  const [telemetryWarningThreshold, setTelemetryWarningThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('pulse_ui_telemetry_threshold');
    return saved ? parseInt(saved, 10) : 10;
  });
  const [eventWarningThreshold, setEventWarningThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('pulse_ui_event_threshold');
    return saved ? parseInt(saved, 10) : 5;
  });
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState<boolean>(() => {
    const saved = localStorage.getItem('pulse_ui_show_diagnostics');
    return saved !== 'false';
  });
  const [showLiveFeedPanel, setShowLiveFeedPanel] = useState<boolean>(() => {
    const saved = localStorage.getItem('pulse_ui_show_live_feed');
    return saved !== 'false';
  });

  // Dynamic filter states for live feed
  const [telemetryFilterQuery, setTelemetryFilterQuery] = useState('');
  const [telemetryFilterType, setTelemetryFilterType] = useState('All');

  // Live feed log cache
  const [liveFeed, setLiveFeed] = useState<{ time: string; source: string; payload: string }[]>([]);

  // Settings State
  const hasInitializedSettingsRef = useRef(false);
  const [cloudEndpoint, setCloudEndpoint] = useState<string>('');
  const [edgeSerial, setEdgeSerial] = useState<string>('');
  const [isOnboarded, setIsOnboarded] = useState<boolean>(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  };

  const fetchData = async () => {
    try {
      const [dashRes, dsRes, adaptersRes, dpRes, diagRes, syncRes, teleBufferRes, eventBufferRes, settingsRes, mqttRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/datasources'),
        fetch('/api/adapters'),
        fetch('/api/datapoints'),
        fetch('/api/diagnostics'),
        fetch('/api/settings/sync-status'),
        fetch('/api/buffer/telemetry'),
        fetch('/api/buffer/events'),
        fetch('/api/settings'),
        fetch('/api/mqtt-devices')
      ]);

      if (!dashRes.ok || !dsRes.ok || !adaptersRes.ok || !dpRes.ok || !diagRes.ok || !syncRes.ok || !teleBufferRes.ok || !eventBufferRes.ok || !settingsRes.ok || !mqttRes.ok) {
        throw new Error('API fetch failed');
      }

      const dashData: DashboardData = await dashRes.json();
      const dsData: DataSource[] = await dsRes.json();
      const adaptersData: DriverAdapter[] = await adaptersRes.json();
      const dpData: DataPoint[] = await dpRes.json();
      const diagData: DiagnosticData = await diagRes.json();
      const syncData = await syncRes.json();
      const teleBufferData: BufferTelemetryItem[] = await teleBufferRes.json();
      const eventBufferData: BufferEventItem[] = await eventBufferRes.json();
      const settingsData = await settingsRes.json();
      const mqttData: MqttDevice[] = await mqttRes.json();

      setDashboard(dashData);
      if (!hasInitializedSettingsRef.current) {
        setCloudEndpoint(settingsData.cloudEndpoint || 'http://localhost:3000');
        setEdgeSerial(settingsData.serialNumber || '');
        const hasApiKey = settingsData.apiKey && settingsData.apiKey !== 'None';
        setIsOnboarded(!!settingsData.serialNumber && hasApiKey);
        hasInitializedSettingsRef.current = true;
      }
      setDatasources(dsData);
      setAdapters(adaptersData);
      setDatapoints(dpData);
      setMqttDevices(mqttData);
      setDiagnostics(diagData);
      setIsSyncEnabled(syncData.isSyncEnabled);
      setBufferTelemetry(teleBufferData);
      setBufferEvents(eventBufferData);
      setIsConnected(true);

      // Extract telemetry from dashboard updates to maintain a live feed history
      if (dashData && isConnected) {
        if (teleBufferData.length > 0) {
          const latest = teleBufferData[0];
          setLiveFeed(prev => {
            const formattedTime = formatToLocalTimeString(latest.timestamp);
            const isDuplicate = prev.some(x => x.time === formattedTime && x.payload === latest.metricsJson);
            if (isDuplicate) return prev;
            
            const newEntry = {
              time: formattedTime,
              source: latest.dataSourceId,
              payload: latest.metricsJson
            };
            return [newEntry, ...prev.slice(0, 99)];
          });
        }
      }
    } catch (error) {
      console.error('Failed to poll local Edge API:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const { toasts, removeToast, toast } = useToast();

  // Toggle Sync (Simulate cloud connection state)
  const handleToggleSync = async () => {
    try {
      const res = await fetch('/api/settings/toggle-sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIsSyncEnabled(data.isSyncEnabled);
        fetchData();
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
        fetchData();
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
        fetchData();
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
        fetchData();
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
        fetchData();
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
        void fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to save system settings.');
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      toast.error('An error occurred while saving settings.');
    }
  };


  // Poll API using user-configured polling interval
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
    const interval = setInterval(() => {
      void fetchData();
    }, pollingInterval);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollingInterval, isConnected]);

  // Persist UI config settings
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

  if (!isOnboarded) {
    return (
      <>
        <OnboardingWizard 
          toast={toast} 
          onComplete={() => { 
            hasInitializedSettingsRef.current = false;
            setIsOnboarded(true); 
            void fetchData(); 
          }} 
        />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar with expand/collapse toggle */}
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
            className={`menu-item ${activeTab === 'datasources' ? 'active' : ''}`}
            onClick={() => setActiveTab('datasources')}
            title={isSidebarCollapsed ? "Config Streams" : undefined}
          >
            <Database size={18} />
            {!isSidebarCollapsed && <span>Config Streams</span>}
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'tags' ? 'active' : ''}`}
            onClick={() => setActiveTab('tags')}
            title={isSidebarCollapsed ? "Physical Tags" : undefined}
          >
            <Tag size={18} />
            {!isSidebarCollapsed && <span>Physical Tags</span>}
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

      {/* Main Container */}
      <main className="main-content">
        {/* Sticky 60px Topbar */}
        <header className="topbar">
          <div className="topbar-badge-group">
            {dashboard?.device.organizationName && dashboard.device.organizationName !== 'N/A' && (
              <div className="topbar-node-badge">
                <span className="badge-label">ORG</span>
                <span className="badge-value">{dashboard.device.organizationName}</span>
              </div>
            )}

            {dashboard?.device.siteName && dashboard.device.siteName !== 'N/A' && (
              <div className="topbar-node-badge">
                <span className="badge-label">SITE</span>
                <span className="badge-value">{dashboard.device.siteName}</span>
              </div>
            )}

            <div className="topbar-node-badge">
              <span className="badge-label">NODE</span>
              <span className="badge-value">{edgeSerial}</span>
            </div>
          </div>
          
          <div className="topbar-status">
            {/* Daemon Local connection */}
            <div className="status-indicator">
              <div className={`pulse-dot ${isConnected ? '' : 'warning'}`} />
              <span>{isConnected ? 'Local Agent: Online' : 'Local Agent: Offline'}</span>
            </div>

            {/* Edge-to-Cloud Link connection */}
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
              onClick={() => { setIsLoading(true); fetchData(); }}
              className="refresh-btn"
              title="Force Refresh Data"
              aria-label="Force refresh data"
            >
              <RefreshCw size={16} className={isLoading ? 'spin refresh-icon' : 'refresh-icon'} />
            </button>
          </div>
        </header>

        {/* Scrollable Dashboard Panel */}
        <div className="content-area">
          {/* Simulated Cloud Outage Warning Banner */}
          {!isSyncEnabled && (
            <div className="banner-warning">
              <AlertTriangle size={20} />
              <span>
                <strong>Simulated Cloud Outage:</strong> Synchronization loop is currently paused. Telemetry packets are building up in the SQLite database queue buffer.
              </span>
            </div>
          )}

          {isLoading && !dashboard ? (
            <div className="loading-center">
              Loading edge statistics...
            </div>
          ) : (
            <>
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
                  fetchData={fetchData}
                  toast={toast}
                />
              )}

              {activeTab === 'tags' && (
                <TagsTab
                  datapoints={datapoints}
                  adapters={adapters}
                  mqttDevices={mqttDevices}
                  handleDeleteDataPoint={handleDeleteDataPoint}
                  fetchData={fetchData}
                  toast={toast}
                />
              )}

              {activeTab === 'protocols' && (
                <ProtocolsTab
                  adapters={adapters}
                  datapoints={datapoints}
                  mqttDevices={mqttDevices}
                  fetchData={fetchData}
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
                />
              )}
            </>
          )}
        </div>
      </main>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
