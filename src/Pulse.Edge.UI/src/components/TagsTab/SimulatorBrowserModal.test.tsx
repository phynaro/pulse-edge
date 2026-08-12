import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SimulatorBrowserModal from './SimulatorBrowserModal';
import type { DriverAdapter } from '../../types';

describe('SimulatorBrowserModal', () => {
  const mockAdapters: DriverAdapter[] = [
    {
      id: 'adp-sim-1',
      name: 'Power Meter Simulator',
      protocol: 'SIMULATOR',
      host: 'localhost',
      port: 0,
      isEnabled: true,
      status: 'Connected',
      configJson: JSON.stringify({ Template: 'energy' }),
    },
    {
      id: 'adp-sim-2',
      name: 'Machine Production Simulator',
      protocol: 'SIMULATOR',
      host: 'localhost',
      port: 0,
      isEnabled: true,
      status: 'Connected',
      configJson: JSON.stringify({ Template: 'production' }),
    },
  ];

  const mockToast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };

  it('renders strictly the variables for the currently selected energy adapter', () => {
    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={vi.fn()}
        adapterId="adp-sim-1"
        adapters={mockAdapters}
        toast={mockToast as any}
      />
    );

    expect(screen.getByText('Browse Protocol Simulator Variables')).toBeInTheDocument();
    expect(screen.getByText('Power Meter Simulator')).toBeInTheDocument();
    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.getByText('Active Power')).toBeInTheDocument();
    expect(screen.getByText('Accumulated Energy')).toBeInTheDocument();
    expect(screen.queryByText('Machine Running State')).not.toBeInTheDocument();
  });

  it('renders strictly the variables for a production adapter when selected', () => {
    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={vi.fn()}
        adapterId="adp-sim-2"
        adapters={mockAdapters}
        toast={mockToast as any}
      />
    );

    expect(screen.getByText('Machine Production Simulator')).toBeInTheDocument();
    expect(screen.getByText('Machine Running State')).toBeInTheDocument();
    expect(screen.getByText('Total Produced Count')).toBeInTheDocument();
    expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
  });

  it('filters variables when searching', () => {
    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={vi.fn()}
        adapterId="adp-sim-1"
        adapters={mockAdapters}
        toast={mockToast as any}
      />
    );

    const searchInput = screen.getByPlaceholderText(/Filter variables by name/i);
    fireEvent.change(searchInput, { target: { value: 'voltage' } });

    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.queryByText('Accumulated Energy')).not.toBeInTheDocument();
  });

  it('supports multi-selection and proceeding to step 2 configuration', () => {
    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={vi.fn()}
        adapterId="adp-sim-1"
        adapters={mockAdapters}
        toast={mockToast as any}
      />
    );

    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText(/6 variable\(s\) selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Next Step →/i));
    expect(screen.getByText('Step 2: Configure Tag Names & Polling Interval')).toBeInTheDocument();
  });
});
