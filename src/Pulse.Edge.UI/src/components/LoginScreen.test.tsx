import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginScreen from './LoginScreen';
import { AuthContext, type AuthContextValue } from '../context/auth';

function renderLogin(overrides: Partial<AuthContextValue> = {}) {
  const value: AuthContextValue = {
    loading: false,
    setupState: 'Operational',
    user: null,
    login: vi.fn(async () => null),
    createFirstAdmin: vi.fn(async () => null),
    logout: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    ...overrides,
  };
  render(
    <AuthContext.Provider value={value}>
      <LoginScreen />
    </AuthContext.Provider>,
  );
  return value;
}

describe('LoginScreen', () => {
  it('submits the entered username and password to login', async () => {
    const user = userEvent.setup();
    const login = vi.fn(async () => null);
    renderLogin({ login });

    await user.type(screen.getByLabelText('Username'), 'operator');
    await user.type(screen.getByLabelText('Password'), 's3cret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(login).toHaveBeenCalledWith('operator', 's3cret');
  });

  it('shows the server error message when authentication fails', async () => {
    const user = userEvent.setup();
    renderLogin({ login: vi.fn(async () => 'Invalid credentials.') });

    await user.type(screen.getByLabelText('Username'), 'operator');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials.')).toBeInTheDocument();
  });

  it('does not display an error after a successful login', async () => {
    const user = userEvent.setup();
    renderLogin({ login: vi.fn(async () => null) });

    await user.type(screen.getByLabelText('Username'), 'operator');
    await user.type(screen.getByLabelText('Password'), 'good');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled(),
    );
    expect(screen.queryByText(/failed|invalid/i)).not.toBeInTheDocument();
  });

  it('disables the submit button while the login request is in flight', async () => {
    const user = userEvent.setup();
    let resolveLogin: (value: string | null) => void = () => {};
    const login = vi.fn(
      () => new Promise<string | null>((resolve) => { resolveLogin = resolve; }),
    );
    renderLogin({ login });

    await user.type(screen.getByLabelText('Username'), 'operator');
    await user.type(screen.getByLabelText('Password'), 'good');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled(),
    );

    resolveLogin(null);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled(),
    );
  });
});
