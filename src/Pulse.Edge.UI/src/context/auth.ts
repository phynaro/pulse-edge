import { createContext, useContext } from 'react';

export type AuthUser = { id: string; username: string; role: 'Admin' | 'ReadOnly' };
export type SetupState = 'NeedsCloudSetup' | 'NeedsFirstAdmin' | 'Operational';

export type AuthContextValue = {
  loading: boolean;
  setupState: SetupState;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<string | null>;
  createFirstAdmin: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
