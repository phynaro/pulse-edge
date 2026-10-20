import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import i18n from '../../i18n';
import ScenarioPanel from './ScenarioPanel';
import { jsonResponse } from '../../test/http';

const catalog = [
  {
    id: 'integra-dairy',
    name: 'Integra Dairy',
    units: [
      { id: 'filler-1', kind: 'machine', signals: ['state', 'fault'] },
      { id: 'chiller-1', kind: 'analog', signals: ['value'] },
    ],
    events: [{ id: 'filler-jam', unit: 'filler-1', durationMinutes: 10 }],
  },
];

function status(activeEvents: { id: string; untilUtc: string }[] = [], fillerMode = 'Running') {
  return {
    units: [
      { id: 'filler-1', kind: 'machine', mode: fillerMode, value: null },
      { id: 'chiller-1', kind: 'analog', mode: 'Idle', value: 4.2 },
    ],
    activeEvents,
  };
}

function stubFetch(handlers: { status?: () => Response; post?: () => Response } = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return handlers.post ? handlers.post() : jsonResponse(202, { accepted: true, eventId: 'filler-jam' });
    if (String(url).endsWith('/status')) return handlers.status ? handlers.status() : jsonResponse(200, status());
    return jsonResponse(200, catalog);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('ScenarioPanel', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders units from the status response', async () => {
    stubFetch();
    render(<ScenarioPanel scenarioId="integra-dairy" canTrigger />);
    expect(await screen.findByText('filler-1')).toBeInTheDocument();
    expect(screen.getByText('chiller-1')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  it('POSTs the event and then shows the active-until text', async () => {
    const until = new Date(2026, 9, 21, 14, 5).toISOString();
    let posted = false;
    const fn = stubFetch({
      post: () => { posted = true; return jsonResponse(202, { accepted: true, eventId: 'filler-jam' }); },
      status: () => jsonResponse(200, status(posted ? [{ id: 'filler-jam', untilUtc: until }] : [])),
    });
    render(<ScenarioPanel scenarioId="integra-dairy" canTrigger />);
    fireEvent.click(await screen.findByRole('button', { name: /filler-jam/ }));
    await waitFor(() => expect(screen.getByText(/active until 14:05/i)).toBeInTheDocument());
    const post = fn.mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(String(post[0])).toBe('/api/simulator/scenarios/integra-dairy/events');
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ eventId: 'filler-jam' });
  });

  it('hides event buttons for non-admins', async () => {
    stubFetch();
    render(<ScenarioPanel scenarioId="integra-dairy" canTrigger={false} />);
    expect(await screen.findByText('filler-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /filler-jam/ })).not.toBeInTheDocument();
  });

  it('renders Thai labels when the locale is th', async () => {
    await i18n.changeLanguage('th');
    stubFetch();
    render(<ScenarioPanel scenarioId="integra-dairy" canTrigger />);
    expect(await screen.findByText('เดินเครื่อง')).toBeInTheDocument();
    expect(screen.getByText('สถานการณ์จำลอง')).toBeInTheDocument();
    expect(screen.getByText('ว่าง')).toBeInTheDocument();
    expect(screen.getByText('สั่งเหตุการณ์')).toBeInTheDocument();
  });

  it('shows the server message on 503 instead of the panel', async () => {
    stubFetch({ status: () => jsonResponse(503, { error: 'Simulator unavailable in split mode' }) });
    render(<ScenarioPanel scenarioId="integra-dairy" canTrigger />);
    expect(await screen.findByText('Simulator unavailable in split mode')).toBeInTheDocument();
    expect(screen.queryByText('filler-1')).not.toBeInTheDocument();
  });
});
