import { useState } from 'react';
import { ArrowLeft, KeyRound, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';
import './RecoveryCode.css';

type Mode = 'choose' | 'recover' | 'saved';

export default function ForgotPasswordPanel({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('choose');
  const [username, setUsername] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [issuedCode, setIssuedCode] = useState('');

  if (mode === 'saved') {
    return <RecoveryCodeDisplay code={issuedCode} notice={t('recovery.successNotice')} onDone={onBack} />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) { setError(t('recovery.mismatch')); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, recoveryCode, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || t('recovery.failed')); return; }
      setIssuedCode(data.recoveryCode);
      setMode('saved');
    } catch {
      setError(t('recovery.failed'));
    } finally {
      setBusy(false);
    }
  };

  return <div className="recovery-code-panel">
    <h1>{t('recovery.title')}</h1>
    {mode === 'choose' ? <>
      <div className="first-admin-heading"><UserCog size={18} /><div><strong>{t('recovery.askAdminTitle')}</strong><span>{t('recovery.askAdminBody')}</span></div></div>
      <button type="button" className="onboarding-btn onboarding-btn-primary" style={{ width: '100%' }} onClick={() => setMode('recover')}><KeyRound size={16} /> {t('recovery.useCodeBtn')}</button>
    </> : <form onSubmit={e => void submit(e)}>
      <label className="form-label" htmlFor="recover-username">{t('login.username')}</label>
      <input id="recover-username" className="form-input" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required />
      <label className="form-label auth-password-label" htmlFor="recover-code">{t('recovery.codeLabel')}</label>
      <input id="recover-code" className="form-input" autoComplete="off" spellCheck={false} value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} required />
      <label className="form-label auth-password-label" htmlFor="recover-new">{t('recovery.newPassword')}</label>
      <input id="recover-new" className="form-input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
      <label className="form-label auth-password-label" htmlFor="recover-confirm">{t('recovery.confirmPassword')}</label>
      <input id="recover-confirm" className="form-input" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
      <small className="onboarding-input-tip">{t('recovery.passwordRules')}</small>
      {error && <div className="auth-error">{error}</div>}
      <button className="onboarding-btn onboarding-btn-primary auth-submit" disabled={busy}>{busy ? t('recovery.submitting') : t('recovery.submit')}</button>
    </form>}
    <button type="button" className="recovery-link" onClick={onBack}><ArrowLeft size={13} /> {t('recovery.backToSignIn')}</button>
  </div>;
}
