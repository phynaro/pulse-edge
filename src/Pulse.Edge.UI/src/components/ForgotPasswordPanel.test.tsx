import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPasswordPanel from './ForgotPasswordPanel';
import { jsonResponse } from '../test/http';
import { testCredentials } from '../test/credentials';

const newCode = ['NNNN', 'EEEE', 'WWWW', 'CCCC', 'DDDD'].join('-');
const oldCode = ['OOOO', 'LLLL', 'DDDD', 'CCCC', 'XXXX'].join('-');

async function fillRecoveryForm(confirm = testCredentials.adminPassword) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /use a recovery code/i }));
  await user.type(screen.getByLabelText('Username'), testCredentials.adminUsername);
  await user.type(screen.getByLabelText('Recovery code'), oldCode);
  await user.type(screen.getByLabelText('New password'), testCredentials.adminPassword);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: /reset password/i }));
  return user;
}

describe('ForgotPasswordPanel', () => {
  it('tells non-admins to ask their administrator', () => {
    render(<ForgotPasswordPanel onBack={vi.fn()} />);
    expect(screen.getByText(/another administrator can reset your password/i)).toBeInTheDocument();
  });

  it('submits the recovery form and shows the newly issued code', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { recoveryCode: newCode }));
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPanel onBack={vi.fn()} />);

    await fillRecoveryForm();

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent(newCode);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/recover', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent).toEqual({ username: testCredentials.adminUsername, recoveryCode: oldCode, newPassword: testCredentials.adminPassword });
  });

  it('shows the server error on a rejected code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'Invalid username or recovery code.' })));
    render(<ForgotPasswordPanel onBack={vi.fn()} />);

    await fillRecoveryForm();

    expect(await screen.findByText('Invalid username or recovery code.')).toBeInTheDocument();
  });

  it('blocks submission when the passwords differ', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ForgotPasswordPanel onBack={vi.fn()} />);

    await fillRecoveryForm(testCredentials.adminPassword + 'x');

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
