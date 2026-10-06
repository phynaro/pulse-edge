import { useEffect, useState } from 'react';
import { AuthContext, type AuthUser, type SetupState } from './auth';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [setupState, setSetupState] = useState<SetupState>('NeedsCloudSetup');
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/api/auth/setup-status');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSetupState(data.state);
      setUser(data.user);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const submit = async (url: string, username: string, password: string) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || 'Authentication failed.';
    await refresh();
    return null;
  };

  const createFirstAdmin = async (username: string, password: string) => {
    const res = await fetch('/api/auth/first-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || 'Authentication failed.', recoveryCode: null };
    await refresh();
    return { error: null, recoveryCode: data.recoveryCode ?? null };
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  return <AuthContext.Provider value={{ loading, setupState, user, login: (u, p) => submit('/api/auth/login', u, p), createFirstAdmin, logout, refresh }}>{children}</AuthContext.Provider>;
}
