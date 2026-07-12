import React, { useCallback, useState, useEffect } from 'react';
import type { 
  DashboardData, 
  DataSource, 
  DriverAdapter, 
  DataPoint, 
  DiagnosticData, 
  BufferTelemetryItem, 
  BufferEventItem,
  MqttDevice
} from '../types';
import { EdgeContext } from './edge';

export const EdgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [datasources, setDatasources] = useState<DataSource[]>([]);
  const [adapters, setAdapters] = useState<DriverAdapter[]>([]);
  const [datapoints, setDatapoints] = useState<DataPoint[]>([]);
  const [mqttDevices, setMqttDevices] = useState<MqttDevice[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticData | null>(null);
  const [isSyncEnabled, setIsSyncEnabled] = useState<boolean>(true);
  const [bufferTelemetry, setBufferTelemetry] = useState<BufferTelemetryItem[]>([]);
  const [bufferEvents, setBufferEvents] = useState<BufferEventItem[]>([]);

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

  const [liveFeed, setLiveFeed] = useState<{ time: string; source: string; payload: string }[]>([]);
  const [cloudEndpoint, setCloudEndpoint] = useState<string>('');
  const [edgeSerial, setEdgeSerial] = useState<string>('');
  const [isOnboarded, setIsOnboarded] = useState<boolean>(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const [hasInitializedSettings, setHasInitializedSettings] = useState<boolean>(false);

  const fetchStaticData = useCallback(async () => {
    try {
      const [dsRes, adaptersRes, dpRes, syncRes, settingsRes, mqttRes] = await Promise.all([
        fetch('/api/datasources'),
        fetch('/api/adapters'),
        fetch('/api/datapoints'),
        fetch('/api/settings/sync-status'),
        fetch('/api/settings'),
        fetch('/api/mqtt-devices')
      ]);

      if (dsRes.ok && adaptersRes.ok && dpRes.ok && syncRes.ok && settingsRes.ok && mqttRes.ok) {
        const dsData = await dsRes.json();
        const adaptersData = await adaptersRes.json();
        const dpData = await dpRes.json();
        const syncData = await syncRes.json();
        const settingsData = await settingsRes.json();
        const mqttData = await mqttRes.json();

        setDatasources(dsData);
        setAdapters(adaptersData);
        setDatapoints(dpData);
        setIsSyncEnabled(syncData.isSyncEnabled);
        setMqttDevices(mqttData);

        if (!hasInitializedSettings) {
          setCloudEndpoint(settingsData.cloudEndpoint || 'http://localhost:3000');
          setEdgeSerial(settingsData.serialNumber || '');
          const hasApiKey = settingsData.apiKey && settingsData.apiKey !== 'None';
          setIsOnboarded(!!settingsData.serialNumber && hasApiKey);
          setHasInitializedSettings(true);
        }
        setIsConnected(true);
      }
    } catch (err) {
      console.error('Failed to fetch static configurations:', err);
      setIsConnected(false);
    }
  }, [hasInitializedSettings]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchStaticData(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchStaticData]);

  return (
    <EdgeContext.Provider value={{
      isConnected, setIsConnected,
      isLoading, setIsLoading,
      dashboard, setDashboard,
      datasources, setDatasources,
      adapters, setAdapters,
      datapoints, setDatapoints,
      mqttDevices, setMqttDevices,
      diagnostics, setDiagnostics,
      isSyncEnabled, setIsSyncEnabled,
      bufferTelemetry, setBufferTelemetry,
      bufferEvents, setBufferEvents,
      pollingInterval, setPollingInterval,
      maxLiveLogs, setMaxLiveLogs,
      telemetryWarningThreshold, setTelemetryWarningThreshold,
      eventWarningThreshold, setEventWarningThreshold,
      showDiagnosticsPanel, setShowDiagnosticsPanel,
      showLiveFeedPanel, setShowLiveFeedPanel,
      liveFeed, setLiveFeed,
      cloudEndpoint, setCloudEndpoint,
      edgeSerial, setEdgeSerial,
      isOnboarded, setIsOnboarded,
      isSidebarCollapsed, setIsSidebarCollapsed,
      fetchStaticData,
      hasInitializedSettings, setHasInitializedSettings
    }}>
      {children}
    </EdgeContext.Provider>
  );
};
