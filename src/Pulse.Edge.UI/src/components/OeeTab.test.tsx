import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import OeeTab from './OeeTab';

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
    render(<OeeTab datapoints={[]} />);
    await waitFor(() => {
      expect(screen.getByText('Line 1 — Filler')).toBeInTheDocument();
      expect(screen.getByText(/fault/i)).toBeInTheDocument();
      expect(screen.getByText('line1.filler')).toBeInTheDocument();
    });
  });

  it('shows the empty state when no channels exist', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ channels: [], outboxDepth: 0 })))));
    render(<OeeTab datapoints={[]} />);
    await waitFor(() => {
      expect(screen.getByText(/no oee channels/i)).toBeInTheDocument();
    });
  });
});
