import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SimulatorBrowserModal, { SIMULATOR_VARIABLES } from './SimulatorBrowserModal';
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

  it('renders correctly when open with default energy variables', () => {
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
    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.getByText('Active Power')).toBeInTheDocument();
    expect(screen.getByText('Accumulated Energy')).toBeInTheDocument();
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

    const searchInput = screen.getByPlaceholderText(/Filter by variable name/i);
    fireEvent.change(searchInput, { target: { value: 'voltage' } });

    expect(screen.getByText('Voltage')).toBeInTheDocument();
    expect(screen.queryByText('Accumulated Energy')).not.toBeInTheDocument();
  });

  it('supports single selection callback when onSelectVariable is passed', () => {
    const onSelectVariable = vi.fn();
    const onClose = vi.fn();

    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={onClose}
        adapterId="adp-sim-1"
        adapters={mockAdapters}
        toast={mockToast as any}
        onSelectVariable={onSelectVariable}
      />
    );

    fireEvent.click(screen.getByText('Voltage'));

    expect(onSelectVariable).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'voltage', name: 'Voltage' })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('allows category switching between Power and Production templates', () => {
    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={vi.fn()}
        adapterId="adp-sim-1"
        adapters={mockAdapters}
        toast={mockToast as any}
      />
    );

    fireEvent.click(screen.getByText('⚙️ Production & Counts'));

    expect(screen.getByText('Machine Running State')).toBeInTheDocument();
    expect(screen.getByText('Total Produced Count')).toBeInTheDocument();
    expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
  });
});
