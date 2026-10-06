import { useState } from 'react';
import { ArrowRight, Copy, Download, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './RecoveryCode.css';

type Props = { code: string; onDone: () => void; notice?: string };

export default function RecoveryCodeDisplay({ code, onDone, notice }: Props) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard can be blocked (permissions/insecure context); the code stays visible and downloadable.
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([`PULSE Edge recovery code\n${code}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pulse-edge-recovery-code.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return <div className="recovery-code-panel">
    <div className="first-admin-heading"><KeyRound size={18} /><div><strong>{t('recovery.saveTitle')}</strong><span>{t('recovery.saveBody')}</span></div></div>
    {notice && <p className="recovery-notice">{notice}</p>}
    <code className="recovery-code" data-testid="recovery-code">{code}</code>
    <div className="recovery-code-actions">
      <button type="button" className="onboarding-btn onboarding-btn-action-back" onClick={() => void copy()}><Copy size={15} /> {copied ? t('recovery.copied') : t('recovery.copy')}</button>
      <button type="button" className="onboarding-btn onboarding-btn-action-back" onClick={download}><Download size={15} /> {t('recovery.download')}</button>
    </div>
    <label className="recovery-saved-check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> {t('recovery.savedCheckbox')}</label>
    <button type="button" className="onboarding-btn onboarding-btn-primary" style={{ width: '100%' }} disabled={!saved} onClick={onDone}>{t('recovery.continue')} <ArrowRight size={16} /></button>
  </div>;
}
