import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyRecoveryCode from './MyRecoveryCode';
import { jsonResponse } from '../test/http';
import { testCredentials } from '../test/credentials';

const issued = ['RRRR', 'EEEE', 'GGGG', 'EEEE', 'NNNN'].join('-');

describe('MyRecoveryCode', () => {
  it('warns an admin without a code and lets them generate one', async () => {
    const fetchMock = vi.fn(async (url: string) => url === '/api/auth/me'
      ? jsonResponse(200, { role: 'Admin', hasRecoveryCode: false, recoveryCodeCreatedAtUtc: null })
      : jsonResponse(200, { recoveryCode: issued }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<MyRecoveryCode />);

    expect(await screen.findByText(/you have no recovery code/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /regenerate my recovery code/i }));
    await user.click(screen.getByLabelText('Current password'));
    await user.paste(testCredentials.adminPassword);
    await user.click(screen.getByRole('button', { name: /generate code/i }));

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent(issued);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/recovery-code', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the server error for a wrong current password', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/auth/me'
      ? jsonResponse(200, { role: 'Admin', hasRecoveryCode: true, recoveryCodeCreatedAtUtc: '2026-10-01T00:00:00Z' })
      : jsonResponse(400, { error: 'Current password is incorrect.' })));
    const user = userEvent.setup();
    render(<MyRecoveryCode />);

    await user.click(await screen.findByRole('button', { name: /regenerate my recovery code/i }));
    await user.click(screen.getByLabelText('Current password'));
    await user.paste(testCredentials.adminPassword);
    await user.click(screen.getByRole('button', { name: /generate code/i }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });
});
