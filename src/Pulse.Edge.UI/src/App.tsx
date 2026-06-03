import { useState, useEffect } from 'react';
import { 
  Activity, 
  Database, 
  Network, 
  Cpu, 
  Settings as SettingsIcon, 
  RefreshCw, 
  Layers,
  AlertTriangle,
  Play,
  Pause,
  Plus,
  Zap,
  BarChart3,
  Search,
  Tag,
  Trash2
} from 'lucide-react';

interface DashboardData {
  connectionStatus: string;
  cloudStatus: string;
  bufferStatus: string;
  version: string;
  lastSync: string;
  device: {
    deviceId: string;
    serialNumber: string;
    siteId: string;
    apiKey: string;
  };
  queue: {
    pendingTelemetry: number;
    pendingEvents: number;
  };
}

interface DataSource {
  id: string;
  name: string;
  type: string;
  status: string;
  dataRate: string;
  address: string;
}

interface DriverAdapter {
  id: string;
  name: string;
  protocol: string; // "OPC_UA", "MODBUS_TCP", "MQTT"
  host: string;
  port: number;
  configJson: string;
  isEnabled: boolean;
  status: string; // "Connected", "Offline", "Error"
}

interface DataSource {
  id: string;
  name: string;
  type: string; // "Production" | "Energy" | "General"
  description: string;
  isEnabled: boolean;
}

interface DataPoint {
  id: string;
  adapterId: string;
  dataSourceId: string | null;
  metric: string | null;
  address: string; // tag / register / topic
  dataType: string;
  scanIntervalMs: number;
  scaleFactor: number;
  offset: number;
  isEnabled: boolean;
  lastValue?: string | null;
  lastError?: string | null;
  lastUpdated?: string | null;
}

interface DiagnosticData {
  cpuUsage: string;
  memoryUsage: string;
  diskSpace: string;
  uptime: string;
}

interface BufferTelemetryItem {
  id: number;
  dataSourceId: string;
  payloadJson: string;
  timestamp: string;
  retryCount: number;
  isSending: boolean;
}

interface BufferEventItem {
  id: number;
  eventType: string;
  payloadJson: string;
  timestamp: string;
  retryCount: number;
  isSending: boolean;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'datasources' | 'tags' | 'protocols' | 'buffer' | 'settings'>('dashboard');
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // Dashboard APIs state
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [datasources, setDatasources] = useState<DataSource[]>([]);
  const [adapters, setAdapters] = useState<DriverAdapter[]>([]);
  const [datapoints, setDatapoints] = useState<DataPoint[]>([]);
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

  // Dynamic filter states
  const [telemetryFilterQuery, setTelemetryFilterQuery] = useState('');
  const [telemetryFilterType, setTelemetryFilterType] = useState('All');
  const [streamSearchQuery, setStreamSearchQuery] = useState('');
  const [streamTypeFilter, setStreamTypeFilter] = useState('All');

  // Protocol config editing states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAdapterName, setEditAdapterName] = useState('');
  const [editAdapterProtocol, setEditAdapterProtocol] = useState('MQTT');
  const [editAdapterHost, setEditAdapterHost] = useState('');
  const [editAdapterPort, setEditAdapterPort] = useState(1883);
  const [editAdapterConfigJson, setEditAdapterConfigJson] = useState('{}');
  const [editAdapterIsEnabled, setEditAdapterIsEnabled] = useState(true);

  // New Data Source Form State
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceId, setNewSourceId] = useState('');
  const [newSourceType, setNewSourceType] = useState('General'); // "Production" | "Energy" | "General"
  const [newSourceDescription, setNewSourceDescription] = useState('');

  // New Data Point Form State
  const [newDpAdapterId, setNewDpAdapterId] = useState('');
  const [newDpDataSourceId, setNewDpDataSourceId] = useState('');
  const [newDpMetric, setNewDpMetric] = useState('');
  const [newDpAddress, setNewDpAddress] = useState('');
  const [newDpDataType, setNewDpDataType] = useState('Float');
  const [newDpScanIntervalMs, setNewDpScanIntervalMs] = useState(1000);
  const [newDpScaleFactor, setNewDpScaleFactor] = useState(1.0);
  const [newDpOffset, setNewDpOffset] = useState(0.0);

  // Modals Visibility
  const [isCreateSourceOpen, setIsCreateSourceOpen] = useState(false);
  const [isAddPointOpen, setIsAddPointOpen] = useState(false);
  const [deletingDp, setDeletingDp] = useState<DataPoint | null>(null);
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState('');
  const [deletingPhysicalTag, setDeletingPhysicalTag] = useState<DataPoint | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState('');
  const [tagProtocolFilter, setTagProtocolFilter] = useState('All');
  
  // Adapter Modals and Form State
  const [deletingAdapter, setDeletingAdapter] = useState<DriverAdapter | null>(null);
  const [isCreateAdapterOpen, setIsCreateAdapterOpen] = useState(false);
  const [newAdapterName, setNewAdapterName] = useState('');
  const [newAdapterProtocol, setNewAdapterProtocol] = useState('OPC_UA');
  const [newAdapterHost, setNewAdapterHost] = useState('');
  const [newAdapterPort, setNewAdapterPort] = useState(4840);
  const [newAdapterConfigJson, setNewAdapterConfigJson] = useState('{"SecurityMode": "None"}');

  const startEdit = (proto: DriverAdapter) => {
    setEditingId(proto.id);
    setEditAdapterName(proto.name);
    setEditAdapterProtocol(proto.protocol);
    setEditAdapterHost(proto.host);
    setEditAdapterPort(proto.port);
    setEditAdapterConfigJson(proto.configJson);
    setEditAdapterIsEnabled(proto.isEnabled);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveProtocol = async (id: string) => {
    try {
      const updated = {
        id,
        name: editAdapterName,
        protocol: editAdapterProtocol,
        host: editAdapterHost,
        port: editAdapterPort,
        configJson: editAdapterConfigJson,
        isEnabled: editAdapterIsEnabled,
        status: adapters.find(x => x.id === id)?.status ?? 'Disconnected'
      };

      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      if (res.ok) {
        alert("Driver configuration saved successfully! The background C# Edge Agent will automatically reload and apply these connection settings in real-time (within 5 seconds).");
        setEditingId(null);
        fetchData();
      }
    } catch (e) {
      console.error('Failed to save connection adapter:', e);
      alert('Error saving configuration');
    }
  };

  const handleAddDataSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName || !newSourceId) return;

    try {
      const payload = {
        id: newSourceId,
        name: newSourceName,
        type: newSourceType,
        description: newSourceDescription
      };

      const res = await fetch('/api/datasources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewSourceName('');
        setNewSourceId('');
        setNewSourceDescription('');
        setNewSourceType('General');
        setIsCreateSourceOpen(false);
        alert(`Successfully registered Data Source '${newSourceName}'!`);
        fetchData();
      }
    } catch (err) {
      console.error('Failed to create data source:', err);
      alert('Failed to create data source');
    }
  };

  const handleToggleStreamEnabled = async (ds: DataSource) => {
    try {
      const updated = {
        ...ds,
        isEnabled: !ds.isEnabled
      };

      const res = await fetch('/api/datasources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      if (res.ok) {
        fetchData();
      } else {
        alert("Failed to toggle stream state.");
      }
    } catch (err) {
      console.error('Error toggling stream state:', err);
      alert('Error toggling stream state');
    }
  };

  const handleAddDataPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTagId || !newDpDataSourceId || !newDpMetric) {
      alert("Please select a physical tag and specify a metric key.");
      return;
    }

    const tagToBind = datapoints.find(dp => dp.id === selectedTagId);
    if (!tagToBind) {
      alert("Selected physical tag not found.");
      return;
    }

    try {
      const payload = {
        ...tagToBind,
        dataSourceId: newDpDataSourceId,
        metric: newDpMetric
      };

      const res = await fetch('/api/datapoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewDpMetric('');
        setSelectedTagId('');
        setIsAddPointOpen(false);
        alert("Successfully bound physical tag to metric!");
        fetchData();
      } else {
        alert("Failed to bind physical tag.");
      }
    } catch (err) {
      console.error('Failed to bind data point:', err);
      alert('Failed to bind data point');
    }
  };

  const handleCreatePhysicalTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDpAdapterId || !newDpAddress) {
      alert("Please fill in all required fields.");
      return;
    }

    try {
      const payload = {
        id: "", // Auto-generated UUID
        adapterId: newDpAdapterId,
        dataSourceId: "", // Unmapped by default
        metric: "", // Unmapped by default
        address: newDpAddress,
        dataType: newDpDataType,
        scanIntervalMs: Number(newDpScanIntervalMs),
        scaleFactor: Number(newDpScaleFactor),
        offset: Number(newDpOffset),
        isEnabled: true
      };

      const res = await fetch('/api/datapoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewDpAddress('');
        setIsCreateTagOpen(false);
        alert("Successfully registered physical tag!");
        fetchData();
      } else {
        alert("Failed to register physical tag.");
      }
    } catch (err) {
      console.error('Failed to create physical tag:', err);
      alert('Failed to create physical tag');
    }
  };

  const handleDeleteDataPoint = async (id: string) => {
    try {
      const res = await fetch(`/api/datapoints/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setDeletingDp(null);
        fetchData();
      } else {
        alert("Failed to unbind data point metric.");
      }
    } catch (err) {
      console.error('Failed to delete data point:', err);
      alert('Failed to delete data point');
    }
  };

  const handleHardDeleteDataPoint = async (id: string) => {
    try {
      const res = await fetch(`/api/datapoints/hard/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setDeletingPhysicalTag(null);
        fetchData();
      } else {
        alert("Failed to delete physical tag.");
      }
    } catch (err) {
      console.error('Failed to delete physical tag:', err);
      alert('Failed to delete physical tag');
    }
  };

  const handleCreateAdapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdapterName || !newAdapterProtocol || !newAdapterHost) {
      alert("Please fill in all required fields.");
      return;
    }

    try {
      const payload = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'adapter-' + Math.random().toString(36).substring(2, 9),
        name: newAdapterName,
        protocol: newAdapterProtocol,
        host: newAdapterHost,
        port: Number(newAdapterPort),
        configJson: newAdapterConfigJson,
        isEnabled: true,
        status: 'Offline'
      };

      const res = await fetch('/api/adapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setNewAdapterName('');
        setNewAdapterProtocol('OPC_UA');
        setNewAdapterHost('');
        setNewAdapterPort(4840);
        setNewAdapterConfigJson('{"SecurityMode": "None"}');
        setIsCreateAdapterOpen(false);
        alert("Successfully created new protocol adapter!");
        fetchData();
      } else {
        alert("Failed to create protocol adapter.");
      }
    } catch (err) {
      console.error('Failed to create adapter:', err);
      alert('Failed to create adapter');
    }
  };

  const handleDeleteAdapter = async (id: string) => {
    try {
      const res = await fetch(`/api/adapters/${id}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        setDeletingAdapter(null);
        alert("Successfully deleted protocol adapter and its bound metric tags!");
        fetchData();
      } else {
        alert("Failed to delete protocol adapter.");
      }
    } catch (err) {
      console.error('Failed to delete adapter:', err);
      alert('Failed to delete adapter');
    }
  };

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

  // Rolling Live feed (retains up to 100 entries in memory cache)
  const [liveFeed, setLiveFeed] = useState<{ time: string; source: string; payload: string }[]>([]);



  // Settings State
  const [cloudEndpoint, setCloudEndpoint] = useState<string>('https://api.pulse-industrial.cloud');
  const [edgeSerial, setEdgeSerial] = useState<string>('PULSE-EDGE-MOCK-999');

  const fetchData = async () => {
    try {
      const [dashRes, dsRes, adaptersRes, dpRes, diagRes, syncRes, teleBufferRes, eventBufferRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/datasources'),
        fetch('/api/adapters'),
        fetch('/api/datapoints'),
        fetch('/api/diagnostics'),
        fetch('/api/settings/sync-status'),
        fetch('/api/buffer/telemetry'),
        fetch('/api/buffer/events')
      ]);

      if (!dashRes.ok || !dsRes.ok || !adaptersRes.ok || !dpRes.ok || !diagRes.ok || !syncRes.ok || !teleBufferRes.ok || !eventBufferRes.ok) {
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

      setDashboard(dashData);
      setDatasources(dsData);
      setAdapters(adaptersData);
      setDatapoints(dpData);
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
            const isDuplicate = prev.some(x => x.time === new Date(latest.timestamp).toLocaleTimeString() && x.payload === latest.payloadJson);
            if (isDuplicate) return prev;
            
            const newEntry = {
              time: new Date(latest.timestamp).toLocaleTimeString(),
              source: latest.dataSourceId,
              payload: latest.payloadJson
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

  // Poll API using user-configured polling interval
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, pollingInterval);
    return () => clearInterval(interval);
  }, [pollingInterval, isConnected]);

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
    <div className="app-container">
      {/* 240px Fixed Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            PULSE <span>EDGE</span>
          </div>
        </div>
        
        <nav className="sidebar-menu">
          <button 
            className={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={18} />
            Dashboard
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'datasources' ? 'active' : ''}`}
            onClick={() => setActiveTab('datasources')}
          >
            <Database size={18} />
            Config Streams
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'tags' ? 'active' : ''}`}
            onClick={() => setActiveTab('tags')}
          >
            <Tag size={18} />
            Physical Tags
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'protocols' ? 'active' : ''}`}
            onClick={() => setActiveTab('protocols')}
          >
            <Network size={18} />
            Protocols
          </button>

          <button 
            className={`menu-item ${activeTab === 'buffer' ? 'active' : ''}`}
            onClick={() => setActiveTab('buffer')}
          >
            <Layers size={18} />
            Buffer Explorer ({bufferTelemetry.length + bufferEvents.length})
          </button>
          
          <button 
            className={`menu-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <SettingsIcon size={18} />
            Settings
          </button>
        </nav>
        
        <div className="sidebar-footer">
          <div>AGENT V{dashboard?.version || '1.0.0'}</div>
          <div style={{ marginTop: '4px', fontSize: '10px' }}>DB Status: SQLite WAL</div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="main-content">
        {/* Sticky 60px Topbar */}
        <header className="topbar">
          <h1 className="topbar-title">
            {activeTab === 'dashboard' && 'Edge Node Health Summary'}
            {activeTab === 'datasources' && 'Configure Telemetry Data Streams'}
            {activeTab === 'tags' && 'Physical Data Points & Tag Registry'}
            {activeTab === 'protocols' && 'Protocol Driver Adapters'}
            {activeTab === 'buffer' && 'SQLite Store-and-Forward Database Buffer'}
            {activeTab === 'settings' && 'Edge Agent Settings'}
          </h1>
          
          <div className="topbar-status">
            <div className="status-indicator">
              <div className={`pulse-dot ${isConnected ? '' : 'warning'}`} />
              <span>{isConnected ? 'Daemon Connected' : 'Daemon Offline'}</span>
            </div>
            
            <button 
              onClick={() => { setIsLoading(true); fetchData(); }} 
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Force Refresh Data"
            >
              <RefreshCw size={16} className={isLoading ? 'spin' : ''} style={{ transition: 'transform 0.5s' }} />
            </button>
          </div>
        </header>

        {/* Scrollable Dashboard Panel */}
        <div className="content-area">
          {/* Simulated Cloud Outage Warning Banner */}
          {!isSyncEnabled && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              backgroundColor: '#feebc8',
              border: '1px solid #ecc94b',
              color: '#744210',
              padding: '16px 24px',
              borderRadius: '8px',
              marginBottom: '24px',
              fontWeight: 500,
              fontSize: '14px'
            }}>
              <AlertTriangle size={20} />
              <span>
                <strong>Simulated Cloud Outage:</strong> Synchronization loop is currently paused. Telemetry packets are building up in the SQLite database queue buffer.
              </span>
            </div>
          )}

          {isLoading && !dashboard ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', fontFamily: 'var(--font-mono)' }}>
              Loading edge statistics...
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <>
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
                            <div>
                              <select 
                                className="form-input"
                                style={{ padding: '6px 10px', fontSize: '12px', height: '32px' }}
                                value={telemetryFilterType}
                                onChange={(e) => setTelemetryFilterType(e.target.value)}
                              >
                                <option value="All">All Protocols</option>
                                <option value="OPC UA">OPC UA</option>
                                <option value="MQTT">MQTT</option>
                                <option value="Modbus TCP">Modbus TCP</option>
                              </select>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                              <span>Limit:</span>
                              <select 
                                className="form-input"
                                style={{ padding: '4px 8px', fontSize: '12px', height: '32px', width: '70px' }}
                                value={maxLiveLogs}
                                onChange={(e) => setMaxLiveLogs(parseInt(e.target.value, 10))}
                              >
                                <option value={5}>5</option>
                                <option value={10}>10</option>
                                <option value={15}>15</option>
                                <option value={20}>20</option>
                                <option value={30}>30</option>
                              </select>
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
              )}

{activeTab === 'datasources' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Top Header Card */}
                  <div style={{
                    background: 'linear-gradient(135deg, #1e202c 0%, #111218 100%)',
                    borderRadius: '16px',
                    padding: '24px 32px',
                    color: '#ffffff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    {/* Background abstract decoration */}
                    <div style={{
                      position: 'absolute',
                      right: '-10%',
                      top: '-50%',
                      width: '300px',
                      height: '300px',
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, rgba(60,232,189,0.15) 0%, rgba(0,0,0,0) 70%)',
                      pointerEvents: 'none'
                    }} />
                    
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <Database size={24} style={{ color: 'var(--primary-color)' }} />
                        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '0.5px' }}>Telemetry Data Streams</h2>
                      </div>
                      <p style={{ margin: 0, fontSize: '13px', color: '#a0aec0', maxWidth: '500px' }}>
                        Decouple edge raw telemetry signals from cloud business context. Configure connection metrics under logical stream channels.
                      </p>
                    </div>

                    <button 
                      onClick={() => {
                        setNewSourceId('DS' + String(datasources.length + 1).padStart(3, '0'));
                        setIsCreateSourceOpen(true);
                      }}
                      style={{
                        backgroundColor: 'var(--primary-color)',
                        color: 'var(--sidebar-bg)',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 14px var(--primary-glow)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(60, 232, 189, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = '0 4px 14px var(--primary-glow)';
                      }}
                    >
                      <Plus size={18} />
                      Create Data Source
                    </button>
                  </div>

                  {/* Summary Cards Row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '16px'
                  }}>
                    <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ backgroundColor: 'rgba(60,232,189,0.1)', padding: '10px', borderRadius: '10px', color: 'var(--primary-dark)' }}>
                        <Database size={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Streams</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datasources.length}</div>
                      </div>
                    </div>
                    
                    <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ backgroundColor: 'rgba(66,153,225,0.1)', padding: '10px', borderRadius: '10px', color: '#3182ce' }}>
                        <Tag size={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Bound Metrics</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datapoints.length}</div>
                      </div>
                    </div>

                    <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ backgroundColor: 'rgba(237,137,54,0.1)', padding: '10px', borderRadius: '10px', color: '#dd6b20' }}>
                        <Zap size={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Energy Streams</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datasources.filter(x => x.type === 'Energy').length}</div>
                      </div>
                    </div>

                    <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ backgroundColor: 'rgba(72,187,120,0.1)', padding: '10px', borderRadius: '10px', color: '#38a169' }}>
                        <BarChart3 size={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Production Streams</div>
                        <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{datasources.filter(x => x.type === 'Production').length}</div>
                      </div>
                    </div>
                  </div>

                  {/* Rearranged Filter Bar */}
                  <div className="panel" style={{
                    padding: '16px 20px',
                    margin: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 300px' }}>
                      <div style={{ position: 'relative', width: '100%' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input
                          type="text"
                          placeholder="Search streams by name, ID or description..."
                          value={streamSearchQuery}
                          onChange={(e) => setStreamSearchQuery(e.target.value)}
                          className="form-input"
                          style={{ paddingLeft: '36px', height: '40px', backgroundColor: '#ffffff' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
                      {['All', 'Production', 'Energy', 'General'].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setStreamTypeFilter(cat)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '20px',
                            border: '1px solid',
                            borderColor: streamTypeFilter === cat ? 'transparent' : 'var(--border-color)',
                            backgroundColor: streamTypeFilter === cat ? 'var(--sidebar-bg)' : '#ffffff',
                            color: streamTypeFilter === cat ? '#ffffff' : 'var(--text-secondary)',
                            fontWeight: 600,
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {cat === 'All' ? 'All Categories' : cat === 'Production' ? 'Production (OEE)' : cat === 'Energy' ? 'Energy' : 'General'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Logical Data Sources Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                    gap: '24px'
                  }}>
                    {datasources.filter(ds => {
                      const matchesSearch = ds.name.toLowerCase().includes(streamSearchQuery.toLowerCase()) || 
                                            ds.id.toLowerCase().includes(streamSearchQuery.toLowerCase()) ||
                                            (ds.description && ds.description.toLowerCase().includes(streamSearchQuery.toLowerCase()));
                      const matchesType = streamTypeFilter === 'All' || ds.type === streamTypeFilter;
                      return matchesSearch && matchesType;
                    }).length === 0 ? (
                      <div className="panel" style={{
                        gridColumn: '1 / -1',
                        padding: '60px 40px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        backgroundColor: 'rgba(255, 255, 255, 0.5)',
                        borderStyle: 'dashed',
                        borderWidth: '2px',
                        borderRadius: '12px'
                      }}>
                        <div style={{ fontSize: '32px', marginBottom: '12px' }}>📭</div>
                        <h4 style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text-primary)' }}>No Matching Data Sources Found</h4>
                        <p style={{ margin: 0, fontSize: '13px' }}>
                          Try clearing filters or click "Create Data Source" to establish a new telemetry path.
                        </p>
                      </div>
                    ) : (
                      datasources
                        .filter(ds => {
                          const matchesSearch = ds.name.toLowerCase().includes(streamSearchQuery.toLowerCase()) || 
                                                ds.id.toLowerCase().includes(streamSearchQuery.toLowerCase()) ||
                                                (ds.description && ds.description.toLowerCase().includes(streamSearchQuery.toLowerCase()));
                          const matchesType = streamTypeFilter === 'All' || ds.type === streamTypeFilter;
                          return matchesSearch && matchesType;
                        })
                        .map((ds) => {
                          const dsPoints = datapoints.filter(dp => dp.dataSourceId === ds.id);
                          
                          // Custom color coding based on type
                          const themeColor = ds.type === 'Production' ? 'var(--primary-dark)' :
                                             ds.type === 'Energy' ? '#dd6b20' : '#3182ce';
                          const themeBg = ds.type === 'Production' ? 'rgba(60, 232, 189, 0.08)' :
                                           ds.type === 'Energy' ? 'rgba(237, 137, 54, 0.08)' : 'rgba(66, 153, 225, 0.08)';
                          const badgeClass = ds.type === 'Production' ? 'badge success' :
                                             ds.type === 'Energy' ? 'badge warning' : 'badge info';

                          return (
                            <div className="panel" key={ds.id} style={{
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              minHeight: '340px',
                              margin: 0,
                              position: 'relative',
                              padding: '28px',
                              borderTop: ds.isEnabled ? `4px solid ${themeColor}` : `4px solid #cbd5e0`,
                              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)',
                              transition: 'transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                              backgroundColor: ds.isEnabled ? '#ffffff' : '#fafbfc',
                              opacity: ds.isEnabled ? 1 : 0.85
                            }}
                            onMouseEnter={(e) => {
                              if (ds.isEnabled) {
                                e.currentTarget.style.transform = 'translateY(-3px)';
                                e.currentTarget.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.06)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'none';
                              e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.03)';
                            }}
                            >
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                                  <div>
                                    <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: ds.isEnabled ? 'var(--text-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {ds.name}
                                    </h3>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginTop: '3px' }}>
                                      STREAM ID: {ds.id}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span className={ds.isEnabled ? badgeClass : 'badge'} style={{ fontSize: '10px', padding: '4px 10px', borderRadius: '12px', backgroundColor: ds.isEnabled ? undefined : '#e2e8f0', color: ds.isEnabled ? undefined : '#718096' }}>
                                      {ds.isEnabled ? (ds.type === 'Production' ? 'Production (OEE)' : ds.type === 'Energy' ? 'Energy' : 'General') : 'Paused'}
                                    </span>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} title={ds.isEnabled ? "Pause Telemetry Stream" : "Resume Telemetry Stream"}>
                                      <input 
                                        type="checkbox" 
                                        checked={ds.isEnabled} 
                                        onChange={() => handleToggleStreamEnabled(ds)}
                                        style={{ width: '15px', height: '15px', accentColor: themeColor, cursor: 'pointer' }}
                                      />
                                    </label>
                                  </div>
                                </div>

                                {ds.description ? (
                                  <p style={{
                                    margin: '0 0 20px 0',
                                    fontSize: '13px',
                                    color: 'var(--text-secondary)',
                                    lineHeight: '1.4',
                                    padding: '8px 12px',
                                    backgroundColor: 'var(--bg-color)',
                                    borderRadius: '6px',
                                    borderLeft: `2px solid ${themeColor}`
                                  }}>
                                    {ds.description}
                                  </p>
                                ) : (
                                  <div style={{ height: '12px' }} />
                                )}

                                <div style={{ marginTop: '16px' }}>
                                  <h4 style={{
                                    margin: '0 0 12px 0',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.75px',
                                    color: 'var(--text-secondary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                  }}>
                                    <span>Bound Metric Tags</span>
                                    <span style={{
                                      fontFamily: 'var(--font-mono)',
                                      backgroundColor: 'var(--bg-color)',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      fontSize: '10px'
                                    }}>{dsPoints.length} active</span>
                                  </h4>
                                  
                                  {dsPoints.length === 0 ? (
                                    <div style={{
                                      fontSize: '12px',
                                      color: 'var(--text-secondary)',
                                      padding: '20px 14px',
                                      backgroundColor: 'var(--bg-color)',
                                      borderRadius: '8px',
                                      textAlign: 'center',
                                      border: '1px dashed var(--border-color)'
                                    }}>
                                      No telemetry metric bound to this stream source.
                                    </div>
                                  ) : (
                                    <div style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '8px',
                                      maxHeight: '180px',
                                      overflowY: 'auto',
                                      paddingRight: '4px'
                                    }}>
                                      {dsPoints.map((dp) => {
                                        const adp = adapters.find(a => a.id === dp.adapterId);
                                        return (
                                          <div key={dp.id} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            backgroundColor: '#ffffff',
                                            border: '1px solid var(--border-color)',
                                            padding: '10px 12px',
                                            borderRadius: '8px',
                                            fontSize: '12px',
                                            transition: 'border-color 0.2s ease',
                                            boxShadow: '0 1px 2px rgba(0,0,0,0.01)'
                                          }}
                                          onMouseEnter={(e) => e.currentTarget.style.borderColor = themeColor}
                                          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                                          >
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5px' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                                                  {dp.metric}
                                                </span>
                                                {ds.isEnabled ? (
                                                  dp.lastError ? (
                                                    <span style={{ fontSize: '10px', color: '#e53e3e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }} title={dp.lastError}>
                                                      <span style={{ color: '#e53e3e', fontSize: '12px' }}>●</span> Err
                                                    </span>
                                                  ) : dp.lastValue !== null && dp.lastValue !== undefined ? (
                                                    <span style={{ fontSize: '10px', color: '#38a169', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                      <span style={{ color: '#48bb78', fontSize: '12px' }}>●</span> {dp.lastValue}
                                                    </span>
                                                  ) : (
                                                    <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                      <span style={{ color: '#cbd5e0', fontSize: '12px' }}>●</span> Wait...
                                                    </span>
                                                  )
                                                ) : (
                                                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                    <span style={{ color: '#cbd5e0', fontSize: '12px' }}>●</span> Paused
                                                  </span>
                                                )}
                                              </div>
                                              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                                Addr: {dp.address}
                                              </span>
                                            </div>
                                            
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                                                <span className="badge info" style={{ fontSize: '9px', padding: '2px 6px', fontWeight: 600, backgroundColor: 'rgba(18, 19, 26, 0.05)', color: 'var(--text-primary)' }}>
                                                  {adp ? `${adp.name} (${adp.protocol})` : 'Unknown'}
                                                </span>
                                                <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                                                  {dp.dataType} ({dp.scanIntervalMs}ms)
                                                </span>
                                              </div>
                                              <button 
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setDeletingDp(dp);
                                                }}
                                                title="Unbind Metric"
                                                style={{
                                                  background: 'transparent',
                                                  border: 'none',
                                                  cursor: 'pointer',
                                                  color: 'var(--text-secondary)',
                                                  padding: '6px',
                                                  borderRadius: '6px',
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  justifyContent: 'center',
                                                  transition: 'all 0.2s ease',
                                                }}
                                                onMouseEnter={(e) => {
                                                  e.currentTarget.style.color = '#ef4444';
                                                  e.currentTarget.style.backgroundColor = '#fef2f2';
                                                }}
                                                onMouseLeave={(e) => {
                                                  e.currentTarget.style.color = 'var(--text-secondary)';
                                                  e.currentTarget.style.backgroundColor = 'transparent';
                                                }}
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <button 
                                onClick={() => { 
                                  setNewDpDataSourceId(ds.id); 
                                  setNewDpMetric('');
                                  setNewDpAddress('');
                                  // Auto-select adapter if only one exists, or choose the first one
                                  if (adapters.length > 0) {
                                    setNewDpAdapterId(adapters[0].id);
                                  } else {
                                    setNewDpAdapterId('');
                                  }
                                  setIsAddPointOpen(true); 
                                }}
                                style={{
                                  marginTop: '20px',
                                  width: '100%',
                                  backgroundColor: themeBg,
                                  color: themeColor,
                                  border: `1px solid rgba(60, 232, 189, 0.0)`,
                                  borderColor: ds.type === 'Production' ? 'rgba(60, 232, 189, 0.2)' :
                                               ds.type === 'Energy' ? 'rgba(237, 137, 54, 0.2)' : 'rgba(66, 153, 225, 0.2)',
                                  padding: '10px 14px',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '6px',
                                  transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = themeColor;
                                  e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = themeBg;
                                  e.currentTarget.style.color = themeColor;
                                }}
                              >
                                <Plus size={14} />
                                Add Metric
                              </button>
                            </div>
                          );
                        })
                    )}
                  </div>

                  {/* CREATE DATA SOURCE MODAL */}
                  {isCreateSourceOpen && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '520px',
                        maxWidth: '90%',
                        padding: '28px 36px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Create Immutable Data Source</h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Identify a new logical stream mapping on the Edge.</span>
                          </div>
                          <button 
                            onClick={() => setIsCreateSourceOpen(false)}
                            style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            &times;
                          </button>
                        </div>

                        <form onSubmit={handleAddDataSource} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                          
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '16px' }}>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>Data Source ID</label>
                              <input 
                                className="form-input" 
                                type="text" 
                                placeholder="e.g. DS003"
                                value={newSourceId}
                                onChange={(e) => setNewSourceId(e.target.value)}
                                required
                                style={{ fontWeight: 'bold', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
                              />
                            </div>

                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>Data Source Name</label>
                              <input 
                                className="form-input" 
                                type="text" 
                                placeholder="e.g. Conveyor Telemetry"
                                value={newSourceName}
                                onChange={(e) => setNewSourceName(e.target.value)}
                                required
                              />
                            </div>
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Stream Category (Type)</label>
                            
                            {/* Visually stunning type selector buttons */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '6px' }}>
                              {[
                                { val: 'Production', label: 'Production', desc: 'OEE & Counts', icon: <BarChart3 size={16} />, color: 'var(--primary-dark)', bg: 'rgba(60,232,189,0.08)' },
                                { val: 'Energy', label: 'Energy', desc: 'Power Meters', icon: <Zap size={16} />, color: '#dd6b20', bg: 'rgba(237,137,54,0.08)' },
                                { val: 'General', label: 'General', desc: 'Other Telemetry', icon: <Database size={16} />, color: '#3182ce', bg: 'rgba(66,153,225,0.08)' }
                              ].map(t => {
                                const isSelected = newSourceType === t.val;
                                return (
                                  <button
                                    key={t.val}
                                    type="button"
                                    onClick={() => setNewSourceType(t.val)}
                                    style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      padding: '12px 8px',
                                      borderRadius: '10px',
                                      border: '2px solid',
                                      borderColor: isSelected ? t.color : 'var(--border-color)',
                                      backgroundColor: isSelected ? t.bg : '#ffffff',
                                      color: isSelected ? t.color : 'var(--text-secondary)',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s ease',
                                      textAlign: 'center'
                                    }}
                                  >
                                    <div style={{ marginBottom: '6px', color: isSelected ? t.color : 'var(--text-secondary)' }}>{t.icon}</div>
                                    <div style={{ fontWeight: 700, fontSize: '12px' }}>{t.label}</div>
                                    <div style={{ fontSize: '9px', opacity: 0.8, marginTop: '2px' }}>{t.desc}</div>
                                  </button>
                                );
                              })}
                            </div>
                            
                            {/* Hidden fallback select for standard form compliance */}
                            <select 
                              value={newSourceType}
                              onChange={(e) => setNewSourceType(e.target.value)}
                              style={{ display: 'none' }}
                            >
                              <option value="Production">Production</option>
                              <option value="Energy">Energy</option>
                              <option value="General">General</option>
                            </select>
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Description</label>
                            <textarea 
                              className="form-input" 
                              style={{ minHeight: '80px', resize: 'vertical' }}
                              placeholder="Describe the location/system this stream reads from..."
                              value={newSourceDescription}
                              onChange={(e) => setNewSourceDescription(e.target.value)}
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                            <button 
                              type="submit"
                              style={{
                                flex: 2,
                                backgroundColor: 'var(--primary-color)',
                                color: 'var(--sidebar-bg)',
                                border: 'none',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 4px 10px var(--primary-glow)'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 6px 14px rgba(60, 232, 189, 0.4)'}
                              onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 4px 10px var(--primary-glow)'}
                            >
                              Create Stream
                            </button>
                            <button 
                              type="button"
                              onClick={() => setIsCreateSourceOpen(false)}
                              style={{
                                flex: 1,
                                backgroundColor: 'transparent',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* BIND METRIC POINT MODAL */}
                  {isAddPointOpen && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '540px',
                        maxWidth: '90%',
                        padding: '28px 36px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Bind Metric Tag</h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Establish a telemetry source driver tag mapping.</span>
                          </div>
                          <button 
                            onClick={() => setIsAddPointOpen(false)}
                            style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            &times;
                          </button>
                        </div>

                        {/* Readonly info header identifying the stream we are binding to */}
                        {(() => {
                          const activeDs = datasources.find(x => x.id === newDpDataSourceId);
                          const themeColor = activeDs?.type === 'Production' ? 'var(--primary-dark)' :
                                             activeDs?.type === 'Energy' ? '#dd6b20' : '#3182ce';
                          const themeBg = activeDs?.type === 'Production' ? 'rgba(60, 232, 189, 0.08)' :
                                           activeDs?.type === 'Energy' ? 'rgba(237, 137, 54, 0.08)' : 'rgba(66, 153, 225, 0.08)';
                          return (
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: themeBg,
                              borderLeft: `4px solid ${themeColor}`,
                              padding: '12px 16px',
                              borderRadius: '8px',
                              marginBottom: '20px'
                            }}>
                              <div>
                                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Target Stream</span>
                                <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>{activeDs?.name || newDpDataSourceId}</span>
                              </div>
                              <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: themeColor, backgroundColor: '#ffffff', padding: '3px 8px', borderRadius: '4px', border: `1px solid ${themeColor}33` }}>
                                ID: {newDpDataSourceId}
                              </span>
                            </div>
                          );
                        })()}

                        <form onSubmit={handleAddDataPoint} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Select Connection Tag</label>
                            {datapoints.length === 0 ? (
                              <div style={{ color: 'var(--danger-color)', fontSize: '12px', padding: '10px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fed7d7' }}>
                                No physical tags configured. Please configure tags under the "Physical Tags" tab first.
                              </div>
                            ) : (
                              <select 
                                className="form-input" 
                                value={selectedTagId}
                                onChange={(e) => setSelectedTagId(e.target.value)}
                                required
                                style={{ height: '40px', fontWeight: 600 }}
                              >
                                <option value="">-- Choose Physical Tag --</option>
                                {datapoints.map(dp => {
                                  const adp = adapters.find(a => a.id === dp.adapterId);
                                  const isMapped = dp.dataSourceId && dp.dataSourceId !== "";
                                  const mapStatus = isMapped ? `(Mapped to ${dp.dataSourceId} → ${dp.metric})` : "(Free)";
                                  return (
                                    <option key={dp.id} value={dp.id}>
                                      {dp.address} [{adp ? adp.name : 'Unknown'}] {mapStatus}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Metric Key (Identifier)</label>
                            <input 
                              className="form-input" 
                              type="text" 
                              placeholder="e.g. good_count, temperature, voltage"
                              value={newDpMetric}
                              onChange={(e) => setNewDpMetric(e.target.value)}
                              required
                              style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                            <button 
                              type="submit"
                              disabled={datapoints.length === 0 || !selectedTagId}
                              style={{
                                flex: 2,
                                backgroundColor: 'var(--sidebar-bg)',
                                color: '#ffffff',
                                border: 'none',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: (datapoints.length === 0 || !selectedTagId) ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s ease',
                                opacity: (datapoints.length === 0 || !selectedTagId) ? 0.6 : 1
                              }}
                              onMouseEnter={(e) => {
                                if (datapoints.length > 0 && selectedTagId) e.currentTarget.style.backgroundColor = '#1a1c23';
                              }}
                              onMouseLeave={(e) => {
                                if (datapoints.length > 0 && selectedTagId) e.currentTarget.style.backgroundColor = 'var(--sidebar-bg)';
                              }}
                            >
                              Bind Metric
                            </button>
                            <button 
                              type="button"
                              onClick={() => {
                                setIsAddPointOpen(false);
                                setSelectedTagId('');
                                setNewDpMetric('');
                              }}
                              style={{
                                flex: 1,
                                backgroundColor: 'transparent',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* DELETE CONFIRMATION MODAL */}
                  {deletingDp && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '480px',
                        maxWidth: '90%',
                        padding: '28px 36px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '20px' }}>
                          <div style={{
                            backgroundColor: '#fff5f5',
                            color: '#e53e3e',
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            <AlertTriangle size={20} />
                          </div>
                          <div>
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Unbind Telemetry Metric?</h3>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                              Are you sure you want to unbind the metric <strong style={{ color: 'var(--text-primary)' }}>{deletingDp.metric}</strong>?
                            </p>
                          </div>
                        </div>

                        <div style={{
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--border-color)',
                          padding: '12px 16px',
                          borderRadius: '8px',
                          marginBottom: '24px',
                          fontSize: '12px'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Source Address:</span>
                            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{deletingDp.address}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Data Type:</span>
                            <span style={{ fontWeight: 600 }}>{deletingDp.dataType} ({deletingDp.scanIntervalMs}ms)</span>
                          </div>
                        </div>

                        <div style={{
                          color: '#e53e3e',
                          backgroundColor: '#fff5f5',
                          border: '1px solid #fed7d7',
                          padding: '12px 14px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          marginBottom: '24px',
                          lineHeight: '1.4'
                        }}>
                          <strong>Warning:</strong> Telemetry ingestion and buffering for this physical address will stop immediately. This action cannot be undone.
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button 
                            onClick={() => handleDeleteDataPoint(deletingDp.id)}
                            style={{
                              flex: 1,
                              backgroundColor: '#e53e3e',
                              color: '#ffffff',
                              border: 'none',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#c53030'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e53e3e'}
                          >
                            Unbind Metric
                          </button>
                          <button 
                            onClick={() => setDeletingDp(null)}
                            style={{
                              flex: 1,
                              backgroundColor: 'transparent',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border-color)',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {activeTab === 'tags' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Top Header Card */}
                  <div style={{
                    background: 'linear-gradient(135deg, #1e202c 0%, #111218 100%)',
                    borderRadius: '16px',
                    padding: '24px 32px',
                    color: '#ffffff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      position: 'absolute',
                      right: '-10%',
                      top: '-50%',
                      width: '300px',
                      height: '300px',
                      borderRadius: '50%',
                      background: 'radial-gradient(circle, rgba(60,232,189,0.15) 0%, rgba(0,0,0,0) 70%)',
                      pointerEvents: 'none'
                    }} />
                    
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                        <Tag size={24} style={{ color: 'var(--primary-color)' }} />
                        <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '0.5px' }}>Physical Data Points & Tag Registry</h2>
                      </div>
                      <p style={{ margin: 0, fontSize: '13px', color: '#a0aec0', maxWidth: '500px' }}>
                        Define and test physical sensor points (PLC registers, MQTT topics) before binding them to data streams. Verify connection health with live values.
                      </p>
                    </div>

                    <button 
                      onClick={() => {
                        if (adapters.length > 0) {
                          setNewDpAdapterId(adapters[0].id);
                        } else {
                          setNewDpAdapterId('');
                        }
                        setNewDpAddress('');
                        setNewDpDataType('Float');
                        setNewDpScanIntervalMs(1000);
                        setNewDpScaleFactor(1.0);
                        setNewDpOffset(0.0);
                        setIsCreateTagOpen(true);
                      }}
                      style={{
                        backgroundColor: 'var(--primary-color)',
                        color: 'var(--sidebar-bg)',
                        border: 'none',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 14px var(--primary-glow)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(60, 232, 189, 0.4)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.boxShadow = '0 4px 14px var(--primary-glow)';
                      }}
                    >
                      <Plus size={18} />
                      Create Physical Tag
                    </button>
                  </div>

                  {/* Filter Bar */}
                  <div className="panel" style={{
                    padding: '16px 20px',
                    margin: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 300px' }}>
                      <div style={{ position: 'relative', width: '100%' }}>
                        <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input
                          type="text"
                          placeholder="Search tags by address or metric..."
                          value={tagSearchQuery}
                          onChange={(e) => setTagSearchQuery(e.target.value)}
                          className="form-input"
                          style={{ paddingLeft: '36px', height: '40px', backgroundColor: '#ffffff' }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
                      {['All', 'OPC UA', 'MQTT', 'Modbus TCP'].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setTagProtocolFilter(cat)}
                          style={{
                            padding: '8px 16px',
                            borderRadius: '20px',
                            border: '1px solid',
                            borderColor: tagProtocolFilter === cat ? 'transparent' : 'var(--border-color)',
                            backgroundColor: tagProtocolFilter === cat ? 'var(--sidebar-bg)' : '#ffffff',
                            color: tagProtocolFilter === cat ? '#ffffff' : 'var(--text-secondary)',
                            fontWeight: 600,
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {cat === 'All' ? 'All Protocols' : cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Physical Tags Grid */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                    gap: '24px'
                  }}>
                    {datapoints.filter(dp => {
                      const adp = adapters.find(a => a.id === dp.adapterId);
                      const matchesSearch = dp.address.toLowerCase().includes(tagSearchQuery.toLowerCase()) || 
                                            (dp.metric && dp.metric.toLowerCase().includes(tagSearchQuery.toLowerCase())) ||
                                            (dp.dataSourceId && dp.dataSourceId.toLowerCase().includes(tagSearchQuery.toLowerCase()));
                      
                      let matchesProto = true;
                      if (tagProtocolFilter !== 'All') {
                        if (tagProtocolFilter === 'OPC UA') matchesProto = adp?.protocol === 'OPC_UA';
                        else if (tagProtocolFilter === 'MQTT') matchesProto = adp?.protocol === 'MQTT';
                        else if (tagProtocolFilter === 'Modbus TCP') matchesProto = adp?.protocol === 'MODBUS_TCP';
                      }
                      return matchesSearch && matchesProto;
                    }).length === 0 ? (
                      <div className="panel" style={{
                        gridColumn: '1 / -1',
                        padding: '60px 40px',
                        textAlign: 'center',
                        color: 'var(--text-secondary)',
                        backgroundColor: 'rgba(255, 255, 255, 0.5)',
                        borderStyle: 'dashed',
                        borderWidth: '2px',
                        borderRadius: '12px'
                      }}>
                        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏷️</div>
                        <h4 style={{ margin: '0 0 4px 0', fontWeight: 700, color: 'var(--text-primary)' }}>No Physical Tags Found</h4>
                        <p style={{ margin: 0, fontSize: '13px' }}>
                          Try clearing filters or click "Create Physical Tag" to add a new sensor tag.
                        </p>
                      </div>
                    ) : (
                      datapoints
                        .filter(dp => {
                          const adp = adapters.find(a => a.id === dp.adapterId);
                          const matchesSearch = dp.address.toLowerCase().includes(tagSearchQuery.toLowerCase()) || 
                                                (dp.metric && dp.metric.toLowerCase().includes(tagSearchQuery.toLowerCase())) ||
                                                (dp.dataSourceId && dp.dataSourceId.toLowerCase().includes(tagSearchQuery.toLowerCase()));
                          
                          let matchesProto = true;
                          if (tagProtocolFilter !== 'All') {
                            if (tagProtocolFilter === 'OPC UA') matchesProto = adp?.protocol === 'OPC_UA';
                            else if (tagProtocolFilter === 'MQTT') matchesProto = adp?.protocol === 'MQTT';
                            else if (tagProtocolFilter === 'Modbus TCP') matchesProto = adp?.protocol === 'MODBUS_TCP';
                          }
                          return matchesSearch && matchesProto;
                        })
                        .map((dp) => {
                          const adp = adapters.find(a => a.id === dp.adapterId);
                          const isMapped = dp.dataSourceId && dp.dataSourceId !== "";
                          
                          return (
                            <div className="panel" key={dp.id} style={{
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                              minHeight: '220px',
                              margin: 0,
                              padding: '24px',
                              borderLeft: isMapped ? '4px solid var(--primary-dark)' : '4px solid #cbd5e0',
                              backgroundColor: '#ffffff',
                              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)',
                              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.transform = 'translateY(-2px)';
                              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.05)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.transform = 'none';
                              e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.03)';
                            }}
                            >
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                  <div>
                                    <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                      {adp ? `${adp.name} (${adp.protocol})` : 'Unknown Adapter'}
                                    </span>
                                    <h3 style={{ margin: '2px 0 0 0', fontSize: '15px', fontWeight: 800, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                                      {dp.address}
                                    </h3>
                                  </div>
                                  <button 
                                    onClick={() => setDeletingPhysicalTag(dp)}
                                    title="Delete Tag Configuration"
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: 'var(--text-secondary)',
                                      padding: '6px',
                                      borderRadius: '6px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      transition: 'all 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#ef4444';
                                      e.currentTarget.style.backgroundColor = '#fef2f2';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = 'var(--text-secondary)';
                                      e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px', fontSize: '12px' }}>
                                  <div>
                                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '10px' }}>DATA TYPE / SCAN</span>
                                    <span style={{ fontWeight: 600 }}>{dp.dataType} / {dp.scanIntervalMs}ms</span>
                                  </div>
                                  <div>
                                    <span style={{ color: 'var(--text-secondary)', display: 'block', fontSize: '10px' }}>SCALING / OFFSET</span>
                                    <span style={{ fontWeight: 600 }}>x{dp.scaleFactor} + {dp.offset}</span>
                                  </div>
                                </div>

                                <div style={{
                                  backgroundColor: 'var(--bg-color)',
                                  padding: '12px 14px',
                                  borderRadius: '8px',
                                  fontSize: '12px',
                                  border: '1px solid var(--border-color)',
                                  marginBottom: '16px'
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                                    {dp.lastError ? (
                                      <>
                                        <span style={{ color: '#e53e3e', fontSize: '14px' }}>●</span>
                                        <span style={{ color: '#e53e3e' }}>Read Error</span>
                                      </>
                                    ) : dp.lastValue !== null && dp.lastValue !== undefined ? (
                                      <>
                                        <span style={{ color: '#38a169', fontSize: '14px' }}>●</span>
                                        <span style={{ color: '#2f855a' }}>Live Value: {dp.lastValue}</span>
                                      </>
                                    ) : (
                                      <>
                                        <span style={{ color: '#dd6b20', fontSize: '14px' }}>●</span>
                                        <span style={{ color: '#c05621' }}>Connecting...</span>
                                      </>
                                    )}
                                  </div>
                                  {dp.lastError && (
                                    <div style={{ color: '#e53e3e', fontSize: '11px', marginTop: '4px', wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>
                                      {dp.lastError}
                                    </div>
                                  )}
                                  {dp.lastUpdated && (
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '10px', marginTop: '4px' }}>
                                      Last Read: {new Date(dp.lastUpdated).toLocaleTimeString()}
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div style={{
                                borderTop: '1px solid var(--border-color)',
                                paddingTop: '12px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '12px'
                              }}>
                                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Mapping Status:</span>
                                {isMapped ? (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span className="badge success" style={{ fontSize: '10px', padding: '3px 8px' }}>
                                      Bound to {dp.dataSourceId} ({dp.metric})
                                    </span>
                                    <button 
                                      onClick={() => handleDeleteDataPoint(dp.id)}
                                      style={{
                                        border: 'none',
                                        backgroundColor: 'transparent',
                                        color: '#e53e3e',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                        fontSize: '11px',
                                        padding: 0
                                      }}
                                    >
                                      Unbind
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                    Local Diagnostics
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>

                  {/* CREATE TAG MODAL */}
                  {isCreateTagOpen && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '540px',
                        maxWidth: '95%',
                        padding: '32px 40px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>Register Physical Sensor Tag</h3>
                        <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                          Configure a hardware sensor point to read live telemetry from your factory devices.
                        </p>

                        <form onSubmit={handleCreatePhysicalTag} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Connection Driver Adapter</label>
                            {adapters.length === 0 ? (
                              <div style={{ color: 'var(--danger-color)', fontSize: '12px', padding: '10px', backgroundColor: '#fff5f5', borderRadius: '6px', border: '1px solid #fed7d7' }}>
                                No protocol adapters configured. Please configure an adapter under the "Protocols" tab first.
                              </div>
                            ) : (
                              <select 
                                className="form-input" 
                                value={newDpAdapterId}
                                onChange={(e) => setNewDpAdapterId(e.target.value)}
                                required
                                style={{ height: '40px', fontWeight: 600 }}
                              >
                                <option value="">-- Choose Driver Connection --</option>
                                {adapters.map(a => (
                                  <option key={a.id} value={a.id}>{a.name} ({a.protocol} @ {a.host}:{a.port})</option>
                                ))}
                              </select>
                            )}
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Tag Address / Register / MQTT Topic</label>
                            <input 
                              className="form-input" 
                              type="text" 
                              placeholder="e.g. ns=2;s=Machine_Temp or 40001 or factory/packer/temperature"
                              value={newDpAddress}
                              onChange={(e) => setNewDpAddress(e.target.value)}
                              required
                              style={{ fontFamily: 'var(--font-mono)' }}
                            />
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '16px' }}>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>Data Type</label>
                              <select 
                                className="form-input" 
                                value={newDpDataType}
                                onChange={(e) => setNewDpDataType(e.target.value)}
                                style={{ height: '40px' }}
                              >
                                <option value="Int32">Int32</option>
                                <option value="Float">Float</option>
                                <option value="Boolean">Boolean</option>
                                <option value="String">String</option>
                              </select>
                            </div>

                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>Scan Rate (ms)</label>
                              <input 
                                className="form-input" 
                                type="number" 
                                value={newDpScanIntervalMs}
                                onChange={(e) => setNewDpScanIntervalMs(parseInt(e.target.value, 10) || 1000)}
                                style={{ fontFamily: 'var(--font-mono)' }}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>Scale Factor</label>
                              <input 
                                className="form-input" 
                                type="number" 
                                step="any"
                                value={newDpScaleFactor}
                                onChange={(e) => setNewDpScaleFactor(parseFloat(e.target.value) || 1.0)}
                                style={{ fontFamily: 'var(--font-mono)' }}
                              />
                            </div>

                            <div className="form-group" style={{ margin: 0 }}>
                              <label className="form-label" style={{ fontWeight: 700 }}>Offset</label>
                              <input 
                                className="form-input" 
                                type="number" 
                                step="any"
                                value={newDpOffset}
                                onChange={(e) => setNewDpOffset(parseFloat(e.target.value) || 0.0)}
                                style={{ fontFamily: 'var(--font-mono)' }}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                            <button 
                              type="submit"
                              disabled={adapters.length === 0}
                              style={{
                                flex: 2,
                                backgroundColor: 'var(--sidebar-bg)',
                                color: '#ffffff',
                                border: 'none',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: adapters.length === 0 ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s ease',
                                opacity: adapters.length === 0 ? 0.6 : 1
                              }}
                            >
                              Create Tag
                            </button>
                            <button 
                              type="button"
                              onClick={() => setIsCreateTagOpen(false)}
                              style={{
                                flex: 1,
                                backgroundColor: 'transparent',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* HARD DELETE CONFIRMATION MODAL */}
                  {deletingPhysicalTag && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '480px',
                        maxWidth: '90%',
                        padding: '28px 36px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '20px' }}>
                          <div style={{
                            backgroundColor: '#fff5f5',
                            color: '#e53e3e',
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            <AlertTriangle size={20} />
                          </div>
                          <div>
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Delete Physical Tag?</h3>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                              Are you sure you want to permanently delete tag <strong style={{ color: 'var(--text-primary)' }}>{deletingPhysicalTag.address}</strong>?
                            </p>
                          </div>
                        </div>

                        {deletingPhysicalTag.dataSourceId && deletingPhysicalTag.dataSourceId !== "" && (
                          <div style={{
                            color: '#dd6b20',
                            backgroundColor: '#fffaf0',
                            border: '1px solid #feebc8',
                            padding: '12px 14px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            marginBottom: '24px',
                            lineHeight: '1.4'
                          }}>
                            <strong>Warning:</strong> This tag is currently bound to data stream <strong style={{ color: 'var(--text-primary)' }}>{deletingPhysicalTag.dataSourceId}</strong>. Deleting this physical tag will immediately unbind it and stop telemetry.
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button 
                            onClick={() => handleHardDeleteDataPoint(deletingPhysicalTag.id)}
                            style={{
                              flex: 1,
                              backgroundColor: '#e53e3e',
                              color: '#ffffff',
                              border: 'none',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                          >
                            Delete Tag
                          </button>
                          <button 
                            onClick={() => setDeletingPhysicalTag(null)}
                            style={{
                              flex: 1,
                              backgroundColor: 'transparent',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border-color)',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {activeTab === 'protocols' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>Protocol Connection Adapters</h2>
                      <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        Manage local hardware connection drivers and configurations.
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        setNewAdapterName('');
                        setNewAdapterProtocol('OPC_UA');
                        setNewAdapterHost('127.0.0.1');
                        setNewAdapterPort(4840);
                        setNewAdapterConfigJson('{"SecurityMode": "None"}');
                        setIsCreateAdapterOpen(true);
                      }}
                      style={{
                        backgroundColor: 'var(--primary-color)',
                        color: 'var(--sidebar-bg)',
                        border: 'none',
                        padding: '10px 18px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s'
                      }}
                    >
                      <Plus size={16} />
                      Add Driver Adapter
                    </button>
                  </div>

                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    backgroundColor: '#eafaf1',
                    border: '1px solid #c6f6d5',
                    color: '#22543d',
                    padding: '16px 24px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500
                  }}>
                    <RefreshCw size={18} className="spin-slow" style={{ color: '#22543d', flexShrink: 0 }} />
                    <span>
                      <strong>Dynamic Socket Synchronization:</strong> Active. Changes made to communication channels are saved instantly to the local SQLite database. The background C# Edge Agent dynamically reloads and re-establishes connections in real-time (within 5 seconds).
                    </span>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: '24px'
                  }}>
                    {adapters.map((proto) => {
                      const isEditing = editingId === proto.id;
                      const isActive = proto.status === 'Connected' && proto.isEnabled;
                      return (
                        <div className="panel" key={proto.id} style={{ marginBottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                          <div>
                            <div className="panel-header" style={{ marginBottom: '16px', paddingBottom: '12px' }}>
                              <h3 className="panel-title" style={{ fontSize: '15px' }}>{proto.name}</h3>
                              <span className={`badge ${isActive ? 'success' : 'warning'}`}>
                                {!proto.isEnabled ? 'Disabled' : proto.status === 'Connected' ? 'Active' : 'Offline'}
                              </span>
                            </div>

                            {isEditing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                  <label className="form-label" style={{ fontSize: '11px' }}>Adapter Name</label>
                                  <input 
                                    className="form-input" 
                                    style={{ padding: '6px 10px', fontSize: '13px' }}
                                    type="text" 
                                    value={editAdapterName} 
                                    onChange={(e) => setEditAdapterName(e.target.value)} 
                                  />
                                </div>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                  <label className="form-label" style={{ fontSize: '11px' }}>Protocol</label>
                                  <select 
                                    className="form-input" 
                                    style={{ height: '36px', fontSize: '13px', padding: '6px' }}
                                    value={editAdapterProtocol}
                                    onChange={(e) => setEditAdapterProtocol(e.target.value)}
                                  >
                                    <option value="OPC_UA">OPC UA</option>
                                    <option value="MQTT">MQTT</option>
                                    <option value="MODBUS_TCP">Modbus TCP</option>
                                  </select>
                                </div>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                  <label className="form-label" style={{ fontSize: '11px' }}>Connection Host/IP</label>
                                  <input 
                                    className="form-input" 
                                    style={{ padding: '6px 10px', fontSize: '13px' }}
                                    type="text" 
                                    value={editAdapterHost} 
                                    onChange={(e) => setEditAdapterHost(e.target.value)} 
                                  />
                                </div>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                  <label className="form-label" style={{ fontSize: '11px' }}>Port</label>
                                  <input 
                                    className="form-input" 
                                    style={{ padding: '6px 10px', fontSize: '13px' }}
                                    type="number" 
                                    value={editAdapterPort} 
                                    onChange={(e) => setEditAdapterPort(parseInt(e.target.value, 10) || 0)} 
                                  />
                                </div>
                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                  <label className="form-label" style={{ fontSize: '11px' }}>Config Details (JSON)</label>
                                  <input 
                                    className="form-input" 
                                    style={{ padding: '6px 10px', fontSize: '13px' }}
                                    type="text" 
                                    value={editAdapterConfigJson} 
                                    onChange={(e) => setEditAdapterConfigJson(e.target.value)} 
                                  />
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', margin: '8px 0 16px 0' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={editAdapterIsEnabled} 
                                    onChange={(e) => setEditAdapterIsEnabled(e.target.checked)} 
                                  />
                                  <span style={{ fontSize: '12px', fontWeight: 600 }}>Enable Adapter</span>
                                </label>
                              </div>
                            ) : (
                              <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                                <div>
                                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Protocol: </span>
                                  <span className="badge info" style={{ fontSize: '10px' }}>{proto.protocol}</span>
                                </div>
                                <div style={{ wordBreak: 'break-all' }}>
                                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Host: </span>
                                  <span style={{ fontFamily: 'var(--font-mono)' }}>{proto.host}</span>
                                </div>
                                <div>
                                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Port: </span>
                                  <span style={{ fontFamily: 'var(--font-mono)' }}>{proto.port}</span>
                                </div>
                                <div style={{ wordBreak: 'break-all' }}>
                                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Auth Details: </span>
                                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{proto.configJson}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                            {isEditing ? (
                              <>
                                <button 
                                  onClick={() => saveProtocol(proto.id)} 
                                  style={{
                                    flex: 1,
                                    backgroundColor: 'var(--primary-color)',
                                    color: 'var(--sidebar-bg)',
                                    border: 'none',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Save
                                </button>
                                <button 
                                  onClick={cancelEdit} 
                                  style={{
                                    flex: 1,
                                    backgroundColor: 'transparent',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border-color)',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                                <button 
                                  onClick={() => startEdit(proto)} 
                                  style={{
                                    flex: 4,
                                    backgroundColor: 'rgba(60, 232, 189, 0.15)',
                                    color: '#2bc59e',
                                    border: '1px solid rgba(60, 232, 189, 0.3)',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  Edit Adapter Config
                                </button>
                                <button 
                                  onClick={() => setDeletingAdapter(proto)}
                                  title="Delete Adapter"
                                  style={{
                                    flex: 1,
                                    backgroundColor: '#fff5f5',
                                    color: '#e53e3e',
                                    border: '1px solid #fed7d7',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* CREATE DRIVER ADAPTER MODAL */}
                  {isCreateAdapterOpen && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '520px',
                        maxWidth: '90%',
                        padding: '28px 36px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
                          <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Create Driver Adapter</h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Add a new local hardware connection driver.</span>
                          </div>
                          <button 
                            onClick={() => setIsCreateAdapterOpen(false)}
                            style={{ background: 'transparent', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%' }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            &times;
                          </button>
                        </div>

                        <form onSubmit={handleCreateAdapter} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Adapter Name</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              placeholder="e.g. PLC Line 1 OPC UA" 
                              value={newAdapterName} 
                              onChange={(e) => setNewAdapterName(e.target.value)} 
                              required 
                            />
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Protocol Type</label>
                            <select 
                              className="form-input" 
                              value={newAdapterProtocol} 
                              onChange={(e) => {
                                setNewAdapterProtocol(e.target.value);
                                if (e.target.value === 'OPC_UA') {
                                  setNewAdapterPort(4840);
                                  setNewAdapterConfigJson('{"SecurityMode": "None"}');
                                } else if (e.target.value === 'MQTT') {
                                  setNewAdapterPort(1883);
                                  setNewAdapterConfigJson('{"ClientId": "pulse-edge-agent"}');
                                } else if (e.target.value === 'MODBUS_TCP') {
                                  setNewAdapterPort(502);
                                  setNewAdapterConfigJson('{"UnitId": 1}');
                                }
                              }} 
                              required
                              style={{ height: '40px' }}
                            >
                              <option value="OPC_UA">OPC UA</option>
                              <option value="MQTT">MQTT Broker</option>
                              <option value="MODBUS_TCP">Modbus TCP Node</option>
                            </select>
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Connection Host / IP</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              placeholder="e.g. 192.168.1.50 or localhost" 
                              value={newAdapterHost} 
                              onChange={(e) => setNewAdapterHost(e.target.value)} 
                              required 
                            />
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Port Number</label>
                            <input 
                              type="number" 
                              className="form-input" 
                              value={newAdapterPort} 
                              onChange={(e) => setNewAdapterPort(Number(e.target.value))} 
                              required 
                            />
                          </div>

                          <div className="form-group" style={{ margin: 0 }}>
                            <label className="form-label" style={{ fontWeight: 700 }}>Config Details (JSON)</label>
                            <input 
                              type="text" 
                              className="form-input" 
                              placeholder='{"options": "val"}' 
                              value={newAdapterConfigJson} 
                              onChange={(e) => setNewAdapterConfigJson(e.target.value)} 
                              required 
                            />
                          </div>

                          <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                            <button 
                              type="submit"
                              style={{
                                flex: 2,
                                backgroundColor: 'var(--sidebar-bg)',
                                color: '#ffffff',
                                border: 'none',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1a1c23'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--sidebar-bg)'}
                            >
                              Create Adapter
                            </button>
                            <button 
                              type="button"
                              onClick={() => setIsCreateAdapterOpen(false)}
                              style={{
                                flex: 1,
                                backgroundColor: 'transparent',
                                color: 'var(--text-secondary)',
                                border: '1px solid var(--border-color)',
                                padding: '12px 16px',
                                borderRadius: '8px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* DELETE ADAPTER CONFIRMATION MODAL */}
                  {deletingAdapter && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(10, 11, 15, 0.4)',
                      backdropFilter: 'blur(10px)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      zIndex: 1000,
                      animation: 'fadeIn 0.2s ease'
                    }}>
                      <div className="panel" style={{
                        width: '480px',
                        maxWidth: '90%',
                        padding: '28px 36px',
                        borderRadius: '16px',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#ffffff',
                        margin: 0,
                        animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                      }}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', marginBottom: '20px' }}>
                          <div style={{
                            backgroundColor: '#fff5f5',
                            color: '#e53e3e',
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            <AlertTriangle size={20} />
                          </div>
                          <div>
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>Delete Protocol Adapter?</h3>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                              Are you sure you want to delete the adapter <strong style={{ color: 'var(--text-primary)' }}>{deletingAdapter.name}</strong> ({deletingAdapter.protocol})?
                            </p>
                          </div>
                        </div>

                        <div style={{
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--border-color)',
                          padding: '12px 16px',
                          borderRadius: '8px',
                          marginBottom: '24px',
                          fontSize: '12px'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Host Address:</span>
                            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{deletingAdapter.host}:{deletingAdapter.port}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Bound Metrics Affected:</span>
                            <span style={{ fontWeight: 700, color: '#e53e3e' }}>
                              {(() => {
                                const count = datapoints.filter(dp => dp.adapterId === deletingAdapter.id).length;
                                return count === 0 ? 'None' : `${count} metric tag(s) will be unmapped`;
                              })()}
                            </span>
                          </div>
                        </div>

                        <div style={{
                          color: '#e53e3e',
                          backgroundColor: '#fff5f5',
                          border: '1px solid #fed7d7',
                          padding: '12px 14px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          marginBottom: '24px',
                          lineHeight: '1.4'
                        }}>
                          <strong>Warning:</strong> Deleting this connection adapter will immediately stop ingestion for all bound metrics on this channel and permanently delete their mappings.
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button 
                            onClick={() => handleDeleteAdapter(deletingAdapter.id)}
                            style={{
                              flex: 1,
                              backgroundColor: '#e53e3e',
                              color: '#ffffff',
                              border: 'none',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#c53030'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#e53e3e'}
                          >
                            Delete Adapter
                          </button>
                          <button 
                            onClick={() => setDeletingAdapter(null)}
                            style={{
                              flex: 1,
                              backgroundColor: 'transparent',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border-color)',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              textAlign: 'center'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'buffer' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {/* SQLite Telemetry buffer list */}
                  <div className="panel">
                    <div className="panel-header">
                      <h2 className="panel-title">Pending SQLite Telemetry Queue (`QueueTelemetry` Table)</h2>
                      <span className="badge info">{bufferTelemetry.length} items</span>
                    </div>

                    <div style={{ overflowX: 'auto', maxHeight: '350px' }}>
                      {bufferTelemetry.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          SQLite telemetry table is currently empty. Draining sync active.
                        </div>
                      ) : (
                        <table className="data-table" style={{ fontSize: '13px' }}>
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Source Stream ID</th>
                              <th>Payload JSON</th>
                              <th>Time Captured</th>
                              <th>Retries</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bufferTelemetry.map((item) => (
                              <tr key={item.id}>
                                <td style={{ fontFamily: 'var(--font-mono)' }}>{item.id}</td>
                                <td style={{ fontWeight: 600, color: 'var(--primary-dark)' }}>{item.dataSourceId}</td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--code-color)' }}>{item.payloadJson}</td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{new Date(item.timestamp).toLocaleString()}</td>
                                <td style={{ fontFamily: 'var(--font-mono)' }}>{item.retryCount}</td>
                                <td>
                                  <span className={`badge ${item.isSending ? 'warning' : 'info'}`}>
                                    {item.isSending ? 'Syncing' : 'Buffered'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  {/* SQLite Event buffer list */}
                  <div className="panel">
                    <div className="panel-header">
                      <h2 className="panel-title">Pending SQLite Event Queue (`QueueEvents` Table)</h2>
                      <span className="badge info">{bufferEvents.length} items</span>
                    </div>

                    <div style={{ overflowX: 'auto', maxHeight: '250px' }}>
                      {bufferEvents.length === 0 ? (
                        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          SQLite events table is empty. All state changes synced.
                        </div>
                      ) : (
                        <table className="data-table" style={{ fontSize: '13px' }}>
                          <thead>
                            <tr>
                              <th>ID</th>
                              <th>Event Type</th>
                              <th>Payload JSON</th>
                              <th>Time Captured</th>
                              <th>Retries</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bufferEvents.map((item) => (
                              <tr key={item.id}>
                                <td style={{ fontFamily: 'var(--font-mono)' }}>{item.id}</td>
                                <td style={{ fontWeight: 600 }}>{item.eventType}</td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--code-color)' }}>{item.payloadJson}</td>
                                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{new Date(item.timestamp).toLocaleString()}</td>
                                <td style={{ fontFamily: 'var(--font-mono)' }}>{item.retryCount}</td>
                                <td>
                                  <span className={`badge ${item.isSending ? 'warning' : 'info'}`}>
                                    {item.isSending ? 'Syncing' : 'Buffered'}
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
              )}

              {activeTab === 'settings' && (
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
                        onClick={() => alert('Settings Saved (Mocked)')}
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
                        <select 
                          className="form-input" 
                          value={pollingInterval}
                          onChange={(e) => setPollingInterval(parseInt(e.target.value, 10))}
                          style={{ height: '40px' }}
                        >
                          <option value={1000}>1 Second (Realtime)</option>
                          <option value={3000}>3 Seconds (Standard)</option>
                          <option value={5000}>5 Seconds (Efficient)</option>
                          <option value={10000}>10 Seconds (Low Power)</option>
                        </select>
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

                    <div className="form-group">
                      <label className="form-label">API Key Token</label>
                      <input className="form-input" type="text" readOnly value={dashboard?.device.apiKey || 'N/A'} style={{ fontFamily: 'var(--font-mono)' }} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
