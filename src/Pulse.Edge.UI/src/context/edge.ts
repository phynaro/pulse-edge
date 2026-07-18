import { createContext, useContext } from 'react';
import type React from 'react';
import type {
  OeeOutboxItem,
  BufferTelemetryItem,
  DashboardData,
  DataPoint,
  DataSource,
  DiagnosticData,
  DriverAdapter,
  MqttDevice
} from '../types';

export interface EdgeContextType {
  isConnected: boolean;
  setIsConnected: (val: boolean) => void;
  isLoading: boolean;
  setIsLoading: (val: boolean) => void;
  dashboard: DashboardData | null;
  setDashboard: (val: DashboardData | null) => void;
  datasources: DataSource[];
  setDatasources: (val: DataSource[]) => void;
  adapters: DriverAdapter[];
  setAdapters: (val: DriverAdapter[]) => void;
  datapoints: DataPoint[];
  setDatapoints: (val: DataPoint[]) => void;
  mqttDevices: MqttDevice[];
  setMqttDevices: (val: MqttDevice[]) => void;
  diagnostics: DiagnosticData | null;
  setDiagnostics: (val: DiagnosticData | null) => void;
  isSyncEnabled: boolean;
  setIsSyncEnabled: (val: boolean) => void;
  bufferTelemetry: BufferTelemetryItem[];
  setBufferTelemetry: (val: BufferTelemetryItem[]) => void;
  oeeOutbox: OeeOutboxItem[];
  setOeeOutbox: (val: OeeOutboxItem[]) => void;
  pollingInterval: number;
  setPollingInterval: (val: number) => void;
  maxLiveLogs: number;
  setMaxLiveLogs: (val: number) => void;
  telemetryWarningThreshold: number;
  setTelemetryWarningThreshold: (val: number) => void;
  eventWarningThreshold: number;
  setEventWarningThreshold: (val: number) => void;
  showDiagnosticsPanel: boolean;
  setShowDiagnosticsPanel: (val: boolean) => void;
  showLiveFeedPanel: boolean;
  setShowLiveFeedPanel: (val: boolean) => void;
  liveFeed: { time: string; source: string; payload: string }[];
  setLiveFeed: React.Dispatch<React.SetStateAction<{ time: string; source: string; payload: string }[]>>;
  cloudEndpoint: string;
  setCloudEndpoint: (val: string) => void;
  edgeSerial: string;
  setEdgeSerial: (val: string) => void;
  isOnboarded: boolean;
  setIsOnboarded: (val: boolean) => void;
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (val: boolean) => void;
  fetchStaticData: () => Promise<void>;
  hasInitializedSettings: boolean;
  setHasInitializedSettings: (val: boolean) => void;
}

export const EdgeContext = createContext<EdgeContextType | undefined>(undefined);

export function useEdge() {
  const context = useContext(EdgeContext);
  if (!context) throw new Error('useEdge must be used within an EdgeProvider');
  return context;
}
