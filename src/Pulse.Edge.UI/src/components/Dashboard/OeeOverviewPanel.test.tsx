import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OeeOverviewPanel from './OeeOverviewPanel';
import type { OeeStatusResponse } from '../../types';

const status: OeeStatusResponse = {
  outboxDepth: 7,
  channels: [
    { id: 1, externalId: 'l1', name: 'Filler',     enabled: true,  lastState: 'running', lastCode: null,  lastStateChangedAt: null, nextSeq: 10, pendingCount: 0 },
    { id: 2, externalId: 'l2', name: 'Capper',     enabled: true,  lastState: 'fault',   lastCode: 'E17', lastStateChangedAt: null, nextSeq: 5,  pendingCount: 4 },
    { id: 3, externalId: 'l3', name: 'Palletizer', enabled: true,  lastState: null,      lastCode: null,  lastStateChangedAt: null, nextSeq: 0,  pendingCount: 0 },
    { id: 4, externalId: 'l4', name: 'Labeler',    enabled: false, lastState: 'stopped', lastCode: null,  lastStateChangedAt: null, nextSeq: 2,  pendingCount: 3 },
  ],
};

describe('OeeOverviewPanel', () => {
  it('renders state labels, total, and outbox depth from status', () => {
    const { container } = render(<OeeOverviewPanel oeeStatus={status} onOpenOee={vi.fn()} />);
    expect(screen.getByText('Performance machines')).toBeInTheDocument();
    for (const label of ['running', 'stopped', 'fault', 'no data']) {
      // getAllBy: state labels legitimately appear in both the metric grid and breakdown rows
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByTitle('Open the Performance tab').textContent).toContain('4'); // total button
    expect(screen.getByText(/Outbox depth/)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    // The rail has one segment per state, in order.
    expect(container.querySelectorAll('.ops-segment-rail button')).toHaveLength(4);
  });

  it('sorts the breakdown fault-first', () => {
    const { container } = render(<OeeOverviewPanel oeeStatus={status} onOpenOee={vi.fn()} />);
    const rows = container.querySelectorAll('.ops-oee-breakdown button');
    expect(rows).toHaveLength(3); // top 3 of 4
    expect(rows[0].textContent).toContain('Capper');   // fault first
  });

  it('clicking the total button opens the OEE tab', () => {
    const onOpenOee = vi.fn();
    render(<OeeOverviewPanel oeeStatus={status} onOpenOee={onOpenOee} />);
    fireEvent.click(screen.getByTitle('Open the Performance tab'));
    expect(onOpenOee).toHaveBeenCalled();
  });

  it('shows the empty state at zero channels', () => {
    const onOpenOee = vi.fn();
    render(<OeeOverviewPanel oeeStatus={{ channels: [], outboxDepth: 0 }} onOpenOee={onOpenOee} />);
    expect(screen.getByText('No performance channels configured')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open performance tab/i }));
    expect(onOpenOee).toHaveBeenCalled();
  });

  it('shows the unavailable state when status is null', () => {
    render(<OeeOverviewPanel oeeStatus={null} onOpenOee={vi.fn()} />);
    expect(screen.getByText('Performance status unavailable')).toBeInTheDocument();
  });
});
