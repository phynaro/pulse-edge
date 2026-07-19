import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OeeTagBrowserModal from './OeeTagBrowserModal';
import type { DataPoint, DriverAdapter } from '../../types';

const adapters = [
  { id: 'a1', name: 'PLC One', protocol: 'MODBUS_TCP' },
  { id: 'a2', name: 'Sim', protocol: 'SIMULATOR' },
] as DriverAdapter[];

const makeDp = (over: Partial<DataPoint>): DataPoint =>
  ({
    id: 'x', adapterId: 'a1', mqttDeviceId: null, dataSourceId: null, metric: null,
    address: 'addr', dataType: 'Boolean', scanIntervalMs: 1000, scaleFactor: 1, offset: 0,
    isEnabled: true, byteOrder: 'ABCD', mqttParseMode: 'Plaintext',
    ...over,
  }) as DataPoint;

const datapoints = [
  makeDp({ id: 'dp-run', address: 'running', description: 'Run bit', lastValue: 'True' }),
  makeDp({ id: 'dp-count', adapterId: 'a2', address: 'total_count', description: 'Good count', dataType: 'Int32', lastValue: '10000', dataSourceId: 'DS1', metric: 'good_count' }),
];

function renderModal(over: Partial<Parameters<typeof OeeTagBrowserModal>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <OeeTagBrowserModal
      roleLabel="Run signal"
      roleHint="nonzero = running"
      currentTagId={null}
      allowClear={false}
      datapoints={datapoints}
      adapters={adapters}
      onSelect={onSelect}
      onClose={onClose}
      {...over}
    />,
  );
  return { onSelect, onClose };
}

describe('OeeTagBrowserModal', () => {
  it('renders tag rows with adapter, type and stream metadata', () => {
    renderModal();
    expect(screen.getByText('Select Run signal Tag')).toBeInTheDocument();
    expect(screen.getByText('Run bit (running)')).toBeInTheDocument();
    expect(screen.getByText('PLC One')).toBeInTheDocument();
    expect(screen.getByText(/Stream: DS1 → good_count/)).toBeInTheDocument(); // informational, not a filter
  });

  it('search narrows the list', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/search tags/i), { target: { value: 'total' } });
    expect(screen.queryByText('Run bit (running)')).not.toBeInTheDocument();
    expect(screen.getByText('Good count (total_count)')).toBeInTheDocument();
  });

  it('adapter filter narrows the list', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /all adapters/i })); // CustomSelect trigger
    fireEvent.click(screen.getByRole('button', { name: /sim \(simulator\)/i }));
    expect(screen.queryByText('Run bit (running)')).not.toBeInTheDocument();
    expect(screen.getByText('Good count (total_count)')).toBeInTheDocument();
  });

  it('selecting a row then confirming fires onSelect with the tag id and closes', () => {
    const { onSelect, onClose } = renderModal();
    const confirm = screen.getByRole('button', { name: /use this tag/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByText('Run bit (running)'));
    fireEvent.click(confirm);
    expect(onSelect).toHaveBeenCalledWith('dp-run');
    expect(onClose).toHaveBeenCalled();
  });

  it('pre-highlights currentTagId and enables confirm immediately', () => {
    renderModal({ currentTagId: 'dp-count' });
    const selected = document.querySelector('.browser-node-item.is-selected');
    expect(selected?.textContent).toContain('Good count (total_count)');
    expect(screen.getByRole('button', { name: /use this tag/i })).toBeEnabled();
  });

  it('Clear Binding renders only when allowClear and fires onSelect(null)', () => {
    renderModal();
    expect(screen.queryByRole('button', { name: /clear binding/i })).not.toBeInTheDocument();

    const { onSelect, onClose } = renderModal({ allowClear: true, currentTagId: 'dp-run' });
    fireEvent.click(screen.getByRole('button', { name: /clear binding/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders sensibly with no adapters', () => {
    renderModal({ adapters: [] });
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0); // adapter name fallback
    expect(screen.getByRole('button', { name: /all adapters/i })).toBeInTheDocument();
  });
});
