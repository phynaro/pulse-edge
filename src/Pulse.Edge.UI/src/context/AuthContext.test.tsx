import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from './AuthContext';
import { useAuth } from './auth';
import { jsonResponse } from '../test/http';
import { testCredentials } from '../test/credentials';

function Consumer() {
  const { loading, setupState, user, login, logout } = useAuth();
  const [error, setError] = useState<string | null | 'unset'>('unset');
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="state">{setupState}</span>
      <span data-testid="user">{user?.username ?? 'none'}</span>
      <span data-testid="error">{String(error)}</span>
      <button onClick={async () => setError(await login(testCredentials.adminUsername, testCredentials.adminPassword))}>login</button>
      <button onClick={() => { void logout(); }}>logout</button>
    </div>
  );
}

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

function renderProvider() {
  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  it('loads setup status on mount and exposes state', async () => {
    stubFetch({
      'GET /api/auth/setup-status': () =>
        jsonResponse(200, { state: 'Operational', user: { id: '1', username: testCredentials.adminUsername, role: 'Admin' } }),
    });
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('state')).toHaveTextContent('Operational');
    expect(screen.getByTestId('user')).toHaveTextContent(testCredentials.adminUsername);
  });

  it('returns the server error message and stays logged out on a failed login', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/auth/setup-status': () =>
        jsonResponse(200, { state: 'NeedsFirstAdmin', user: null }),
      'POST /api/auth/login': () => jsonResponse(401, { error: 'Account is locked.' }),
    });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await user.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Account is locked.'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('refreshes state after a successful login', async () => {
    const user = userEvent.setup();
    let loggedIn = false;
    stubFetch({
      'GET /api/auth/setup-status': () =>
        jsonResponse(200, {
          state: 'Operational',
          user: loggedIn ? { id: '1', username: testCredentials.adminUsername, role: 'Admin' } : null,
        }),
      'POST /api/auth/login': () => {
        loggedIn = true;
        return jsonResponse(200, {});
      },
    });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent(testCredentials.adminUsername));
    expect(screen.getByTestId('error')).toHaveTextContent('null');
  });

  it('clears the user on logout', async () => {
    const user = userEvent.setup();
    stubFetch({
      'GET /api/auth/setup-status': () =>
        jsonResponse(200, { state: 'Operational', user: { id: '1', username: testCredentials.adminUsername, role: 'Admin' } }),
      'POST /api/auth/logout': () => jsonResponse(200, {}),
    });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent(testCredentials.adminUsername));

    await user.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
  });
});
