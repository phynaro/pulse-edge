import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';
import './RecoveryCode.css';

type Me = { role: string; hasRecoveryCode: boolean; recoveryCodeCreatedAtUtc: string | null };

export default function MyRecoveryCode() {
  const { t } = useTranslation();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [issued, setIssued] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch('/api/auth/me');
    if (res.ok) setMe(await res.json());
  };
  useEffect(() => {
    let active = true;
    fetch('/api/auth/me')
      .then(res => res.ok ? res.json() as Promise<Me> : null)
      .then(data => { if (active) setMe(data); });
    return () => { active = false; };
  }, []);

  if (!me || me.role !== 'Admin') return null;
  if (issued) return <RecoveryCodeDisplay code={issued} onDone={() => { setIssued(null); setOpen(false); setCurrentPassword(''); void load(); }} />;

  const generate = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    const res = await fetch('/api/auth/recovery-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || t('recovery.regenerateFailed')); return; }
    setIssued(data.recoveryCode);
  };

  return <div className="recovery-code-panel">
    {me.hasRecoveryCode
      ? me.recoveryCodeCreatedAtUtc && <p className="recovery-notice">{t('recovery.issuedOn', { date: new Date(me.recoveryCodeCreatedAtUtc).toLocaleDateString() })}</p>
      : <p className="recovery-banner">{t('recovery.missingBanner')}</p>}
    {!open
      ? <button type="button" className="btn-primary" onClick={() => setOpen(true)}><KeyRound size={15} /> {t('recovery.regenerate')}</button>
      : <form className="user-create-row" onSubmit={e => void generate(e)}>
        <label className="form-label" htmlFor="current-password">{t('recovery.currentPassword')}</label>
        <input id="current-password" className="form-input" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
        <button className="btn-primary">{t('recovery.generate')}</button>
      </form>}
    {error && <div className="auth-error">{error}</div>}
  </div>;
}
