import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfigurationBackupPanel from './ConfigurationBackupPanel';
import { blobResponse, jsonResponse } from '../test/http';

const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

/** Route fetch by "METHOD url" to a handler that returns a Response. */
function stubFetch(handlers: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected fetch: ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Capture the anchors the component clicks so we can assert the download name. */
function captureDownloads() {
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  return downloads;
}

const validInspection = {
  isValid: true,
  errors: [],
  agentVersion: '1.2.3',
  sourceSerialNumber: 'SN-1',
  counts: { adapters: 2, dataSources: 3, dataPoints: 40, mqttDevices: 1, streamTemplates: 5 },
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

function renderPanel() {
  const onRestoreComplete = vi.fn(async () => {});
  const view = render(<ConfigurationBackupPanel onRestoreComplete={onRestoreComplete} />);
  return { onRestoreComplete, ...view };
}

async function inspectFile(container: HTMLElement, contents: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([contents], 'backup.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ConfigurationBackupPanel export', () => {
  it('downloads the backup using the filename from Content-Disposition', async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    stubFetch({
      'GET /api/backups/configuration': () =>
        blobResponse(200, new Blob(['{}']), {
          'Content-Disposition': 'attachment; filename="site-a.pulsebackup.json"',
        }),
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /export backup/i }));

    expect(await screen.findByText('Configuration backup created successfully.')).toBeInTheDocument();
    expect(downloads).toEqual(['site-a.pulsebackup.json']);
  });

  it('decodes an RFC 5987 encoded filename', async () => {
    const user = userEvent.setup();
    const downloads = captureDownloads();
    stubFetch({
      'GET /api/backups/configuration': () =>
        blobResponse(200, new Blob(['{}']), {
          'Content-Disposition': "attachment; filename*=UTF-8''plant%20one.json",
        }),
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /export backup/i }));

    await waitFor(() => expect(downloads).toEqual(['plant one.json']));
  });

  it('maps a 401 response to a session-expired message', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/backups/configuration': () => blobResponse(401, new Blob([''])) });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /export backup/i }));

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });

  it('maps a 403 response to an administrator-only message', async () => {
    const user = userEvent.setup();
    stubFetch({ 'GET /api/backups/configuration': () => blobResponse(403, new Blob([''])) });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /export backup/i }));

    expect(await screen.findByText(/only an administrator/i)).toBeInTheDocument();
  });
});

describe('ConfigurationBackupPanel inspect and restore', () => {
  it('rejects a file that is not valid JSON without calling the server', async () => {
    const fetchMock = stubFetch({});
    const { container } = renderPanel();

    await inspectFile(container, 'this is not json{');

    expect(
      await screen.findByText('This file is not a valid PULSE Edge configuration backup.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the restore preview for a valid backup', async () => {
    stubFetch({
      'POST /api/restores/configuration/inspect': () => jsonResponse(200, validInspection),
    });
    const { container } = renderPanel();

    await inspectFile(container, JSON.stringify({ any: 'payload' }));

    expect(await screen.findByText(/ready to restore/i)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // adapter count
  });

  it('does not apply a restore when the confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false);
    const fetchMock = stubFetch({
      'POST /api/restores/configuration/inspect': () => jsonResponse(200, validInspection),
    });
    const { container } = renderPanel();
    await inspectFile(container, JSON.stringify({ any: 'payload' }));
    await screen.findByText(/ready to restore/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /replace local configuration/i }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/restores/configuration/apply',
      expect.anything(),
    );
  });

  it('applies the restore and reports success when confirmed', async () => {
    confirmMock.mockResolvedValue(true);
    stubFetch({
      'POST /api/restores/configuration/inspect': () => jsonResponse(200, validInspection),
      'POST /api/restores/configuration/apply': () =>
        jsonResponse(200, { message: 'Configuration restored.' }),
    });
    const { container, onRestoreComplete } = renderPanel();
    await inspectFile(container, JSON.stringify({ any: 'payload' }));
    await screen.findByText(/ready to restore/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /replace local configuration/i }));

    expect(await screen.findByText('Configuration restored.')).toBeInTheDocument();
    expect(onRestoreComplete).toHaveBeenCalled();
  });
});
