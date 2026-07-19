import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import OeeTab from './OeeTab';
import type { DataPoint } from '../types';

describe('OeeTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/api/oee/status')) {
        return Promise.resolve(new Response(JSON.stringify({
          channels: [{
            id: 1, externalId: 'line1.filler', name: 'Line 1 — Filler', enabled: true,
            lastState: 'fault', lastCode: 'E17', lastStateChangedAt: '2026-07-18T06:14:03.250Z',
            nextSeq: 4103, pendingCount: 2,
          }],
          outboxDepth: 2,
        })));
      }
      if (url.startsWith('/api/datapoints')) {
        return Promise.resolve(new Response(JSON.stringify([])));
      }
      return Promise.resolve(new Response('[]'));
    }));
  });

  it('renders channel list with live state badge', async () => {
    render(<OeeTab datapoints={[]} adapters={[]} />);
    await waitFor(() => {
      expect(screen.getByText('Line 1 — Filler')).toBeInTheDocument();
      expect(screen.getByText(/fault/i)).toBeInTheDocument();
      expect(screen.getByText('line1.filler')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no channels exist', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ channels: [], outboxDepth: 0 })))));
    render(<OeeTab datapoints={[]} adapters={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/no oee channels/i)).toBeInTheDocument();
    });
  });

  it('opens the tag browser from a role field and applies the selection', async () => {
    const datapoints = [
      {
        id: 'dp-run', adapterId: 'a1', mqttDeviceId: null, dataSourceId: null, metric: null,
        address: 'running', description: 'Run bit', dataType: 'Boolean', scanIntervalMs: 1000,
        scaleFactor: 1, offset: 0, isEnabled: true, byteOrder: 'ABCD', mqttParseMode: 'Plaintext',
      },
    ] as DataPoint[];
    render(<OeeTab datapoints={datapoints} adapters={[]} />);

    fireEvent.click(await screen.findByRole('button', { name: /add channel/i }));
    // Five role fields, each with a Browse… button; the first is the run signal.
    fireEvent.click(screen.getAllByRole('button', { name: /browse/i })[0]);

    expect(await screen.findByText('Select Run signal Tag')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Run bit (running)'));
    fireEvent.click(screen.getByRole('button', { name: /use this tag/i }));

    // Browser closed; the run field row now shows the chosen tag.
    expect(screen.queryByText('Select Run signal Tag')).not.toBeInTheDocument();
    expect(screen.getByText(/Run bit \(running\)/)).toBeInTheDocument();
  });
});
