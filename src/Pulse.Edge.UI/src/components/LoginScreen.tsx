import { useState } from 'react';
import { Activity, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return <div className="auth-shell">
    <div className="auth-grid" aria-hidden="true" />
    <section className="auth-card">
      <div className="auth-brand"><Activity size={24} /><span>PULSE <b>EDGE</b></span></div>
      <div className="auth-icon"><LockKeyhole size={25} /></div>
      <p className="auth-kicker"><ShieldCheck size={13} /> SECURE LOCAL ACCESS</p>
      <h1>Sign in to the edge</h1>
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const result = await login(username, password); setError(result || ''); setBusy(false); }}>
        <label className="form-label" htmlFor="login-username">Username</label>
        <input id="login-username" className="form-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
        <label className="form-label auth-password-label" htmlFor="login-password">Password</label>
        <input id="login-password" className="form-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <div className="auth-error">{error}</div>}
        <button className="onboarding-btn onboarding-btn-primary auth-submit" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <LogIn size={17} /></>}</button>
      </form>
    </section>
  </div>;
}
