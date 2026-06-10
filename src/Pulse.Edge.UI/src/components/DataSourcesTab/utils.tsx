import React from 'react';
import {
  Database,
  Zap,
  BarChart3,
  Activity,
  Thermometer,
  Cpu,
  Gauge,
  Wind
} from 'lucide-react';

export const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Database,
  Zap,
  BarChart3,
  Activity,
  Thermometer,
  Cpu,
  Gauge,
  Wind
};

export const DynamicIcon = ({ name, size, className }: { name: string; size?: number; className?: string }) => {
  const IconComp = ICON_MAP[name] || Database;
  return <IconComp size={size} className={className} />;
};

export function templateThemeClass(id: string): string {
  if (id === 'General') return 'theme-general';
  if (id === 'Production') return 'theme-production';
  if (id === 'Energy') return 'theme-energy';
  return 'theme-custom';
}

export const formatLiveValue = (value: string | null | undefined, dataType: string): string => {
  if (value === null || value === undefined || value === '') return '—';

  const num = parseFloat(value);
  if (isNaN(num)) return value;

  const lowerDataType = dataType.toLowerCase();

  if (
    lowerDataType.includes('int') ||
    lowerDataType.includes('word') ||
    lowerDataType.includes('bool')
  ) {
    return Math.round(num).toString();
  }

  if (
    lowerDataType.includes('float') ||
    lowerDataType.includes('double') ||
    lowerDataType.includes('single') ||
    lowerDataType.includes('real') ||
    lowerDataType.includes('num')
  ) {
    return parseFloat(num.toFixed(2)).toString();
  }

  return parseFloat(num.toFixed(2)).toString();
};
