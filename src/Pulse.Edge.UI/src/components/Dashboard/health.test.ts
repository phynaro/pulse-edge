import { describe, expect, it } from 'vitest';
import type { DataPoint, DriverAdapter } from '../../types';
import { getAdapterHealth, getTagHealth } from './health';

const adapter = (values: Partial<DriverAdapter>): DriverAdapter => ({
  id: 'adapter-1',
  name: 'Adapter',
  type: 'OpcUa',
  isEnabled: true,
  status: 'Disconnected',
  ...values,
} as DriverAdapter);

const tag = (values: Partial<DataPoint>): DataPoint => ({
  id: 'tag-1',
  adapterId: 'adapter-1',
  name: 'Temperature',
  address: 'ns=2;i=2',
  dataType: 'Double',
  isEnabled: true,
  lastValue: null,
  lastError: null,
  ...values,
} as DataPoint);

describe('dashboard health classification', () => {
  it('classifies adapter state with disabled taking precedence', () => {
    expect(getAdapterHealth(adapter({ isEnabled: false, status: 'Connected' }))).toBe('disabled');
    expect(getAdapterHealth(adapter({ status: 'Connected' }))).toBe('good');
    expect(getAdapterHealth(adapter({ status: 'Connecting' }))).toBe('offline');
  });

  it('classifies tag state in precedence order', () => {
    expect(getTagHealth(tag({ isEnabled: false, lastError: 'timeout' }))).toBe('disabled');
    expect(getTagHealth(tag({ lastError: 'timeout', lastValue: '12' }))).toBe('error');
    expect(getTagHealth(tag({ lastValue: '0' }))).toBe('live');
    expect(getTagHealth(tag({}))).toBe('connecting');
  });
});
