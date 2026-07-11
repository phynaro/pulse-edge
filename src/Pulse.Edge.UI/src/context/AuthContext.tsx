import { createContext, useContext, useEffect, useState } from 'react';

export type AuthUser = { id: string; username: string; role: 'Admin' | 'ReadOnly' };
type SetupState = 'NeedsCloudSetup' | 'NeedsFirstAdmin' | 'Operational';

type AuthContextValue = {
  loading: boolean;
  setupState: SetupState;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<string | null>;
  createFirstAdmin: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  };

  return <AuthContext.Provider value={{ loading, setupState, user, login: (u, p) => submit('/api/auth/login', u, p), createFirstAdmin: (u, p) => submit('/api/auth/first-admin', u, p), logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

