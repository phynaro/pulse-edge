import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import SimulatorBrowserModal from './SimulatorBrowserModal';
import { jsonResponse } from '../../test/http';
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

  const mockToast: ComponentProps<typeof SimulatorBrowserModal>['toast'] = {
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
        toast={mockToast}
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
        toast={mockToast}
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
        toast={mockToast}
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
        toast={mockToast}
      />
    );

    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText(/6 variable\(s\) selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Next Step →/i));
    expect(screen.getByText('Step 2: Configure Tag Names & Polling Interval')).toBeInTheDocument();
  });
  it('lists unit.signal tags with mapped data types for a scenario adapter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, [{
      id: 'integra-dairy', name: 'Integra Dairy', events: [],
      units: [
        { id: 'filler-1', kind: 'machine', signals: ['state', 'good_count', 'fault_code', 'speed'] },
        { id: 'chiller-1', kind: 'analog', signals: ['value'] },
      ],
    }])));
    const adapters: DriverAdapter[] = [{ ...mockAdapters[0], id: 'adp-sc', configJson: JSON.stringify({ Template: 'scenario', Scenario: 'integra-dairy' }) }];
    render(<SimulatorBrowserModal isOpen={true} onClose={vi.fn()} adapterId='adp-sc' adapters={adapters} toast={mockToast} />);

    expect(await screen.findByText('filler-1.state')).toBeInTheDocument();
    expect(screen.getByText('chiller-1.value')).toBeInTheDocument();
    expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter variables by name/i), { target: { value: 'chiller' } });
    expect(screen.queryByText('filler-1.state')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Filter variables by name/i), { target: { value: '' } });
    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText(/Next Step →/i));
    expect(screen.getByDisplayValue('filler-1.state')).toBeInTheDocument();
    expect(screen.getAllByText('Boolean')).toHaveLength(1);
    expect(screen.getAllByText('UInt32')).toHaveLength(1);
    expect(screen.getAllByText('Int32')).toHaveLength(1);
    expect(screen.getAllByText('Double')).toHaveLength(2);
  });

  it('warns with the failure count when only some tags register', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++call === 1 ? jsonResponse(200, {}) : jsonResponse(500, {}))));
    render(
      <SimulatorBrowserModal
        isOpen={true}
        onClose={vi.fn()}
        adapterId="adp-sim-1"
        adapters={mockAdapters}
        toast={mockToast}
      />
    );

    fireEvent.click(screen.getByText('Select All'));
    fireEvent.click(screen.getByText(/Next Step →/i));
    fireEvent.click(screen.getByText('Save & Register Tags'));

    await waitFor(() => expect(mockToast.warning).toHaveBeenCalledWith('Registered 1 simulator tag(s); 5 failed.'));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
