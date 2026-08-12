import { useState } from 'react';
import { Activity, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/auth';
import LanguageSwitcher from './LanguageSwitcher';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return <div className="auth-shell">
    <div className="auth-grid" aria-hidden="true" />
    <div style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 10 }}>
      <LanguageSwitcher />
    </div>
    <section className="auth-card">
      <div className="auth-brand"><Activity size={24} /><span>PULSE <b>EDGE</b></span></div>
      <div className="auth-icon"><LockKeyhole size={25} /></div>
      <p className="auth-kicker"><ShieldCheck size={13} /> SECURE LOCAL ACCESS</p>
      <h1>{t('login.title')}</h1>
      <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); const result = await login(username, password); setError(result || ''); setBusy(false); }}>
        <label className="form-label" htmlFor="login-username">{t('login.username')}</label>
        <input id="login-username" className="form-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus required />
        <label className="form-label auth-password-label" htmlFor="login-password">{t('login.password')}</label>
        <input id="login-password" className="form-input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <div className="auth-error">{error}</div>}
        <button className="onboarding-btn onboarding-btn-primary auth-submit" disabled={busy}>{busy ? t('login.signingIn') : <>{t('login.signInBtn')} <LogIn size={17} /></>}</button>
      </form>
    </section>
  </div>;
}
