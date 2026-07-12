import type { DataPoint, DriverAdapter } from '../../types';

export type AdapterHealth = 'good' | 'offline' | 'disabled';
export type TagHealth = 'live' | 'connecting' | 'error' | 'disabled';

export function getAdapterHealth(adapter: DriverAdapter): AdapterHealth {
  if (!adapter.isEnabled) return 'disabled';
  if (adapter.status === 'Connected') return 'good';
  return 'offline';
}

export function getTagHealth(tag: DataPoint): TagHealth {
  if (!tag.isEnabled) return 'disabled';
  if (tag.lastError) return 'error';
  if (tag.lastValue !== null && tag.lastValue !== undefined) return 'live';
  return 'connecting';
}

export const healthLabels = {
  good: 'Good', offline: 'Offline', error: 'Error', disabled: 'Disabled',
  live: 'Live', connecting: 'Connecting'
} as const;
