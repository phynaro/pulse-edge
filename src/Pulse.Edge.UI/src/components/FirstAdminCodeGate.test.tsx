import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import { useAuth } from '../context/auth';
import FirstAdminCodeGate from './FirstAdminCodeGate';
import { jsonResponse } from '../test/http';
import { testCredentials } from '../test/credentials';

const issued = ['GGGG', 'AAAA', 'TTTT', 'EEEE', 'CCCC'].join('-');

// Mimics the onboarding wizard: it only exists while setup is incomplete, so it unmounts the
// moment createFirstAdmin refreshes the setup state to Operational — exactly what happens in App.
function WizardLike() {
  const { setupState, createFirstAdmin } = useAuth();
  if (setupState === 'Operational') return <p>dashboard</p>;
  return <button onClick={() => void createFirstAdmin(testCredentials.adminUsername, testCredentials.adminPassword)}>create admin</button>;
}

describe('FirstAdminCodeGate', () => {
  it('shows the first admin recovery code even though the wizard unmounts, then reveals the app', async () => {
    let state = 'NeedsFirstAdmin';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/setup-status') return jsonResponse(200, { state, user: state === 'Operational' ? { id: '1', username: testCredentials.adminUsername, role: 'Admin' } : null });
      state = 'Operational';
      return jsonResponse(200, { recoveryCode: issued });
    }));
    const user = userEvent.setup();
    render(<AuthProvider><FirstAdminCodeGate><WizardLike /></FirstAdminCodeGate></AuthProvider>);

    await user.click(await screen.findByRole('button', { name: 'create admin' }));

    expect(await screen.findByTestId('recovery-code')).toHaveTextContent(issued);
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/i have saved this code/i));
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(screen.getByText('dashboard')).toBeInTheDocument());
  });
});
